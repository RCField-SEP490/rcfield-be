import cron from 'node-cron';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { transition } from '../services/booking.service';
import { processRefund } from '../services/payment.service';
import { writeContestAudit } from '../services/contest.helpers';
import { Session } from '../models/session.entity';
import { ExtensionProposal } from '../models/extension-proposal.entity';
import { Notification } from '../models/notification.entity';
import { createNotification } from '../services/notification.service';
import { wsService } from '../services/websocket.service';
import { ExtensionProposalStatus, NotificationType, SessionStatus, UserRole } from '../types';
import { SESSION_OVERDUE_ALERT_MINUTES } from '../lib/session-operational-timing';

async function notifyOverdueSessions(): Promise<void> {
  const overdueSessions = await AppDataSource.query<
    {
      sessionId: string;
      bookingId: string;
      checkedInBy: string;
      providerId: string;
      cafeName: string;
      minutesOverdue: number;
    }[]
  >(
    `SELECT
       s.id AS "sessionId",
       s.booking_id AS "bookingId",
       s.checked_in_by AS "checkedInBy",
       c.provider_id AS "providerId",
       c.name AS "cafeName",
       FLOOR(EXTRACT(EPOCH FROM (NOW() - s.planned_end_at)) / 60)::int AS "minutesOverdue"
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     JOIN cafes c ON c.id = s.cafe_id
     WHERE s.status = 'ACTIVE'
       AND s.actual_end_at IS NULL
       AND s.planned_end_at <= NOW() - ($1 * INTERVAL '1 minute')
       AND b.deleted_at IS NULL`,
    [SESSION_OVERDUE_ALERT_MINUTES],
  );

  const notificationRepo = AppDataSource.getRepository(Notification);
  for (const session of overdueSessions) {
    const alreadyNotified = await notificationRepo
      .createQueryBuilder('notification')
      .where('notification.type = :type', { type: NotificationType.SESSION_OVERDUE_ALERT })
      .andWhere("notification.data ->> 'sessionId' = :sessionId", { sessionId: session.sessionId })
      .getExists();
    if (alreadyNotified) continue;

    const shortSessionId = session.sessionId.slice(0, 8).toUpperCase();
    const title = 'Phiên chạy quá giờ chưa trả xe';
    const message = `Phiên #${shortSessionId} tại ${session.cafeName} đã quá giờ ${session.minutesOverdue} phút. Vui lòng kiểm tra và xử lý trả xe.`;
    const data = {
      sessionId: session.sessionId,
      bookingId: session.bookingId,
      minutesOverdue: session.minutesOverdue,
      route: `/staff/sessions/${session.sessionId}`,
    };
    const recipients = new Set([session.checkedInBy, session.providerId].filter(Boolean));

    for (const userId of recipients) {
      await createNotification(
        userId,
        NotificationType.SESSION_OVERDUE_ALERT,
        title,
        message,
        data,
      );
      wsService.pushToUser(userId, NotificationType.SESSION_OVERDUE_ALERT, {
        title,
        message,
        ...data,
      });
    }
    logger.warn('BookingTimeout', 'overdue session alert sent', {
      sessionId: session.sessionId,
      minutesOverdue: session.minutesOverdue,
    });
  }
}

/**
 * Customer approval is required for an app-booking extension. Do not leave a
 * vehicle in the transient EXTENDING state forever when the customer does not
 * answer; expiry returns it to ACTIVE and keeps the original planned end.
 */
async function expireStaleExtensionProposals(): Promise<void> {
  const staleProposals = await AppDataSource.query<
    { proposalId: string; sessionId: string; checkedInBy: string; customerId: string | null }[]
  >(
    `SELECT
       p.id AS "proposalId",
       p.session_id AS "sessionId",
       s.checked_in_by AS "checkedInBy",
       b.customer_id AS "customerId"
     FROM extension_proposals p
     JOIN sessions s ON s.id = p.session_id
     JOIN bookings b ON b.id = s.booking_id
     WHERE p.status = 'PENDING'
       AND s.status = 'EXTENDING'
       AND p.created_at <= NOW() - INTERVAL '10 minutes'`,
  );

  const proposalRepo = AppDataSource.getRepository(ExtensionProposal);
  const sessionRepo = AppDataSource.getRepository(Session);
  for (const proposal of staleProposals) {
    const result = await proposalRepo.update(
      { id: proposal.proposalId, status: ExtensionProposalStatus.PENDING },
      { status: ExtensionProposalStatus.EXPIRED, respondedAt: new Date() },
    );
    if (!result.affected) continue;

    await sessionRepo.update(
      { id: proposal.sessionId, status: SessionStatus.EXTENDING },
      { status: SessionStatus.ACTIVE },
    );
    const eventData = { sessionId: proposal.sessionId, proposalId: proposal.proposalId };
    wsService.pushToUser(proposal.checkedInBy, 'SESSION_EXTENSION_EXPIRED', eventData);
    if (proposal.customerId) {
      wsService.pushToUser(proposal.customerId, 'SESSION_EXTENSION_EXPIRED', eventData);
    }
    logger.info('BookingTimeout', 'expired unanswered session extension proposal', {
      proposalId: proposal.proposalId,
      sessionId: proposal.sessionId,
    });
  }
}

/**
 * WF-B cleanup: a PENDING contest registration whose rental booking just died
 * from payment timeout must not linger as a zombie — cancel it and record a
 * SYSTEM audit entry so the contest timeline explains what happened.
 */
export async function cancelContestRegistrationsForExpiredBookings(
  bookingIds: string[],
): Promise<void> {
  if (bookingIds.length === 0) return;

  const staleRegistrations = await AppDataSource.query<{ id: string; contest_id: string }[]>(
    `SELECT id, contest_id
     FROM contest_registrations
     WHERE booking_id = ANY($1::uuid[])
       AND status = 'PENDING'`,
    [bookingIds],
  );

  for (const registration of staleRegistrations) {
    await AppDataSource.query(
      `UPDATE contest_registrations
       SET status = 'CANCELLED',
           cancelled_at = NOW(),
           cancellation_reason = 'Booking thuê xe hết hạn thanh toán',
           updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING'`,
      [registration.id],
    );
    await writeContestAudit({
      contestId: registration.contest_id,
      registrationId: registration.id,
      actorId: null,
      actorRole: 'SYSTEM',
      eventType: 'registration.cancelled',
      beforeJson: { status: 'PENDING' },
      afterJson: { status: 'CANCELLED' },
      reason: 'Booking thuê xe hết hạn thanh toán',
      metadata: { trigger: 'booking_payment_timeout' },
    });
  }

  if (staleRegistrations.length > 0) {
    logger.info(
      'BookingTimeout',
      `cancelled ${staleRegistrations.length} contest registration(s) for expired bookings`,
    );
  }
}

/** Runs every minute — expires PENDING bookings and marks CONFIRMED no-shows */
export function scheduleBookingTimeout(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const expired: { id: string }[] = await AppDataSource.query(
        `SELECT id FROM bookings
         WHERE status = 'PENDING'
           AND payment_expires_at < NOW()
           AND deleted_at IS NULL`,
      );

      if (expired.length > 0) {
        logger.info('BookingTimeout', `expiring ${expired.length} booking(s)`);
        for (const row of expired) {
          await transition(row.id, 'PAYMENT_TIMEOUT').catch((err) => {
            logger.error('BookingTimeout', `failed to expire bookingId=${row.id}`, err);
          });
        }
        await cancelContestRegistrationsForExpiredBookings(expired.map((row) => row.id)).catch(
          (err) => {
            logger.error('BookingTimeout', 'failed to cancel contest registrations', err);
          },
        );
      }

      // NO_SHOW: a CHECKED_IN session only represents a handover in progress.
      // If the handover is not completed within 30 minutes, it must not keep the
      // booking alive indefinitely. Active/checkout sessions represent an actual
      // attended play session and are therefore excluded.
      const noShows: { id: string }[] = await AppDataSource.query(
        `SELECT b.id FROM bookings b
         WHERE b.status = 'CONFIRMED'
           AND b.slot_start + INTERVAL '30 minutes' < NOW()
           AND b.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM sessions s
             WHERE s.booking_id = b.id
               AND s.status IN ('ACTIVE', 'EXTENDING', 'CHECKING_OUT', 'COMPLETED')
           )`,
      );

      if (noShows.length > 0) {
        logger.info('BookingTimeout', `marking ${noShows.length} booking(s) as NO_SHOW`);
        for (const row of noShows) {
          await transition(row.id, 'NO_SHOW')
            .then(async () => {
              await AppDataSource.getRepository(Session)
                .createQueryBuilder()
                .update()
                .set({ status: SessionStatus.CANCELLED, actualEndAt: new Date() })
                .where('booking_id = :bookingId', { bookingId: row.id })
                .andWhere('status = :status', { status: SessionStatus.CHECKED_IN })
                .execute();
              await processRefund(row.id, UserRole.PROVIDER, true);
            })
            .catch((err) => {
              logger.error('BookingTimeout', `failed to NO_SHOW bookingId=${row.id}`, err);
            });
        }
      }

      await expireStaleExtensionProposals();

      // An active session is an attended booking, so it must never be changed
      // to NO_SHOW or completed automatically. Alert the assigned staff and
      // provider once instead; checkout remains the explicit inspection flow.
      await notifyOverdueSessions();
    } catch (err) {
      logger.error('BookingTimeout', 'job error', err);
    }
  });
}

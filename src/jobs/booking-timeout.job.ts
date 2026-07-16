import cron from 'node-cron';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { transition } from '../services/booking.service';
import { processRefund } from '../services/payment.service';
import { Session } from '../models/session.entity';
import { SessionStatus, UserRole } from '../types';

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
    } catch (err) {
      logger.error('BookingTimeout', 'job error', err);
    }
  });
}

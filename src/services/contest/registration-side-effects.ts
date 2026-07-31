import { Not } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { logger } from '../../config/logger';
import { ContestMatch } from '../../models/contest-match.entity';
import { ContestRegistration } from '../../models/contest-registration.entity';
import {
  ContestEntryFeePaymentStatus,
  ContestMatchStatus,
  ContestRegistrationStatus,
  NotificationType,
} from '../../types';
import { createNotification } from '../notification.service';
import { emailService } from '../email.service';
import { getPaymentStatusLabel, getRegistrationStatusLabel } from './payload';

export async function loadContestNotificationContext(registration: ContestRegistration) {
  const [row] = await AppDataSource.query<
    {
      contest_name: string;
      contest_starts_at: string;
      contest_status: string;
      host_branch_name: string | null;
      customer_email: string;
      customer_name: string;
    }[]
  >(
    `SELECT c.name AS contest_name,
            c.starts_at AS contest_starts_at,
            c.status AS contest_status,
            host.name AS host_branch_name,
            u.email AS customer_email,
            u.full_name AS customer_name
       FROM contest_registrations cr
       JOIN contests c ON c.id = cr.contest_id
       JOIN users u ON u.id = cr.user_id
       LEFT JOIN cafes host ON host.id = c.cafe_id
      WHERE cr.id = $1`,
    [registration.id],
  );

  if (!row) return null;

  return {
    contestName: row.contest_name,
    contestStartsAt: new Date(row.contest_starts_at),
    contestStatus: row.contest_status,
    hostBranchName: row.host_branch_name,
    customerEmail: row.customer_email,
    customerName: row.customer_name ?? 'Racer',
  };
}

export async function sendContestRegistrationCreatedSideEffects(registration: ContestRegistration) {
  const context = await loadContestNotificationContext(registration);
  if (!context) return;

  await createNotification(
    registration.userId,
    NotificationType.CONTEST_REGISTRATION_CREATED,
    'Dang ky giai dau thanh cong',
    `Ban da dang ky ${context.contestName}. RCField se tiep tuc cap nhat trang thai dang ky cho ban.`,
    {
      contest_id: registration.contestId,
      registration_id: registration.id,
    },
  );

  try {
    await emailService.sendContestRegistrationConfirmation({
      to: context.customerEmail,
      customerName: context.customerName,
      contestName: context.contestName,
      contestId: registration.contestId,
      contestStatusLabel: context.contestStatus,
      hostBranchName: context.hostBranchName,
      startsAt: context.contestStartsAt,
      registrationStatusLabel: getRegistrationStatusLabel(registration.status),
      paymentStatusLabel: getPaymentStatusLabel(registration.paymentStatus),
      entryFeeAmount: Number(registration.entryFeeAmount ?? 0),
    });
  } catch (error) {
    logger.error('ContestEmail', 'failed to send registration confirmation', error);
  }
}

export async function sendContestRegistrationStatusNotification(
  registration: ContestRegistration,
  type: NotificationType,
  title: string,
  message: string,
) {
  await createNotification(registration.userId, type, title, message, {
    contest_id: registration.contestId,
    registration_id: registration.id,
  });
}
export async function cleanUpContestOnCancel(contestId: string, actorId: string) {
  const registrationRepo = AppDataSource.getRepository(ContestRegistration);
  const registrations = await registrationRepo.find({
    where: { contestId, status: Not(ContestRegistrationStatus.CANCELLED) },
  });

  for (const registration of registrations) {
    registration.status = ContestRegistrationStatus.CANCELLED;
    registration.cancelledBy = actorId;
    registration.cancelledAt = new Date();
    registration.cancellationReason = 'Contest cancelled';
    registration.metadata = {
      ...(registration.metadata ?? {}),
      refund_needed: registration.paymentStatus === ContestEntryFeePaymentStatus.MARKED_PAID,
    };
    await registrationRepo.save(registration);
  }

  const matchRepo = AppDataSource.getRepository(ContestMatch);
  const matches = await matchRepo.find({ where: { contestId } });
  for (const match of matches) {
    if (match.status === ContestMatchStatus.CANCELLED) continue;
    match.status = ContestMatchStatus.CANCELLED;
    match.endedAt = match.endedAt ?? new Date();
    await matchRepo.save(match);
  }
}

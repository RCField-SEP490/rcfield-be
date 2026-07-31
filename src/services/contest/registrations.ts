import { Not } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { logger } from '../../config/logger';
import { Booking } from '../../models/booking.entity';
import { BookingVehicle } from '../../models/booking-vehicle.entity';
import { ContestCafe } from '../../models/contest-cafe.entity';
import { ContestRegistration } from '../../models/contest-registration.entity';
import { PaymentTransaction } from '../../models/payment-transaction.entity';
import {
  AppError,
  BookingStatus,
  ContestEntryFeePaymentStatus,
  ContestRegistrationStatus,
  ContestStatus,
  NotificationType,
  PaymentTransactionStatus,
  PaymentTransactionSubjectType,
  PaymentTransactionType,
  UserRole,
  VehicleSource,
} from '../../types';
import {
  getActiveContestBan,
  getContestOrThrow,
  isStaffAssignedToCafe,
  isStaffAssignedToContest,
  writeContestAudit,
} from '../contest.helpers';
import { Viewer } from '../cafe.service';
import { createPaymentUrl } from '../vnpay.service';
import { env } from '../../config/env';
import { processMockConfirmation } from '../payment.service';
import { createContestRentalBooking, ContestRentalSlotInput } from '../contest-rental.service';
import { transition } from '../booking.service';
import { mapContestRegistrationsPayload } from './payload';
import {
  assertContestProviderOrAssignedStaff,
  buildByocMetadata,
  generateUniqueCheckInCode,
  removeRegistrationFromActiveMatches,
} from './guards';
import {
  sendContestRegistrationCreatedSideEffects,
  sendContestRegistrationStatusNotification,
} from './registration-side-effects';
import {
  ContestRegistrationsQuery,
  CreateRegistrationBody,
  MyContestRegistrationsQuery,
} from './types';

export async function createContestRegistration(
  contestId: string,
  viewer: Viewer,
  body: CreateRegistrationBody,
) {
  if (viewer.role !== UserRole.CUSTOMER) {
    throw new AppError('Chỉ customer mới được đăng ký contest', 403, 'FORBIDDEN');
  }
  const contest = await getContestOrThrow(contestId);
  if (contest.status !== ContestStatus.OPEN) {
    throw new AppError('Contest chưa mở đăng ký', 400, 'CONTEST_NOT_OPEN');
  }
  const now = new Date();
  if (contest.registrationOpensAt && now < contest.registrationOpensAt) {
    throw new AppError('Chưa tới thời gian mở đăng ký', 400, 'CONTEST_REGISTRATION_NOT_OPEN_YET');
  }
  if (contest.registrationClosesAt && now > contest.registrationClosesAt) {
    throw new AppError('Contest đã đóng đăng ký', 400, 'CONTEST_REGISTRATION_CLOSED');
  }
  if (contest.providerId) {
    const activeBan = await getActiveContestBan(viewer.userId, contest.providerId, contest.id);
    if (activeBan) {
      throw new AppError(
        'Bạn đang bị chặn tham gia contest này',
        403,
        'CONTEST_PARTICIPANT_BANNED',
      );
    }
  }

  const vehiclePolicy = String(contest.vehicleRule?.vehicle_policy ?? 'RENTAL_ONLY');
  if (vehiclePolicy === 'RENTAL_ONLY' && body.vehicle_source !== VehicleSource.RENTAL) {
    throw new AppError(
      'Giải đấu chỉ chấp nhận thuê xe của cafe',
      400,
      'CONTEST_VEHICLE_POLICY_VIOLATED',
    );
  }
  if (vehiclePolicy === 'BYOC_ONLY' && body.vehicle_source !== VehicleSource.BYOC) {
    throw new AppError(
      'Giải đấu chỉ chấp nhận xe cá nhân (BYOC)',
      400,
      'CONTEST_VEHICLE_POLICY_VIOLATED',
    );
  }

  let resolvedBookingId: string | undefined = body.booking_id;
  let resolvedVehicleId: string | undefined = body.vehicle_id;
  // Booking created inline from rental_slot (WF-B). If the registration transaction
  // below fails, this booking is cancelled as a compensating action so a failed
  // registration never leaves an orphaned PENDING booking behind.
  let inlineRentalBookingId: string | null = null;

  if (body.vehicle_source === VehicleSource.RENTAL) {
    if (body.rental_slot && !body.booking_id) {
      const rentalResult = await createContestRentalBooking(
        contest,
        viewer.userId,
        body.rental_slot as ContestRentalSlotInput,
      );
      resolvedBookingId = rentalResult.booking_id;
      resolvedVehicleId = rentalResult.vehicle_id;
      inlineRentalBookingId = rentalResult.booking_id;
    }

    if (!resolvedBookingId || !resolvedVehicleId) {
      throw new AppError(
        'Đăng ký RENTAL yêu cầu booking_id và vehicle_id',
        400,
        'CONTEST_RENTAL_BOOKING_REQUIRED',
      );
    }
    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: resolvedBookingId, customerId: viewer.userId },
    });
    if (!booking) throw new AppError('Booking không tồn tại', 404, 'BOOKING_NOT_FOUND');
    if (contest.trackTypeId && booking.trackTypeId !== contest.trackTypeId) {
      throw new AppError(
        'Booking không khớp loại track của contest',
        400,
        'BOOKING_TRACK_TYPE_MISMATCH',
      );
    }

    const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
      where: { contestId, cafeId: booking.cafeId },
    });
    if (!contestCafe) {
      throw new AppError(
        'Booking không thuộc chi nhánh tham gia contest',
        400,
        'BOOKING_CAFE_MISMATCH',
      );
    }

    if (booking.slotStart > contest.endsAt || booking.slotEnd < contest.startsAt) {
      throw new AppError('Khung giờ booking không giao với contest', 400, 'BOOKING_TIME_MISMATCH');
    }

    const bookingVehicle = await AppDataSource.getRepository(BookingVehicle).findOne({
      where: { bookingId: booking.id, vehicleId: resolvedVehicleId },
    });
    if (!bookingVehicle) {
      throw new AppError('Vehicle không thuộc booking này', 400, 'BOOKING_VEHICLE_MISMATCH');
    }

    // For rental-only contests, prefer contest-linked bookings. Plain bookings created
    // outside the contest flow may violate resource locks or miss the contest window.
    const vehiclePolicy = String(contest.vehicleRule?.vehicle_policy ?? 'RENTAL_ONLY');
    if (vehiclePolicy === 'RENTAL_ONLY' && !booking.contestId) {
      throw new AppError(
        'Giải đấu bắt buộc thuê xe thông qua luồng contest; vui lòng chọn "Thuê xe tại quầy" hoặc dùng booking contest liên kết',
        400,
        'CONTEST_RENTAL_REQUIRES_CONTEST_BOOKING',
      );
    }
  } else {
    if (!body.byoc_vehicle_name?.trim()) {
      throw new AppError(
        'Đăng ký BYOC yêu cầu khai báo tên xe',
        400,
        'CONTEST_BYOC_DECLARATION_REQUIRED',
      );
    }
  }

  let saved: ContestRegistration;
  try {
    saved = await AppDataSource.transaction(async (manager) => {
      const transactionalRepo = manager.getRepository(ContestRegistration);

      // Lock existing registrations for this contest to serialize concurrent registrations.
      const existing = await transactionalRepo
        .createQueryBuilder('registration')
        .setLock('pessimistic_write')
        .where('registration.contest_id = :contestId', { contestId })
        .andWhere('registration.user_id = :userId', { userId: viewer.userId })
        .getOne();

      if (existing && existing.status !== ContestRegistrationStatus.CANCELLED) {
        throw new AppError('Bạn đã đăng ký contest này rồi', 409, 'CONTEST_ALREADY_REGISTERED');
      }

      if (contest.capacity && contest.capacity > 0) {
        const lockedRegistrations = await manager.query(
          `SELECT id
         FROM contest_registrations
         WHERE contest_id = $1 AND status != $2
         FOR UPDATE`,
          [contestId, ContestRegistrationStatus.CANCELLED],
        );
        const activeCount = lockedRegistrations.length;
        if (activeCount >= contest.capacity) {
          throw new AppError('Contest đã đủ sức chứa', 409, 'CONTEST_CAPACITY_REACHED');
        }
      }

      const registration = existing ?? transactionalRepo.create();
      registration.contestId = contestId;
      registration.userId = viewer.userId;
      registration.participantRoleSnapshot = UserRole.CUSTOMER;
      registration.vehicleSource = body.vehicle_source;
      registration.vehicleId =
        body.vehicle_source === VehicleSource.RENTAL ? (resolvedVehicleId ?? null) : null;
      registration.bookingId =
        body.vehicle_source === VehicleSource.RENTAL ? (resolvedBookingId ?? null) : null;
      registration.customerVehicleId = null;
      registration.status = ContestRegistrationStatus.PENDING;
      registration.checkInCode =
        existing?.checkInCode ?? (await generateUniqueCheckInCode(manager));
      registration.entryFeeAmount = Number(contest.entryFee ?? 0);
      registration.entryFeeDueAt = contest.registrationClosesAt ?? contest.startsAt;
      registration.paymentStatus =
        Number(contest.entryFee ?? 0) > 0
          ? ContestEntryFeePaymentStatus.PENDING_PAYMENT
          : ContestEntryFeePaymentStatus.PENDING_REVIEW;
      registration.metadata = {
        ...(registration.metadata ?? {}),
        booking_id: resolvedBookingId ?? null,
        byoc_declaration:
          body.vehicle_source === VehicleSource.BYOC ? buildByocMetadata(body) : undefined,
      };

      return transactionalRepo.save(registration);
    });
  } catch (err) {
    // Compensating action: the inline rental booking was created outside the
    // registration transaction (createBooking manages its own repositories), so
    // cancel it here to keep register-with-rental atomic from the user's view.
    if (inlineRentalBookingId) {
      try {
        await transition(inlineRentalBookingId, 'PAYMENT_TIMEOUT');
      } catch (cancelErr) {
        logger.error(
          'ContestService',
          `failed to cancel inline rental booking ${inlineRentalBookingId} after registration failure`,
          cancelErr,
        );
      }
    }
    throw err;
  }

  await writeContestAudit({
    contestId,
    registrationId: saved.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.created',
    afterJson: { status: saved.status, paymentStatus: saved.paymentStatus },
  });
  await sendContestRegistrationCreatedSideEffects(saved);

  const [mapped] = await mapContestRegistrationsPayload([saved], { includeContest: true });

  // WF-B: include the linked booking so FE can proceed to payment in one step.
  if (resolvedBookingId) {
    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: resolvedBookingId },
    });
    if (booking) {
      return {
        ...mapped,
        booking: {
          id: booking.id,
          status: booking.status,
          payment_expires_at: booking.paymentExpiresAt,
          total_amount: Number(
            (booking.snapshot as { total_charged?: number } | null)?.total_charged ?? 0,
          ),
        },
      };
    }
  }
  return mapped;
}

export async function listMyContestRegistrations(
  viewer: Viewer,
  query?: MyContestRegistrationsQuery,
) {
  const rows = await AppDataSource.getRepository(ContestRegistration).find({
    where: { userId: viewer.userId },
    order: { createdAt: 'DESC' },
  });
  const mapped = await mapContestRegistrationsPayload(rows, { includeContest: true });
  const normalizedQuery = query?.query?.toLowerCase();
  return mapped.filter((registration) => {
    const matchesQuery =
      !normalizedQuery ||
      registration.contest?.name?.toLowerCase().includes(normalizedQuery) ||
      registration.participant?.full_name?.toLowerCase().includes(normalizedQuery) ||
      registration.participant?.email?.toLowerCase().includes(normalizedQuery);
    const matchesContestStatus =
      !query?.contest_status || registration.contest?.status === query.contest_status;
    const matchesJourney =
      !query?.customer_journey_status ||
      registration.customer_journey_status === query.customer_journey_status;
    return matchesQuery && matchesContestStatus && matchesJourney;
  });
}

export async function listContestRegistrations(
  contestId: string,
  viewer: Viewer,
  query?: ContestRegistrationsQuery,
) {
  await assertContestProviderOrAssignedStaff(contestId, viewer);
  const rows = await AppDataSource.getRepository(ContestRegistration).find({
    where: { contestId },
    order: { createdAt: 'DESC' },
  });
  const mapped = await mapContestRegistrationsPayload(rows, { includeContest: false });
  const normalizedQuery = query?.query?.toLowerCase();
  return mapped.filter((registration) => {
    const matchesQuery =
      !normalizedQuery ||
      registration.participant?.full_name?.toLowerCase().includes(normalizedQuery) ||
      registration.participant?.email?.toLowerCase().includes(normalizedQuery) ||
      registration.check_in_code?.toLowerCase().includes(normalizedQuery);
    const matchesStatus = !query?.status || registration.status === query.status;
    const matchesPayment =
      !query?.payment_status || registration.payment_status === query.payment_status;
    return matchesQuery && matchesStatus && matchesPayment;
  });
}

export async function listContestBookings(contestId: string, viewer: Viewer) {
  await assertContestProviderOrAssignedStaff(contestId, viewer);
  const rows = await AppDataSource.query<
    {
      id: string;
      status: string;
      slot_start: Date;
      slot_end: Date;
      source: string;
      customer_id: string;
      customer_name: string | null;
      customer_email: string | null;
      registration_id: string | null;
      registration_status: string | null;
      check_in_code: string | null;
    }[]
  >(
    `SELECT b.id, b.status, b.slot_start, b.slot_end, b.source, b.customer_id,
            u.full_name AS customer_name, u.email AS customer_email,
            r.id AS registration_id, r.status AS registration_status, r.check_in_code
     FROM bookings b
     LEFT JOIN users u ON u.id = b.customer_id
     LEFT JOIN contest_registrations r ON r.booking_id = b.id
     WHERE b.contest_id = $1
     ORDER BY b.slot_start ASC`,
    [contestId],
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    source: row.source,
    slot_start: row.slot_start,
    slot_end: row.slot_end,
    customer: {
      id: row.customer_id,
      full_name: row.customer_name,
      email: row.customer_email,
    },
    registration: row.registration_id
      ? {
          id: row.registration_id,
          status: row.registration_status,
          check_in_code: row.check_in_code,
        }
      : null,
  }));
}

async function getContestRegistrationForOwner(registrationId: string, viewer: Viewer) {
  const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
    where: { id: registrationId },
  });
  if (!registration)
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');
  await assertContestProviderOrAssignedStaff(registration.contestId, viewer);
  return registration;
}

export async function markEntryFeePaid(registrationId: string, viewer: Viewer, note?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.paymentStatus = ContestEntryFeePaymentStatus.MARKED_PAID;
  registration.entryFeeMarkedPaidBy = viewer.userId;
  registration.entryFeeMarkedPaidAt = new Date();
  registration.metadata = { ...(registration.metadata ?? {}), fee_note: note ?? null };
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.entry_fee_marked_paid',
    afterJson: { paymentStatus: registration.paymentStatus },
    reason: note ?? null,
  });
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function waiveEntryFee(registrationId: string, viewer: Viewer, note?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.paymentStatus = ContestEntryFeePaymentStatus.WAIVED;
  registration.entryFeeMarkedPaidBy = viewer.userId;
  registration.entryFeeMarkedPaidAt = new Date();
  registration.metadata = { ...(registration.metadata ?? {}), fee_note: note ?? null };
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.entry_fee_waived',
    afterJson: { paymentStatus: registration.paymentStatus },
    reason: note ?? null,
  });
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function approveRegistration(registrationId: string, viewer: Viewer, reason?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  if (
    ![
      ContestEntryFeePaymentStatus.NOT_REQUIRED,
      ContestEntryFeePaymentStatus.WAIVED,
      ContestEntryFeePaymentStatus.MARKED_PAID,
      ContestEntryFeePaymentStatus.PENDING_REVIEW,
    ].includes(registration.paymentStatus)
  ) {
    throw new AppError(
      'Registration chưa hoàn tất trạng thái phí tham gia',
      400,
      'ENTRY_FEE_PENDING',
    );
  }

  if (registration.vehicleSource === VehicleSource.RENTAL && registration.bookingId) {
    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: registration.bookingId },
    });
    if (!booking || booking.status !== BookingStatus.CONFIRMED) {
      throw new AppError(
        'Booking thuê xe phải được thanh toán (CONFIRMED) trước khi duyệt đăng ký',
        400,
        'BOOKING_NOT_CONFIRMED',
      );
    }
  }

  const contest = await getContestOrThrow(registration.contestId);
  if (![ContestStatus.OPEN, ContestStatus.CLOSED].includes(contest.status)) {
    throw new AppError(
      'Không thể duyệt registration khi contest không ở trạng thái OPEN hoặc CLOSED',
      400,
      'CONTEST_NOT_APPROVABLE',
    );
  }
  if (contest.providerId) {
    const activeBan = await getActiveContestBan(
      registration.userId,
      contest.providerId,
      contest.id,
    );
    if (activeBan) {
      throw new AppError(
        'Người tham gia đang bị ban khỏi contest này',
        409,
        'CONTEST_PARTICIPANT_BANNED',
      );
    }
  }
  if (contest.capacity && contest.capacity > 0) {
    const activeCount = await AppDataSource.getRepository(ContestRegistration).count({
      where: {
        contestId: contest.id,
        status: Not(ContestRegistrationStatus.CANCELLED),
      },
    });
    // Exclude the current registration from the active count because it is being approved now.
    const currentIncluded = registration.status !== ContestRegistrationStatus.CANCELLED ? 1 : 0;
    if (activeCount - currentIncluded >= contest.capacity) {
      throw new AppError('Contest đã đủ sức chứa', 409, 'CONTEST_CAPACITY_REACHED');
    }
  }
  registration.status = ContestRegistrationStatus.CONFIRMED;
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.approved',
    afterJson: { status: registration.status },
    reason: reason ?? null,
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_REGISTRATION_APPROVED,
    'Dang ky giai dau da duoc duyet',
    'Dang ky cua ban da duoc duyet. Ban hay theo doi thong bao de den check-in dung gio.',
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

/**
 * WF-B cleanup: when a registration is rejected/cancelled, cancel its linked
 * contest rental booking if it is still unpaid (PENDING — PAYMENT_TIMEOUT moves
 * it to CANCELLED and releases slot locks). Bookings that were already paid or
 * consumed (CONFIRMED / AWAITING_PAYMENT / ...) are kept untouched — no automatic
 * refund — and an audit log entry records that decision.
 */
export async function cleanupContestRentalBookingOnRegistrationCancel(
  registration: ContestRegistration,
  viewer: Viewer,
  trigger: 'registration.rejected' | 'registration.cancelled',
): Promise<void> {
  if (!registration.bookingId) return;
  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: registration.bookingId },
  });
  if (!booking || booking.contestId == null) return;

  if (booking.status === BookingStatus.PENDING) {
    await transition(booking.id, 'PAYMENT_TIMEOUT');
    await writeContestAudit({
      contestId: registration.contestId,
      registrationId: registration.id,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'booking.contest_rental_cancelled',
      beforeJson: { booking_status: BookingStatus.PENDING },
      afterJson: { booking_status: BookingStatus.CANCELLED },
      metadata: { booking_id: booking.id, trigger },
    });
    return;
  }

  if (booking.status === BookingStatus.CANCELLED) return;

  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'booking.contest_rental_retained',
    afterJson: { booking_status: booking.status },
    reason: 'Booking đã thanh toán hoặc đã sử dụng — giữ nguyên, không tự refund',
    metadata: { booking_id: booking.id, trigger },
  });
}

export async function rejectRegistration(registrationId: string, viewer: Viewer, reason?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.status = ContestRegistrationStatus.CANCELLED;
  registration.cancelledBy = viewer.userId;
  registration.cancelledAt = new Date();
  registration.cancellationReason = reason ?? 'Rejected by provider';
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await removeRegistrationFromActiveMatches(registration.id);
  try {
    await cleanupContestRentalBookingOnRegistrationCancel(
      registration,
      viewer,
      'registration.rejected',
    );
  } catch (err) {
    logger.error(
      'ContestService',
      `rental booking cleanup failed registrationId=${registration.id}`,
      err,
    );
  }
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.rejected',
    afterJson: { status: registration.status },
    reason: registration.cancellationReason,
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_REGISTRATION_REJECTED,
    'Dang ky giai dau bi tu choi',
    `Dang ky cua ban da bi tu choi.${registration.cancellationReason ? ` Ly do: ${registration.cancellationReason}` : ''}`,
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function cancelRegistration(registrationId: string, viewer: Viewer, reason?: string) {
  const repo = AppDataSource.getRepository(ContestRegistration);
  const registration = await repo.findOne({ where: { id: registrationId } });
  if (!registration)
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');

  if (viewer.role === UserRole.CUSTOMER) {
    if (registration.userId !== viewer.userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
  } else {
    await assertContestProviderOrAssignedStaff(registration.contestId, viewer);
  }

  registration.status = ContestRegistrationStatus.CANCELLED;
  registration.cancelledBy = viewer.userId;
  registration.cancelledAt = new Date();
  registration.cancellationReason = reason ?? 'Cancelled';
  await repo.save(registration);
  await removeRegistrationFromActiveMatches(registration.id);
  try {
    await cleanupContestRentalBookingOnRegistrationCancel(
      registration,
      viewer,
      'registration.cancelled',
    );
  } catch (err) {
    logger.error(
      'ContestService',
      `rental booking cleanup failed registrationId=${registration.id}`,
      err,
    );
  }
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.cancelled',
    afterJson: { status: registration.status },
    reason: registration.cancellationReason,
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_REGISTRATION_CANCELLED,
    'Dang ky giai dau da duoc huy',
    `Dang ky cua ban da duoc huy.${registration.cancellationReason ? ` Ly do: ${registration.cancellationReason}` : ''}`,
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function lookupRegistrationByCode(
  contestId: string,
  checkInCode: string,
  viewer: Viewer,
) {
  const contest = await getContestOrThrow(contestId);
  if (viewer.role === UserRole.PROVIDER) {
    await assertContestProviderOrAssignedStaff(contestId, viewer);
  } else if (viewer.role === UserRole.STAFF) {
    const assigned = await isStaffAssignedToContest(contestId, viewer.userId);
    if (!assigned) {
      throw new AppError('Staff không thuộc chi nhánh tham gia contest', 403, 'FORBIDDEN');
    }
  } else {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }

  const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
    where: { contestId: contest.id, checkInCode },
  });
  if (!registration)
    throw new AppError('Không tìm thấy registration', 404, 'REGISTRATION_NOT_FOUND');
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: true });
  return mapped;
}

export async function checkInRegistration(
  registrationId: string,
  checkedInCafeId: string,
  viewer: Viewer,
  byocConfirmed?: boolean,
  byocInspection?: {
    photos?: Array<{ url: string; angle?: string; notes?: string }>;
    checklist?: Array<{
      itemKey: string;
      itemLabel: string;
      status?: 'OK' | 'NOT_OK' | 'NA';
      note?: string;
    }>;
  },
) {
  const repo = AppDataSource.getRepository(ContestRegistration);
  const registration = await repo.findOne({ where: { id: registrationId } });
  if (!registration)
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');
  const contest = await getContestOrThrow(registration.contestId);

  if (registration.status !== ContestRegistrationStatus.CONFIRMED) {
    throw new AppError(
      'Registration phải ở trạng thái CONFIRMED',
      400,
      'REGISTRATION_NOT_CONFIRMED',
    );
  }
  if (
    Number(contest.entryFee ?? 0) > 0 &&
    ![
      ContestEntryFeePaymentStatus.MARKED_PAID,
      ContestEntryFeePaymentStatus.WAIVED,
      ContestEntryFeePaymentStatus.PENDING_REVIEW,
    ].includes(registration.paymentStatus)
  ) {
    throw new AppError('Registration vẫn đang chờ xử lý phí tham gia', 400, 'ENTRY_FEE_PENDING');
  }

  if (![ContestStatus.CLOSED, ContestStatus.RUNNING].includes(contest.status)) {
    throw new AppError(
      'Check-in chỉ được thực hiện khi contest ở trạng thái CLOSED hoặc RUNNING',
      400,
      'CONTEST_NOT_CHECKIN_READY',
    );
  }
  const now = new Date();
  if (contest.startsAt && now < contest.startsAt) {
    throw new AppError('Chưa tới giờ check-in của contest', 400, 'CONTEST_CHECKIN_NOT_STARTED');
  }
  if (contest.endsAt && now > contest.endsAt) {
    throw new AppError('Contest đã kết thúc, không thể check-in', 400, 'CONTEST_CHECKIN_ENDED');
  }

  const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
    where: { contestId: contest.id, cafeId: checkedInCafeId },
  });
  if (!contestCafe) {
    throw new AppError('Cafe check-in không thuộc contest', 400, 'CONTEST_CHECKIN_CAFE_INVALID');
  }

  if (viewer.role === UserRole.PROVIDER) {
    await assertContestProviderOrAssignedStaff(contest.id, viewer);
  } else if (viewer.role === UserRole.STAFF) {
    const assignedToContest = await isStaffAssignedToContest(contest.id, viewer.userId);
    const assignedToCafe = await isStaffAssignedToCafe(viewer.userId, checkedInCafeId);
    if (!assignedToContest || !assignedToCafe) {
      throw new AppError('Staff không được check-in ở chi nhánh này', 403, 'FORBIDDEN');
    }
  } else {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }

  if (contest.providerId) {
    const activeBan = await getActiveContestBan(
      registration.userId,
      contest.providerId,
      contest.id,
    );
    if (activeBan) {
      throw new AppError(
        'Người tham gia đang bị chặn thi đấu ở contest này',
        403,
        'CONTEST_PARTICIPANT_BANNED',
      );
    }
  }

  // BYOC check-in guard: ensure the declared vehicle is present before allowing entry.
  if (registration.vehicleSource === VehicleSource.BYOC) {
    const declaration = registration.metadata?.byoc_declaration as
      | { vehicle_name?: string | null }
      | undefined;
    if (!declaration?.vehicle_name?.trim()) {
      throw new AppError(
        'Khai báo xe cá nhân chưa đầy đủ; không thể check-in BYOC',
        400,
        'CONTEST_BYOC_DECLARATION_INVALID',
      );
    }
    if (!byocConfirmed) {
      throw new AppError(
        'Cần xác nhận xe cá nhân đạt chuẩn trước khi check-in BYOC',
        400,
        'CONTEST_BYOC_CONFIRMATION_REQUIRED',
      );
    }
    const byocPhotos = byocInspection?.photos ?? [];
    const byocChecklist = byocInspection?.checklist ?? [];
    const requiredChecklistKeys = new Set(['body', 'power_system', 'wheels']);
    const providedKeys = new Set(byocChecklist.map((item) => item.itemKey));
    const missingKeys = Array.from(requiredChecklistKeys).filter((key) => !providedKeys.has(key));
    if (byocPhotos.length < 2 || missingKeys.length > 0) {
      throw new AppError(
        `Check-in BYOC cần ít nhất 2 ảnh và kiểm tra đầy đủ các hạng mục: ${Array.from(requiredChecklistKeys).join(', ')}`,
        400,
        'CONTEST_BYOC_INSPECTION_REQUIRED',
      );
    }
    registration.metadata = {
      ...(registration.metadata ?? {}),
      byoc_checked_in_confirmed_by: viewer.userId,
      byoc_checked_in_confirmed_at: new Date().toISOString(),
      byoc_inspection: {
        photos: byocPhotos,
        checklist: byocChecklist,
        checked_at: new Date().toISOString(),
      },
    };
  }

  registration.status = ContestRegistrationStatus.CHECKED_IN;
  registration.checkedInCafeId = checkedInCafeId;
  registration.checkedInBy = viewer.userId;
  registration.checkedInAt = new Date();
  await repo.save(registration);
  await writeContestAudit({
    contestId: contest.id,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.checked_in',
    afterJson: { status: registration.status, checkedInCafeId },
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_CHECKIN_CONFIRMED,
    'Check-in giai dau thanh cong',
    'Ban da check-in thanh cong. He thong se cap nhat bracket va luot thi tiep theo cho ban.',
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: true });
  return mapped;
}
export async function createContestEntryPaymentUrl(
  registrationId: string,
  viewer: Viewer,
  ipAddr: string,
  returnUrl?: string,
) {
  if (viewer.role !== UserRole.CUSTOMER) {
    throw new AppError('Chỉ customer mới được tạo thanh toán entry fee', 403, 'FORBIDDEN');
  }
  const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
    where: { id: registrationId, userId: viewer.userId },
  });
  if (!registration) {
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');
  }
  const contest = await getContestOrThrow(registration.contestId);
  if (Number(registration.entryFeeAmount ?? 0) <= 0) {
    throw new AppError('Contest này không yêu cầu entry fee', 400, 'ENTRY_FEE_NOT_REQUIRED');
  }
  if (
    [ContestEntryFeePaymentStatus.MARKED_PAID, ContestEntryFeePaymentStatus.WAIVED].includes(
      registration.paymentStatus,
    )
  ) {
    throw new AppError('Entry fee đã được xử lý', 409, 'ENTRY_FEE_ALREADY_SETTLED');
  }

  const existingTxn = await AppDataSource.getRepository(PaymentTransaction).findOne({
    where: {
      contestRegistrationId: registration.id,
      subjectType: PaymentTransactionSubjectType.CONTEST_ENTRY,
      type: PaymentTransactionType.PAYMENT,
      status: PaymentTransactionStatus.PENDING,
    },
    order: { createdAt: 'DESC' },
  });
  if (existingTxn) {
    throw new AppError(
      'Một giao dịch entry fee đang chờ xử lý; vui lòng hoàn tất hoặc hủy trước khi tạo mới',
      409,
      'ENTRY_FEE_TRANSACTION_PENDING',
    );
  }

  const txnRef = `contest_${registration.id.replace(/-/g, '').slice(0, 18)}_${Date.now().toString().slice(-4)}`;
  const paymentUrl = createPaymentUrl({
    amount: Number(registration.entryFeeAmount),
    txnRef,
    orderInfo: `Contest entry ${contest.name.slice(0, 40)}`,
    ipAddr,
    returnUrl,
    bankCode: 'VNBANK',
  });

  await AppDataSource.getRepository(PaymentTransaction).save(
    AppDataSource.getRepository(PaymentTransaction).create({
      bookingId: null,
      customerPackageId: null,
      contestRegistrationId: registration.id,
      subjectType: PaymentTransactionSubjectType.CONTEST_ENTRY,
      type: PaymentTransactionType.PAYMENT,
      gateway: env.vnpay.mockEnabled ? 'MOCK' : 'VNPAY',
      txnRef,
      amount: Number(registration.entryFeeAmount),
      status: PaymentTransactionStatus.PENDING,
      rawRequest: {
        registrationId: registration.id,
        contestId: contest.id,
        returnUrl: returnUrl ?? null,
      },
    }),
  );

  if (env.vnpay.mockEnabled) {
    await processMockConfirmation(txnRef);
    const target = new URL('/payment/result', env.frontendUrl);
    target.searchParams.set('status', 'success');
    target.searchParams.set('txn_ref', txnRef);
    target.searchParams.set('mock', '1');
    return {
      payment_url: target.toString(),
      txn_ref: txnRef,
      amount: Number(registration.entryFeeAmount),
    };
  }

  return {
    payment_url: paymentUrl,
    txn_ref: txnRef,
    amount: Number(registration.entryFeeAmount),
  };
}
export async function disqualifyRegistration(
  registrationId: string,
  viewer: Viewer,
  reason?: string,
) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.status = ContestRegistrationStatus.CANCELLED;
  registration.cancelledBy = viewer.userId;
  registration.cancelledAt = new Date();
  registration.cancellationReason = reason ?? 'Disqualified';
  registration.metadata = {
    ...(registration.metadata ?? {}),
    disqualified: true,
    disqualified_at: new Date().toISOString(),
  };
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await removeRegistrationFromActiveMatches(registration.id);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.disqualified',
    afterJson: { status: registration.status },
    reason: registration.cancellationReason,
  });
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

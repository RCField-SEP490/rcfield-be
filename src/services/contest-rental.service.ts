import { EntityManager } from 'typeorm';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { Booking } from '../models/booking.entity';
import { Cafe } from '../models/cafe.entity';
import { CafeTrackConfig } from '../models/cafe-track-config.entity';
import { Contest } from '../models/contest.entity';
import { ContestAuditLog } from '../models/contest-audit-log.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { VehicleCatalog } from '../models/vehicle-catalog.entity';
import { Vehicle } from '../models/vehicle.entity';
import {
  AppError,
  BookingMode,
  BookingSource,
  BookingStatus,
  ContestRegistrationStatus,
  ContestStatus,
  VehicleStatus,
} from '../types';
import { createBooking, CreateBookingBody } from './booking.service';
import { ContestCafe } from '../models/contest-cafe.entity';

// ── Contest rental pricing policy (bridge Contest ↔ Booking) ────────────────

export type ContestDepositMode = 'FULL' | 'REDUCED' | 'WAIVED';

export interface ContestRentalPolicy {
  waive_slot_fee: boolean;
  deposit_mode: ContestDepositMode;
  /** Percent of the original deposit charged when deposit_mode = REDUCED (0-100). */
  deposit_percent: number;
  /** Slot must start no earlier than startsAt - before_min and end no later than endsAt + after_min. */
  slot_window: { before_min: number; after_min: number };
}

export const DEFAULT_CONTEST_RENTAL_POLICY: ContestRentalPolicy = {
  waive_slot_fee: false,
  deposit_mode: 'FULL',
  deposit_percent: 50,
  slot_window: { before_min: 60, after_min: 60 },
};

export interface ContestPricingAdjustments {
  waiveSlotFee: boolean;
  /** Multiply each vehicle's security_deposit snapshot by this (0 = waived). */
  depositMultiplier: number;
}

const DEPOSIT_MODES: readonly ContestDepositMode[] = ['FULL', 'REDUCED', 'WAIVED'];

function getSlotStarts(slotStart: Date, slotEnd: Date, slotDurationMinutes: number): Date[] {
  const slotStarts: Date[] = [];
  const slotDurationMs = slotDurationMinutes * 60 * 1000;
  for (let cursor = slotStart.getTime(); cursor < slotEnd.getTime(); cursor += slotDurationMs) {
    slotStarts.push(new Date(cursor));
  }
  return slotStarts;
}

function contestRentalVehicleLockKey(vehicleId: string, slotStart: Date): string {
  return `contest:rental:vehicle:${vehicleId}:${slotStart.getTime()}`;
}

async function acquireContestRentalVehicleLock(
  vehicleId: string,
  slotStart: Date,
  ttlSeconds = env.platform.slotLockTtlSeconds,
): Promise<boolean> {
  const key = contestRentalVehicleLockKey(vehicleId, slotStart);
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

async function releaseContestRentalVehicleLocks(
  vehicleId: string,
  slotStarts: Date[],
): Promise<void> {
  const keys = slotStarts.map((s) => contestRentalVehicleLockKey(vehicleId, s));
  if (keys.length > 0) {
    await redis.del(keys);
  }
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
}

/** Reads contest.config.rental_policy with safe defaults; bad values fall back per-field. */
export function getContestRentalPolicy(
  contest: Pick<Contest, 'config'> | null | undefined,
): ContestRentalPolicy {
  const raw = (contest?.config ?? {}) as Record<string, unknown>;
  const policy = (raw.rental_policy ?? {}) as Record<string, unknown>;
  const rawWindow = (policy.slot_window ?? {}) as Record<string, unknown>;

  const rawMode = String(policy.deposit_mode ?? '').toUpperCase();
  const depositMode = (DEPOSIT_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as ContestDepositMode)
    : DEFAULT_CONTEST_RENTAL_POLICY.deposit_mode;

  const rawPercent = Number(policy.deposit_percent);
  const depositPercent =
    Number.isFinite(rawPercent) && rawPercent >= 0 && rawPercent <= 100
      ? rawPercent
      : DEFAULT_CONTEST_RENTAL_POLICY.deposit_percent;

  return {
    waive_slot_fee: policy.waive_slot_fee === true,
    deposit_mode: depositMode,
    deposit_percent: depositPercent,
    slot_window: {
      before_min: toNonNegativeInt(
        rawWindow.before_min,
        DEFAULT_CONTEST_RENTAL_POLICY.slot_window.before_min,
      ),
      after_min: toNonNegativeInt(
        rawWindow.after_min,
        DEFAULT_CONTEST_RENTAL_POLICY.slot_window.after_min,
      ),
    },
  };
}

/** Maps a parsed policy to the pricing knobs the payment flow consumes. */
export function applyContestRentalPricing(
  booking: { contestId?: string | null; source?: BookingSource | string | null },
  policy: ContestRentalPolicy,
): ContestPricingAdjustments {
  const isContestBooking = booking.contestId != null || booking.source === BookingSource.CONTEST;
  if (!isContestBooking) {
    return { waiveSlotFee: false, depositMultiplier: 1 };
  }
  return {
    waiveSlotFee: policy.waive_slot_fee,
    depositMultiplier:
      policy.deposit_mode === 'WAIVED'
        ? 0
        : policy.deposit_mode === 'REDUCED'
          ? policy.deposit_percent / 100
          : 1,
  };
}

export type ContestRentalSlotInput = {
  cafe_id: string;
  slot_start: string | Date;
  slot_end: string | Date;
  track_config_id?: string | null;
  vehicle_catalog_id?: string | null;
};

export type CreateContestRentalBookingResult = {
  booking_id: string;
  vehicle_id: string;
  status: BookingStatus;
  payment_expires_at: Date;
  total_amount: number;
  breakdown: {
    slot_fee: number;
    rental_fee: number;
    total: number;
  };
};

export type ContestRentalOptions = {
  cafes: Array<{
    id: string;
    name: string;
    city: string | null;
    district: string | null;
  }>;
  track_configs: Array<{
    id: string;
    cafe_id: string;
    track_type_id: string;
    track_type_name: string | null;
    max_concurrent: number;
  }>;
  vehicle_catalogs: Array<{
    id: string;
    cafe_id: string;
    name: string;
    tier: string;
    hourly_rate: number;
    cover_image_url: string | null;
    compatible_track_types: string[];
  }>;
};

/**
 * WF-A entry point for POST /bookings/contest-rental: validates that the contest
 * exists and is open for registration (same rule as createContestRegistration),
 * then delegates to createContestRentalBooking. Does NOT create a registration —
 * signing up for the contest is a separate step that links booking_id afterwards.
 */
export async function bookContestRental(
  contestId: string,
  customerId: string,
  slot: ContestRentalSlotInput,
): Promise<CreateContestRentalBookingResult & { contest_id: string }> {
  const contest = await AppDataSource.getRepository(Contest).findOne({
    where: { id: contestId },
  });
  if (!contest) {
    throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  }
  if (contest.status !== ContestStatus.OPEN) {
    throw new AppError('Contest chưa mở đăng ký', 400, 'CONTEST_NOT_OPEN');
  }

  const result = await createContestRentalBooking(contest, customerId, slot);
  return { ...result, contest_id: contest.id };
}

export async function createContestRentalBooking(
  contest: Contest,
  customerId: string,
  slot: ContestRentalSlotInput,
): Promise<CreateContestRentalBookingResult> {
  const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
    where: { contestId: contest.id, cafeId: slot.cafe_id },
  });
  if (!contestCafe) {
    throw new AppError('Chi nhánh không tham gia contest', 400, 'CONTEST_CAFE_INVALID');
  }

  const cafe = await AppDataSource.getRepository(Cafe).findOne({
    where: { id: slot.cafe_id },
  });
  if (!cafe) {
    throw new AppError('Cafe không tồn tại', 404, 'CAFE_NOT_FOUND');
  }

  let trackConfigId: string | undefined;
  let trackTypeId: string | undefined;
  if (slot.track_config_id) {
    const trackConfig = await AppDataSource.getRepository(CafeTrackConfig).findOne({
      where: { id: slot.track_config_id, cafeId: slot.cafe_id, isActive: true },
    });
    if (!trackConfig) {
      throw new AppError(
        'Track config không tồn tại hoặc không hoạt động',
        400,
        'TRACK_CONFIG_NOT_FOUND',
      );
    }
    trackConfigId = trackConfig.id;
    trackTypeId = trackConfig.trackTypeId;
  }

  // Validate track type matches contest if track config is provided.
  if (contest.trackTypeId && trackTypeId && trackTypeId !== contest.trackTypeId) {
    throw new AppError(
      'Track config không khớp loại đường đua của contest',
      400,
      'TRACK_TYPE_MISMATCH',
    );
  }

  const vehicle = await resolveContestRentalVehicle(slot, contest.trackTypeId);

  // Slot must fit inside the contest window widened by the rental policy's slot_window.
  const policy = getContestRentalPolicy(contest);
  const slotStart = new Date(slot.slot_start);
  const slotEnd = new Date(slot.slot_end);
  const windowStart = new Date(contest.startsAt.getTime() - policy.slot_window.before_min * 60_000);
  const windowEnd = new Date(contest.endsAt.getTime() + policy.slot_window.after_min * 60_000);
  if (slotStart < windowStart || slotEnd > windowEnd) {
    throw new AppError(
      'Khung giờ slot nằm ngoài cửa sổ cho phép của contest',
      400,
      'CONTEST_SLOT_OUTSIDE_WINDOW',
    );
  }

  // Prevent booking a rental slot that spans far longer than the actual race window.
  // The slot should be for contest use, not a disguised all-day rental.
  const raceDurationMs = contest.endsAt.getTime() - contest.startsAt.getTime();
  const maxSlotDurationMs =
    raceDurationMs + (policy.slot_window.before_min + policy.slot_window.after_min) * 60_000;
  if (slotEnd.getTime() - slotStart.getTime() > maxSlotDurationMs) {
    throw new AppError(
      'Khung giờ thuê xe quá dài so với thời gian thi đấu',
      400,
      'CONTEST_SLOT_TOO_LONG',
    );
  }

  // Hold a short-lived lock on the chosen vehicle so concurrent contest-rental
  // requests do not pick the same unit before createBooking acquires the slot locks.
  const slotDurationMinutes =
    Number.isInteger(cafe.slotDurationMinutes) && cafe.slotDurationMinutes > 0
      ? cafe.slotDurationMinutes
      : Math.max(1, Math.ceil((slotEnd.getTime() - slotStart.getTime()) / 60000));
  const rentalSlotStarts = getSlotStarts(slotStart, slotEnd, slotDurationMinutes);
  const lockedRentalSlotStarts: Date[] = [];
  for (const rentalSlotStart of rentalSlotStarts) {
    const locked = await acquireContestRentalVehicleLock(vehicle.id, rentalSlotStart);
    if (!locked) {
      await releaseContestRentalVehicleLocks(vehicle.id, lockedRentalSlotStarts);
      throw new AppError(
        'Xe vừa được chọn bởi người khác, vui lòng chọn xe khác',
        409,
        'VEHICLE_UNAVAILABLE',
      );
    }
    lockedRentalSlotStarts.push(rentalSlotStart);
  }

  const bookingBody: CreateBookingBody = {
    cafe_id: slot.cafe_id,
    play_mode: BookingMode.RENTAL,
    slot_start:
      typeof slot.slot_start === 'string' ? slot.slot_start : slot.slot_start.toISOString(),
    slot_end: typeof slot.slot_end === 'string' ? slot.slot_end : slot.slot_end.toISOString(),
    vehicle_ids: [vehicle.id],
    participants: [],
    fnb_items: [],
    track_config_id: trackConfigId,
    track_type_id: trackTypeId ?? contest.trackTypeId ?? undefined,
    contest_id: contest.id,
    source: BookingSource.CONTEST,
  };

  try {
    const bookingResult = await createBooking(customerId, bookingBody);

    return {
      booking_id: bookingResult.booking_id,
      vehicle_id: vehicle.id,
      status: bookingResult.status,
      payment_expires_at: bookingResult.payment_expires_at,
      total_amount: bookingResult.total_amount,
      breakdown: {
        slot_fee: bookingResult.breakdown.slot_fee,
        rental_fee: bookingResult.breakdown.rental_fee,
        total: bookingResult.breakdown.total,
      },
    };
  } finally {
    await releaseContestRentalVehicleLocks(vehicle.id, lockedRentalSlotStarts);
  }
}

async function resolveContestRentalVehicle(
  slot: ContestRentalSlotInput,
  contestTrackTypeId?: string | null,
): Promise<Vehicle> {
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const catalogRepo = AppDataSource.getRepository(VehicleCatalog);

  let catalog: VehicleCatalog | null = null;
  if (slot.vehicle_catalog_id) {
    catalog = await catalogRepo.findOne({
      where: { id: slot.vehicle_catalog_id, cafeId: slot.cafe_id },
    });
    if (!catalog) {
      throw new AppError('Catalog xe không tồn tại', 404, 'VEHICLE_CATALOG_NOT_FOUND');
    }
  }

  if (catalog && contestTrackTypeId && catalog.compatibleTrackTypes.length > 0) {
    if (!catalog.compatibleTrackTypes.includes(contestTrackTypeId)) {
      throw new AppError(
        'Xe không tương thích với loại đường đua của contest',
        400,
        'VEHICLE_TRACK_INCOMPATIBLE',
      );
    }
  }

  if (catalog) {
    const vehicle = await vehicleRepo.findOne({
      where: {
        catalogId: catalog.id,
        cafeId: slot.cafe_id,
        status: VehicleStatus.AVAILABLE,
      },
    });
    if (!vehicle) {
      throw new AppError('Không có xe khả dụng cho catalog này', 400, 'VEHICLE_UNAVAILABLE');
    }
    return vehicle;
  }

  // If no catalog specified, pick any available vehicle at the cafe.
  const vehicle = await vehicleRepo.findOne({
    where: { cafeId: slot.cafe_id, status: VehicleStatus.AVAILABLE },
  });
  if (!vehicle) {
    throw new AppError('Không có xe thuê khả dụng tại chi nhánh này', 400, 'VEHICLE_UNAVAILABLE');
  }
  return vehicle;
}

// ── Contest ↔ Session lifecycle sync (vehicle check-in / checkout bridge) ───

export interface ContestCheckinSyncResult {
  registrationId: string | null;
  synced: boolean;
  previousStatus: ContestRegistrationStatus | null;
}

function contestRegistrationRepo(em?: EntityManager) {
  return em
    ? em.getRepository(ContestRegistration)
    : AppDataSource.getRepository(ContestRegistration);
}

function contestAuditLogRepo(em?: EntityManager) {
  return em ? em.getRepository(ContestAuditLog) : AppDataSource.getRepository(ContestAuditLog);
}

/**
 * When a contest rental booking is checked in at the cafe, mirror the linked
 * contest registration to CHECKED_IN (same semantics as checkInRegistration in
 * contest.service). Never blocks the vehicle check-in: missing registrations or
 * unexpected statuses are skipped with a log entry only.
 */
export async function syncContestRegistrationOnVehicleCheckIn(
  booking: Pick<Booking, 'id' | 'contestId' | 'cafeId'>,
  staffContext: { staffUserId: string },
  em?: EntityManager,
): Promise<ContestCheckinSyncResult | null> {
  if (!booking.contestId) return null;

  const registration = await contestRegistrationRepo(em).findOne({
    where: { bookingId: booking.id },
  });
  if (!registration) {
    logger.warn('ContestRental', 'syncContestRegistrationOnVehicleCheckIn: no registration', {
      bookingId: booking.id,
      contestId: booking.contestId,
    });
    return { registrationId: null, synced: false, previousStatus: null };
  }

  const previousStatus = registration.status;
  if (previousStatus === ContestRegistrationStatus.CHECKED_IN) {
    return { registrationId: registration.id, synced: false, previousStatus };
  }
  if (previousStatus !== ContestRegistrationStatus.CONFIRMED) {
    logger.warn('ContestRental', 'syncContestRegistrationOnVehicleCheckIn: status not CONFIRMED', {
      bookingId: booking.id,
      registrationId: registration.id,
      status: previousStatus,
    });
    return { registrationId: registration.id, synced: false, previousStatus };
  }

  registration.status = ContestRegistrationStatus.CHECKED_IN;
  registration.checkedInCafeId = booking.cafeId;
  registration.checkedInBy = staffContext.staffUserId;
  registration.checkedInAt = new Date();
  await contestRegistrationRepo(em).save(registration);

  const auditRepo = contestAuditLogRepo(em);
  await auditRepo.save(
    auditRepo.create({
      contestId: booking.contestId,
      registrationId: registration.id,
      actorId: staffContext.staffUserId,
      actorRole: 'STAFF',
      eventType: 'registration.checked_in',
      beforeJson: { status: previousStatus },
      afterJson: { status: registration.status, checkedInCafeId: booking.cafeId },
      metadata: { booking_id: booking.id, trigger: 'vehicle_check_in' },
    }),
  );

  return { registrationId: registration.id, synced: true, previousStatus };
}

/** Writes a contest audit log entry when a contest rental vehicle is checked out. */
export async function logContestVehicleCheckedOut(
  booking: Pick<Booking, 'id' | 'contestId'>,
  session: { id: string },
  em?: EntityManager,
): Promise<void> {
  if (!booking.contestId) return;

  const registration = await contestRegistrationRepo(em).findOne({
    where: { bookingId: booking.id },
  });

  const auditRepo = contestAuditLogRepo(em);
  await auditRepo.save(
    auditRepo.create({
      contestId: booking.contestId,
      registrationId: registration?.id ?? null,
      actorRole: 'STAFF',
      eventType: 'booking.vehicle_checked_out',
      metadata: {
        booking_id: booking.id,
        session_id: session.id,
        registration_id: registration?.id ?? null,
      },
    }),
  );
}

export async function getContestRentalOptions(contestId: string): Promise<ContestRentalOptions> {
  const contestCafes = await AppDataSource.getRepository(ContestCafe).find({
    where: { contestId },
    order: { displayOrder: 'ASC' },
  });
  const cafeIds = contestCafes.map((item) => item.cafeId);

  const cafes = await AppDataSource.getRepository(Cafe).find({
    where: cafeIds.map((id) => ({ id })),
  });

  const trackConfigs = await AppDataSource.getRepository(CafeTrackConfig).find({
    where: cafeIds.map((id) => ({ cafeId: id, isActive: true })),
  });

  const catalogs = await AppDataSource.getRepository(VehicleCatalog).find({
    where: cafeIds.map((id) => ({ cafeId: id })),
  });

  const trackConfigRows = trackConfigs.map((item) => ({
    id: item.id,
    cafe_id: item.cafeId,
    track_type_id: item.trackTypeId,
    track_type_name: null, // populated by caller if needed
    max_concurrent: item.maxConcurrent,
  }));

  return {
    cafes: cafes.map((item) => ({
      id: item.id,
      name: item.name,
      city: item.city ?? null,
      district: item.district ?? null,
    })),
    track_configs: trackConfigRows,
    vehicle_catalogs: catalogs.map((item) => ({
      id: item.id,
      cafe_id: item.cafeId,
      name: item.name,
      tier: item.tier,
      hourly_rate: Number(item.hourlyRate),
      cover_image_url: item.coverImageUrl ?? null,
      compatible_track_types: item.compatibleTrackTypes,
    })),
  };
}

export async function getContestAvailableRentalVehicles(
  contestId: string,
  slot: ContestRentalSlotInput,
): Promise<
  Array<{
    catalog_id: string;
    catalog_name: string;
    tier: string;
    hourly_rate: number;
    cover_image_url: string | null;
    available_units: Array<{ id: string; identifier: string | null; color: string | null }>;
  }>
> {
  const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
    where: { contestId, cafeId: slot.cafe_id },
  });
  if (!contestCafe) {
    throw new AppError('Chi nhánh không tham gia contest', 400, 'CONTEST_CAFE_INVALID');
  }

  const slotStart = new Date(slot.slot_start);
  const slotEnd = new Date(slot.slot_end);

  const catalogs = await AppDataSource.getRepository(VehicleCatalog).find({
    where: { cafeId: slot.cafe_id },
  });
  const vehicles = await AppDataSource.getRepository(Vehicle).find({
    where: { cafeId: slot.cafe_id, status: VehicleStatus.AVAILABLE },
  });

  const bookedVehicleIds = new Set(
    (
      await AppDataSource.query<{ vehicle_id: string }[]>(
        `SELECT DISTINCT bv.vehicle_id
         FROM booking_vehicles bv
         JOIN bookings b ON b.id = bv.booking_id
         WHERE b.cafe_id = $1
           AND b.play_mode = $2
           AND b.status IN ($3, $4)
           AND b.slot_start < $5
           AND b.slot_end > $6`,
        [
          slot.cafe_id,
          BookingMode.RENTAL,
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          slotEnd,
          slotStart,
        ],
      )
    ).map((row) => row.vehicle_id),
  );

  return catalogs.map((catalog) => ({
    catalog_id: catalog.id,
    catalog_name: catalog.name,
    tier: catalog.tier,
    hourly_rate: Number(catalog.hourlyRate),
    cover_image_url: catalog.coverImageUrl ?? null,
    available_units: vehicles
      .filter((vehicle) => vehicle.catalogId === catalog.id && !bookedVehicleIds.has(vehicle.id))
      .map((vehicle) => ({
        id: vehicle.id,
        identifier: vehicle.identifier,
        color: vehicle.color,
      })),
  }));
}

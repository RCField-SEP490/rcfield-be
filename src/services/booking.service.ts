import { AppDataSource } from '../config/database';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Booking } from '../models/booking.entity';
import { BookingParticipant } from '../models/booking-participant.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { FnbOrder } from '../models/fnb-order.entity';
import { FnbOrderItem } from '../models/fnb-order-item.entity';
import { Cafe } from '../models/cafe.entity';
import { Vehicle } from '../models/vehicle.entity';
import { VehicleCatalog } from '../models/vehicle-catalog.entity';
import { MenuItem } from '../models/menu-item.entity';
import { CafeTrackConfig } from '../models/cafe-track-config.entity';
import { TrackType } from '../models/track-type.entity';
import {
  AppError,
  BookingMode,
  BookingParticipantType,
  BookingSource,
  BookingStatus,
  CustomerPackageStatus,
  FnbOrderStatus,
  FnbOrderType,
  UserRole,
  VehicleStatus,
} from '../types';
import { CustomerPackage } from '../models/customer-package.entity';
import { refundSlots } from './customer-package.service';
import { getEffectiveMultiplier } from './pricing.service';
import { validatePromoCode } from './promotion.service';
import type { Promotion } from '../models/promotion.entity';

// ── State machine ─────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<BookingStatus, string[]> = {
  [BookingStatus.PENDING]: ['PAYMENT_CONFIRMED', 'PAYMENT_TIMEOUT'],
  [BookingStatus.CONFIRMED]: ['CUSTOMER_CANCEL', 'PROVIDER_CANCEL', 'NO_SHOW', 'COMPLETE'],
  [BookingStatus.AWAITING_PAYMENT]: ['PAYMENT_SETTLED'],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.NO_SHOW]: [],
  [BookingStatus.COMPLETED]: [],
};

/** Pure function — exported for unit tests (Constitution Principle V) */
export function canTransition(current: BookingStatus, event: string): boolean {
  return VALID_TRANSITIONS[current]?.includes(event) ?? false;
}

function eventToStatus(event: string): BookingStatus {
  switch (event) {
    case 'PAYMENT_CONFIRMED':
      return BookingStatus.CONFIRMED;
    case 'PAYMENT_TIMEOUT':
    case 'CUSTOMER_CANCEL':
    case 'PROVIDER_CANCEL':
      return BookingStatus.CANCELLED;
    case 'NO_SHOW':
      return BookingStatus.NO_SHOW;
    case 'PAYMENT_SETTLED':
    case 'COMPLETE':
      return BookingStatus.COMPLETED;
    default:
      throw new AppError(`Unknown booking event: ${event}`, 400, 'INVALID_BOOKING_EVENT');
  }
}

// ── Redis slot locking ────────────────────────────────────────────────────────

function vehicleLockKey(vehicleId: string, slotStart: Date): string {
  return `slot:lock:vehicle:${vehicleId}:${slotStart.getTime()}`;
}

function byocCounterKey(cafeId: string, slotStart: Date, trackConfigId?: string | null): string {
  return trackConfigId
    ? `slot:byoc:${cafeId}:${trackConfigId}:${slotStart.getTime()}`
    : `slot:byoc:${cafeId}:${slotStart.getTime()}`;
}

async function acquireVehicleLock(
  vehicleId: string,
  slotStart: Date,
  bookingId: string,
): Promise<boolean> {
  const key = vehicleLockKey(vehicleId, slotStart);
  const result = await redis.set(key, bookingId, 'EX', env.platform.slotLockTtlSeconds, 'NX');
  return result === 'OK';
}

async function releaseVehicleLocks(vehicleIds: string[], slotStart: Date): Promise<void> {
  const keys = vehicleIds.map((id) => vehicleLockKey(id, slotStart));
  if (keys.length > 0) {
    await redis.del(keys);
  }
}

async function acquireByocSlot(
  cafeId: string,
  slotStart: Date,
  capacity: number,
  count: number,
  trackConfigId?: string | null,
): Promise<boolean> {
  const key = byocCounterKey(cafeId, slotStart, trackConfigId);
  const next = await redis.incrby(key, count);
  await redis.expire(key, env.platform.slotLockTtlSeconds);
  if (next > capacity) {
    await redis.decrby(key, count);
    return false;
  }
  return true;
}

async function releaseByocSlot(
  cafeId: string,
  slotStart: Date,
  count: number,
  trackConfigId?: string | null,
): Promise<void> {
  const key = byocCounterKey(cafeId, slotStart, trackConfigId);
  const current = Number((await redis.get(key)) ?? 0);
  if (current > 0) {
    await redis.set(
      key,
      String(Math.max(0, current - count)),
      'EX',
      env.platform.slotLockTtlSeconds,
    );
  }
}

// ── transition ────────────────────────────────────────────────────────────────

/** All booking status changes MUST go through this function (Constitution Principle II) */
export async function transition(bookingId: string, event: string): Promise<Booking> {
  const repo = AppDataSource.getRepository(Booking);
  const booking = await repo.findOne({ where: { id: bookingId } });

  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
  if (!canTransition(booking.status, event)) {
    throw new AppError(
      `Cannot transition booking from ${booking.status} via ${event}`,
      400,
      'INVALID_BOOKING_STATE',
    );
  }

  const newStatus = eventToStatus(event);
  await repo.update(bookingId, { status: newStatus });

  if (newStatus === BookingStatus.CANCELLED) {
    const bvRepo = AppDataSource.getRepository(BookingVehicle);
    const vehicles = await bvRepo.find({ where: { bookingId } });
    const vehicleIds = vehicles.map((v) => v.vehicleId);
    await releaseVehicleLocks(vehicleIds, booking.slotStart);
    if (booking.playMode === BookingMode.BYOC) {
      const participantCount = await AppDataSource.getRepository(BookingParticipant).count({
        where: { bookingId },
      });
      await releaseByocSlot(
        booking.cafeId,
        booking.slotStart,
        participantCount || 1,
        booking.trackConfigId,
      );
    }
    await cancelPendingFnbOrders(bookingId);
    logger.info('BookingService', `transition → CANCELLED bookingId=${bookingId}`);
  }

  if (newStatus === BookingStatus.COMPLETED) {
    if (booking.playMode === BookingMode.BYOC) {
      const participantCount = await AppDataSource.getRepository(BookingParticipant).count({
        where: { bookingId },
      });
      await releaseByocSlot(
        booking.cafeId,
        booking.slotStart,
        participantCount || 1,
        booking.trackConfigId,
      );
    }
    logger.info('BookingService', `transition → COMPLETED bookingId=${bookingId}`);
  }

  if (newStatus === BookingStatus.NO_SHOW) {
    await cancelPendingFnbOrders(bookingId);
    logger.info('BookingService', `transition → NO_SHOW bookingId=${bookingId}`);
  }

  booking.status = newStatus;
  return booking;
}

// ── createBooking ─────────────────────────────────────────────────────────────

export interface ParticipantInput {
  user_id?: string;
  participant_type: BookingParticipantType;
  guest_name?: string;
  guest_phone?: string;
}

export interface FnbItemInput {
  menu_item_id: string;
  quantity: number;
  notes?: string;
}

export interface CreateBookingBody {
  cafe_id: string;
  play_mode: BookingMode;
  slot_start: string;
  slot_end: string;
  vehicle_ids: string[];
  participants: ParticipantInput[];
  fnb_items: FnbItemInput[];
  promotion_code?: string;
  track_type_id?: string;
  track_config_id?: string;
  customer_package_id?: string;
}

export interface BookingBreakdown {
  slot_fee: number;
  slot_fee_base: number;
  slot_fee_multiplier: number;
  pricing_rule_label: string | null;
  rental_fee: number;
  security_deposit: number;
  fnb_total: number;
  discount: number;
  total: number;
}

export interface CreateBookingResult {
  booking_id: string;
  status: BookingStatus;
  payment_expires_at: Date;
  total_amount: number;
  breakdown: BookingBreakdown;
}

export async function createBooking(
  customerId: string,
  body: CreateBookingBody,
): Promise<CreateBookingResult> {
  const slotStart = new Date(body.slot_start);
  const slotEnd = new Date(body.slot_end);

  if (slotStart >= slotEnd) {
    throw new AppError('slot_start must be before slot_end', 400, 'INVALID_SLOT');
  }

  if (slotStart <= new Date()) {
    throw new AppError('Cannot book a slot in the past', 400, 'SLOT_IN_PAST');
  }

  // Duplicate booking guard
  const bookingRepo = AppDataSource.getRepository(Booking);
  const existingBooking = await bookingRepo.findOne({
    where: {
      customerId,
      cafeId: body.cafe_id,
      slotStart,
      status: BookingStatus.PENDING,
    },
  });
  if (existingBooking) {
    if (existingBooking.paymentExpiresAt > new Date()) {
      return {
        booking_id: existingBooking.id,
        status: BookingStatus.PENDING,
        payment_expires_at: existingBooking.paymentExpiresAt,
        total_amount: Number(
          (existingBooking.snapshot as { total_charged?: number } | null)?.total_charged ?? 0,
        ),
        breakdown: {
          slot_fee: 0,
          slot_fee_base: 0,
          slot_fee_multiplier: 1,
          pricing_rule_label: null,
          rental_fee: 0,
          security_deposit: 0,
          fnb_total: 0,
          discount: Number(existingBooking.discountAmount),
          total: Number(
            (existingBooking.snapshot as { total_charged?: number } | null)?.total_charged ?? 0,
          ),
        },
      };
    }

    await transition(existingBooking.id, 'PAYMENT_TIMEOUT');
  }

  const cafeRepo = AppDataSource.getRepository(Cafe);
  const cafe = await cafeRepo.findOne({ where: { id: body.cafe_id } });
  if (!cafe) throw new AppError('Cafe not found', 404, 'CAFE_NOT_FOUND');
  if (cafe.status !== 'ACTIVE') throw new AppError('Cafe is not active', 400, 'CAFE_NOT_ACTIVE');

  const slotDuration = cafe.slotDurationMinutes;
  const slotMinutes = (slotEnd.getTime() - slotStart.getTime()) / 60000;

  // Slot range validation: must be aligned with slotDurationMinutes and ≤ 8 slots
  if (slotMinutes % slotDuration !== 0) {
    throw new AppError(
      `Slot range must be a multiple of ${slotDuration} minutes`,
      400,
      'INVALID_SLOT_RANGE',
    );
  }
  if (slotMinutes > slotDuration * 8) {
    throw new AppError(
      `Maximum booking duration is ${slotDuration * 8} minutes`,
      400,
      'SLOT_RANGE_TOO_LONG',
    );
  }
  const slotCount = slotMinutes / cafe.slotDurationMinutes;
  const slotsNeeded = Math.ceil(slotMinutes / cafe.slotDurationMinutes);
  const playerCount = 1 + (body.participants?.length ?? 0); // booker + companions

  // Validate customer package if provided (T021)
  let customerPackage: CustomerPackage | null = null;
  if (body.customer_package_id) {
    const cpRepo = AppDataSource.getRepository(CustomerPackage);
    customerPackage = await cpRepo.findOne({ where: { id: body.customer_package_id } });
    if (!customerPackage) {
      throw new AppError('Package not found', 404, 'CUSTOMER_PACKAGE_NOT_FOUND');
    }
    if (customerPackage.customerId !== customerId) {
      throw new AppError('Package not owned by this customer', 403, 'CUSTOMER_PACKAGE_NOT_FOUND');
    }
    if (customerPackage.cafeId !== body.cafe_id) {
      throw new AppError('Package is for a different cafe', 400, 'PACKAGE_CAFE_MISMATCH');
    }
    if (customerPackage.status !== CustomerPackageStatus.ACTIVE) {
      throw new AppError('Package is not active', 400, 'PACKAGE_EXPIRED');
    }
    if (customerPackage.expiresAt < new Date()) {
      throw new AppError('Package has expired', 400, 'PACKAGE_EXPIRED');
    }
    if (customerPackage.slotsRemaining < slotsNeeded) {
      throw new AppError('Package has insufficient slots', 400, 'PACKAGE_INSUFFICIENT_SLOTS');
    }
    // Load Package template to check applicable_play_modes
    const { Package: PackageEntity } = await import('../models/package.entity');
    const pkg = await AppDataSource.getRepository(PackageEntity).findOne({
      where: { id: customerPackage.packageId },
    });
    if (
      pkg &&
      pkg.applicablePlayModes.length > 0 &&
      !pkg.applicablePlayModes.includes(body.play_mode)
    ) {
      throw new AppError(
        'Package does not apply to this play mode',
        400,
        'PACKAGE_PLAY_MODE_MISMATCH',
      );
    }
  }

  // Dynamic pricing lookup — multiplier frozen at booking creation time (snapshot-first)
  const { multiplier: slotMultiplier, label: pricingLabel } = await getEffectiveMultiplier(
    body.cafe_id,
    slotStart,
  );

  const baseSlotFeeRate = Number(cafe.slotFeeRate) * slotMultiplier;
  const rawSlotFee = baseSlotFeeRate * slotCount * playerCount;
  // Package covers only the booker's slot fee (1 person). Companions still pay.
  const slotFee = customerPackage
    ? baseSlotFeeRate * slotCount * Math.max(0, playerCount - 1)
    : rawSlotFee;

  let rentalFeeTotal = 0;
  const depositTotal = 0;
  const vehiclePricings: Array<{
    vehicleId: string;
    hourlyRate: number;
    rentalFee: number;
    securityDeposit: number;
    damageMultiplier: number;
  }> = [];

  if (body.play_mode === BookingMode.RENTAL) {
    if (!body.vehicle_ids.length) {
      throw new AppError('vehicle_ids required for RENTAL mode', 400, 'VEHICLE_REQUIRED');
    }

    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const catalogRepo = AppDataSource.getRepository(VehicleCatalog);

    for (const vehicleId of body.vehicle_ids) {
      // Accept either a unit ID or a catalog ID — if catalog, auto-pick an available unit
      let vehicle = await vehicleRepo.findOne({ where: { id: vehicleId, cafeId: body.cafe_id } });
      const catalog = vehicle
        ? await catalogRepo.findOne({ where: { id: vehicle.catalogId } })
        : await catalogRepo.findOne({ where: { id: vehicleId, cafeId: body.cafe_id } });

      if (!vehicle) {
        if (!catalog)
          throw new AppError(`Vehicle ${vehicleId} not found`, 404, 'VEHICLE_NOT_FOUND');
        vehicle = await vehicleRepo.findOne({
          where: { catalogId: catalog.id, cafeId: body.cafe_id, status: VehicleStatus.AVAILABLE },
        });
        if (!vehicle)
          throw new AppError(
            `No available unit for catalog ${catalog.id}`,
            400,
            'VEHICLE_UNAVAILABLE',
          );
      } else if (vehicle.status !== VehicleStatus.AVAILABLE) {
        throw new AppError(`Vehicle ${vehicleId} is not available`, 400, 'VEHICLE_UNAVAILABLE');
      }

      if (!catalog) throw new AppError('Vehicle catalog not found', 500, 'CATALOG_NOT_FOUND');

      const hourlyRate = Number(catalog.hourlyRate);
      const rentalFee = hourlyRate * (slotMinutes / 60);
      rentalFeeTotal += rentalFee;
      vehiclePricings.push({
        vehicleId: vehicle.id,
        hourlyRate,
        rentalFee,
        securityDeposit: 0,
        damageMultiplier: Number(catalog.damageMultiplier),
      });
    }
  }

  // Resolve track config (required for new bookings; optional for legacy compat)
  let resolvedTrackConfig: CafeTrackConfig | null = null;
  let resolvedTrackType: TrackType | null = null;
  if (body.track_config_id) {
    resolvedTrackConfig = await AppDataSource.getRepository(CafeTrackConfig).findOne({
      where: { id: body.track_config_id, cafeId: body.cafe_id, isActive: true },
    });
    if (!resolvedTrackConfig || resolvedTrackConfig.deletedAt) {
      throw new AppError('Track config not found or inactive', 400, 'TRACK_CONFIG_NOT_FOUND');
    }
    resolvedTrackType = await AppDataSource.getRepository(TrackType).findOne({
      where: { id: resolvedTrackConfig.trackTypeId },
    });
  }

  if (body.play_mode === BookingMode.BYOC) {
    const capacity = resolvedTrackConfig ? resolvedTrackConfig.byocCapacity : cafe.byocCapacity;
    const locked = await acquireByocSlot(
      body.cafe_id,
      slotStart,
      capacity,
      playerCount,
      resolvedTrackConfig?.id,
    );
    if (!locked) throw new AppError('BYOC capacity full for this slot', 400, 'BYOC_CAPACITY_FULL');
  }

  // Validate vehicle compat with track type for RENTAL
  if (body.play_mode === BookingMode.RENTAL && resolvedTrackConfig) {
    const catalogRepo = AppDataSource.getRepository(VehicleCatalog);
    for (const vehicleId of body.vehicle_ids) {
      // vehicleId may be a unit ID or catalog ID
      const unit = await AppDataSource.getRepository(Vehicle).findOne({ where: { id: vehicleId } });
      const catalog = unit
        ? await catalogRepo.findOne({ where: { id: unit.catalogId } })
        : await catalogRepo.findOne({ where: { id: vehicleId } });
      if (
        catalog &&
        catalog.compatibleTrackTypes.length > 0 &&
        !catalog.compatibleTrackTypes.includes(resolvedTrackConfig.trackTypeId)
      ) {
        throw new AppError(
          `Vehicle ${vehicleId} is not compatible with this track type`,
          400,
          'VEHICLE_TRACK_INCOMPATIBLE',
        );
      }
    }
  }

  let fnbTotal = 0;
  const fnbPricings: Array<{
    menuItemId: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    notes?: string;
  }> = [];
  if (body.fnb_items.length > 0) {
    const menuRepo = AppDataSource.getRepository(MenuItem);
    for (const item of body.fnb_items) {
      const menuItem = await menuRepo.findOne({ where: { id: item.menu_item_id } });
      if (!menuItem || !menuItem.isAvailable) {
        throw new AppError(
          `Menu item ${item.menu_item_id} not available`,
          400,
          'MENU_ITEM_UNAVAILABLE',
        );
      }
      const unitPrice = Number(menuItem.price);
      const subtotal = unitPrice * item.quantity;
      fnbTotal += subtotal;
      fnbPricings.push({
        menuItemId: item.menu_item_id,
        quantity: item.quantity,
        unitPrice,
        subtotal,
        notes: item.notes,
      });
    }
  }

  const totalAmount = slotFee + rentalFeeTotal + depositTotal + fnbTotal;

  // Promo code validation — discount applies to slot_fee + rental_fee only
  let discountAmount = 0;
  let appliedPromotion: Promotion | undefined;
  if (body.promotion_code) {
    const promoSubtotal = slotFee + rentalFeeTotal;
    const promoResult = await validatePromoCode({
      cafeId: body.cafe_id,
      code: body.promotion_code,
      customerId,
      subtotal: promoSubtotal,
      playMode: body.play_mode,
      slotStart,
    });
    discountAmount = promoResult.discountAmount;
    appliedPromotion = promoResult.promotion;
  }
  const discountedTotal = Math.max(0, totalAmount - discountAmount);

  const paymentExpiresAt = new Date(Date.now() + env.platform.paymentWindowMinutes * 60 * 1000);

  // Acquire Redis slot locks for RENTAL vehicles
  const lockedVehicleIds: string[] = [];
  if (body.play_mode === BookingMode.RENTAL) {
    for (const { vehicleId } of vehiclePricings) {
      const locked = await acquireVehicleLock(vehicleId, slotStart, 'pending');
      if (!locked) {
        await releaseVehicleLocks(lockedVehicleIds, slotStart);
        throw new AppError(
          `Vehicle ${vehicleId} is already locked for this slot`,
          409,
          'SLOT_LOCKED',
        );
      }
      lockedVehicleIds.push(vehicleId);
    }
  }

  try {
    const booking = await AppDataSource.transaction(async (em) => {
      // Determine track_type_id: prefer from track config, fall back to legacy field or cafe default
      const trackTypeId =
        resolvedTrackConfig?.trackTypeId ?? body.track_type_id ?? cafe.trackTypes?.[0];
      if (!trackTypeId) {
        throw new AppError('Cafe has no track types configured', 400, 'NO_TRACK_TYPE');
      }

      const snapshot: Record<string, unknown> = resolvedTrackConfig
        ? {
            track_config_id: resolvedTrackConfig.id,
            track_type_id: resolvedTrackConfig.trackTypeId,
            track_type_code: resolvedTrackType?.code ?? null,
            track_type_name: resolvedTrackType?.name ?? null,
            byoc_capacity_at_booking: resolvedTrackConfig.byocCapacity,
          }
        : {};

      // Write package_used into snapshot before saving (Constitution Principle I)
      if (customerPackage) {
        snapshot.package_used = {
          customer_package_id: customerPackage.id,
          package_id: customerPackage.packageId,
          package_name: customerPackage.packageNameSnapshot,
          slots_used: slotsNeeded,
        };
      }

      // Freeze dynamic pricing at booking creation time (snapshot-first, immutable)
      snapshot.slot_fee_multiplier = slotMultiplier;
      snapshot.pricing_rule_label = pricingLabel;

      if (appliedPromotion) {
        snapshot.promotion_applied = {
          promotion_id: appliedPromotion.id,
          code: appliedPromotion.code,
          discount_amount: discountAmount,
          discount_type: appliedPromotion.discountType,
        };
      }

      const newBooking = em.create(Booking, {
        customerId,
        cafeId: body.cafe_id,
        trackTypeId,
        trackConfigId: resolvedTrackConfig?.id ?? null,
        playMode: body.play_mode,
        source: BookingSource.APP,
        status: BookingStatus.PENDING,
        slotStart,
        slotEnd,
        paymentExpiresAt,
        discountAmount,
        promotionId: appliedPromotion?.id ?? null,
        customerPackageId: customerPackage?.id ?? null,
        snapshot: Object.keys(snapshot).length > 0 ? snapshot : null,
      });
      await em.save(newBooking);

      // Primary participant = customer (BOOKER)
      const primaryParticipant = em.create(BookingParticipant, {
        bookingId: newBooking.id,
        userId: customerId,
        participantType: BookingParticipantType.BOOKER,
        isPrimaryResponsible: true,
      });
      await em.save(primaryParticipant);

      // Additional participants
      for (const p of body.participants) {
        const participant = em.create(BookingParticipant, {
          bookingId: newBooking.id,
          userId: p.user_id ?? null,
          participantType: p.participant_type,
          isPrimaryResponsible: false,
          guestName: p.guest_name ?? null,
          guestPhone: p.guest_phone ?? null,
        });
        await em.save(participant);
      }

      // Booking vehicles
      for (const vp of vehiclePricings) {
        const bv = em.create(BookingVehicle, {
          bookingId: newBooking.id,
          vehicleId: vp.vehicleId,
          hourlyRateSnapshot: vp.hourlyRate,
          rentalFeeSnapshot: vp.rentalFee,
          securityDepositSnapshot: vp.securityDeposit,
          damageMultiplierSnapshot: vp.damageMultiplier,
        });
        await em.save(bv);
      }

      // F&B order
      if (fnbPricings.length > 0) {
        const fnbOrder = em.create(FnbOrder, {
          bookingId: newBooking.id,
          orderType: FnbOrderType.PRE_ORDER,
          totalAmount: fnbTotal,
          status: FnbOrderStatus.PENDING,
        });
        await em.save(fnbOrder);

        for (const fp of fnbPricings) {
          const item = em.create(FnbOrderItem, {
            fnbOrderId: fnbOrder.id,
            menuItemId: fp.menuItemId,
            quantity: fp.quantity,
            unitPrice: fp.unitPrice,
            subtotal: fp.subtotal,
            notes: fp.notes ?? null,
          });
          await em.save(item);
        }
      }

      return newBooking;
    });

    // Update slot locks with actual booking ID
    if (body.play_mode === BookingMode.RENTAL) {
      for (const vehicleId of lockedVehicleIds) {
        await redis.set(
          vehicleLockKey(vehicleId, slotStart),
          booking.id,
          'EX',
          env.platform.slotLockTtlSeconds,
        );
      }
    }

    logger.info('BookingService', `created bookingId=${booking.id} mode=${body.play_mode}`);

    return {
      booking_id: booking.id,
      status: BookingStatus.PENDING,
      payment_expires_at: paymentExpiresAt,
      total_amount: discountedTotal,
      breakdown: {
        slot_fee: slotFee,
        slot_fee_base: Number(cafe.slotFeeRate) * slotCount * playerCount,
        slot_fee_multiplier: slotMultiplier,
        pricing_rule_label: pricingLabel,
        rental_fee: rentalFeeTotal,
        security_deposit: depositTotal,
        fnb_total: fnbTotal,
        discount: discountAmount,
        total: discountedTotal,
      },
    };
  } catch (err) {
    // Release locks on transaction failure
    await releaseVehicleLocks(lockedVehicleIds, slotStart);
    if (body.play_mode === BookingMode.BYOC) {
      await releaseByocSlot(body.cafe_id, slotStart, playerCount, resolvedTrackConfig?.id);
    }
    throw err;
  }
}

// ── cancelBooking ─────────────────────────────────────────────────────────────

export async function cancelBooking(
  bookingId: string,
  cancelledBy: string,
  role: UserRole,
  reason?: string,
): Promise<{ refund_amount: number }> {
  const repo = AppDataSource.getRepository(Booking);
  const booking = await repo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new AppError('Only CONFIRMED bookings can be cancelled', 400, 'BOOKING_NOT_CONFIRMED');
  }

  if (role === UserRole.CUSTOMER && booking.customerId !== cancelledBy) {
    throw new AppError('Access denied', 403, 'NOT_BOOKING_OWNER');
  }

  await repo.update(bookingId, {
    status: BookingStatus.CANCELLED,
    cancelledBy,
    cancelledAt: new Date(),
    cancellationReason: reason ?? null,
  });

  // Release slot locks
  const bvRepo = AppDataSource.getRepository(BookingVehicle);
  const vehicles = await bvRepo.find({ where: { bookingId } });
  await releaseVehicleLocks(
    vehicles.map((v) => v.vehicleId),
    booking.slotStart,
  );
  if (booking.playMode === BookingMode.BYOC) {
    const participantCount = await AppDataSource.getRepository(BookingParticipant).count({
      where: { bookingId },
    });
    await releaseByocSlot(
      booking.cafeId,
      booking.slotStart,
      participantCount || 1,
      booking.trackConfigId,
    );
  }

  await cancelPendingFnbOrders(bookingId);
  logger.info('BookingService', `cancelled bookingId=${bookingId} by ${role}`);

  // Slot refund: only if package was used AND cancellation is before slot_start (D5 from research.md)
  const snapshotData = booking.snapshot as {
    package_used?: { customer_package_id: string; slots_used: number };
  } | null;
  if (snapshotData?.package_used && booking.slotStart > new Date()) {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await refundSlots(
        snapshotData.package_used.customer_package_id,
        snapshotData.package_used.slots_used,
        qr,
      );
      await qr.commitTransaction();
      logger.info(
        'BookingService',
        `slot refund applied bookingId=${bookingId} slots=${snapshotData.package_used.slots_used}`,
      );
    } catch (err) {
      await qr.rollbackTransaction();
      logger.error('BookingService', `slot refund failed bookingId=${bookingId}`, err);
    } finally {
      await qr.release();
    }
  }

  // Return placeholder — PaymentService.processRefund handles actual amount
  return { refund_amount: 0 };
}

// ── listCafeBookings ──────────────────────────────────────────────────────────

export interface ListCafeBookingsQuery {
  date: string;
  status?: BookingStatus;
  page: number;
  limit: number;
}

export async function listCafeBookings(
  cafeId: string,
  query: ListCafeBookingsQuery,
): Promise<{ data: object[]; total: number; page: number; limit: number }> {
  const dayStart = new Date(`${query.date}T00:00:00+07:00`);
  const dayEnd = new Date(`${query.date}T23:59:59+07:00`);

  let qb = AppDataSource.createQueryBuilder(Booking, 'b')
    .innerJoin('users', 'u', 'u.id = b.customer_id')
    .select([
      'b.id',
      'u.full_name AS customer_name',
      'u.phone AS customer_phone',
      'b.play_mode',
      'b.status',
      'b.slot_start',
      'b.slot_end',
      'b.discount_amount',
      'b.created_at',
    ])
    .where('b.cafe_id = :cafeId', { cafeId })
    .andWhere('b.slot_start >= :dayStart', { dayStart })
    .andWhere('b.slot_start <= :dayEnd', { dayEnd })
    .andWhere('b.deleted_at IS NULL')
    .orderBy('b.slot_start', 'ASC')
    .skip((query.page - 1) * query.limit)
    .take(query.limit);

  if (query.status) {
    qb = qb.andWhere('b.status = :status', { status: query.status });
  }

  const [raw, total] = await Promise.all([qb.getRawMany(), qb.getCount()]);
  return { data: raw, total, page: query.page, limit: query.limit };
}

async function cancelPendingFnbOrders(bookingId: string): Promise<void> {
  await AppDataSource.query(
    `UPDATE fnb_orders
     SET status = 'CANCELLED'
     WHERE booking_id = $1
       AND status IN ('PENDING', 'CONFIRMED')`,
    [bookingId],
  );
}

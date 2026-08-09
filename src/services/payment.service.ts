import { AppDataSource } from '../config/database';
import { In } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Booking } from '../models/booking.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { BookingParticipant } from '../models/booking-participant.entity';
import { Cafe } from '../models/cafe.entity';
import { Contest } from '../models/contest.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { FnbOrder } from '../models/fnb-order.entity';
import { PaymentComponent } from '../models/payment-component.entity';
import { PaymentTransaction } from '../models/payment-transaction.entity';
import { Session } from '../models/session.entity';
import {
  AppError,
  BookingSource,
  BookingStatus,
  FnbOrderStatus,
  FnbOrderType,
  PaymentComponentStatus,
  PaymentComponentType,
  PaymentTransactionStatus,
  PaymentTransactionSubjectType,
  PaymentTransactionType,
  SessionStatus,
  UserRole,
  NotificationType,
  ContestEntryFeePaymentStatus,
} from '../types';
import { broadcastBookingUpdated, transition } from './booking.service';
import { emailService } from './email.service';
import { activateCustomerPackage, deductSlots } from './customer-package.service';
import { incrementPromoUsesCount } from './promotion.service';
import { wsService } from './websocket.service';
import { createNotification } from './notification.service';
import { writeContestAudit } from './contest.helpers';
import {
  autoConfirmRentalRegistration,
  sendContestRegistrationStatusNotification,
} from './contest/registration-side-effects';
import {
  applyContestRentalPricing,
  getContestRentalPolicy,
  type ContestPricingAdjustments,
} from './contest-rental.service';
import { getPaymentGateway } from './payment-gateway.factory';
import type { PaymentVerificationResult } from './payment-gateway.interface';

async function pushBookingNew(booking: Booking): Promise<void> {
  try {
    const cafe = await AppDataSource.getRepository(Cafe).findOne({
      where: { id: booking.cafeId },
      select: ['name'],
    });
    if (!cafe) return;
    const payload = {
      bookingId: booking.id,
      cafeName: cafe.name,
      slotStart: booking.slotStart,
    };
    wsService.pushToCafe(booking.cafeId, 'NEW_BOOKING', payload);
  } catch (err) {
    logger.error('PaymentService', 'pushBookingNew failed', err);
  }
}

/** Signal operational screens to refetch after an on-site/additional payment. */
async function pushBookingPaymentUpdated(booking: Booking): Promise<void> {
  try {
    const session = await AppDataSource.getRepository(Session).findOne({
      where: { bookingId: booking.id },
      select: ['id'],
    });
    const payload = {
      bookingId: booking.id,
      cafeId: booking.cafeId,
      ...(session ? { sessionId: session.id } : {}),
      action: 'ADDITIONAL_PAYMENT_CONFIRMED',
      updatedAt: new Date().toISOString(),
    };
    wsService.pushToCafe(booking.cafeId, 'BOOKING_PAYMENT_UPDATED', payload);
  } catch (error) {
    logger.error('PaymentService', 'pushBookingPaymentUpdated failed', {
      bookingId: booking.id,
      error,
    });
  }
}

// ── Snapshot types (Constitution Principle I: prices from snapshot, never live) ─

/** Minimal shape required for refund calculation — stable across snapshot versions */
export interface RefundSnapshot {
  slot_fee_total: number;
  vehicles: Array<{ rental_fee: number; booking_vehicle_id?: string }>;
  fnb_total: number;
  discount_amount: number;
  total_charged: number;
}

/** Full snapshot stored on Booking.snapshot at checkout time */
export interface BookingSnapshot extends RefundSnapshot {
  platform_fee_pct: number;
  captured_at: string;
  /** Contest entry fee folded into the booking payment (WF-B combined payment). */
  contest_entry_fee?: number;
  contest_pricing?: {
    contest_id: string;
    waive_slot_fee: boolean;
  };
  package_used?: {
    customer_package_id: string;
    package_id: string;
    package_name: string;
    slots_used: number;
  };
}

export interface RefundBreakdown {
  slotFeeRefund: number;
  rentalFeeRefund: number;
  depositRefund: number;
  fnbRefund: number;
  totalRefund: number;
}

/**
 * Promotions discount only the slot and vehicle-rental subtotal. Allocate that
 * discount before applying any cancellation percentage so a refund can never
 * exceed the amount the customer actually paid for those services.
 */
export function getNetRefundablePrepaidAmounts(snapshot: RefundSnapshot): {
  slotFee: number;
  rentalFee: number;
  fnbFee: number;
} {
  const grossSlotFee = Math.max(0, Number(snapshot.slot_fee_total ?? 0));
  const grossRentalFee = snapshot.vehicles.reduce(
    (sum, vehicle) => sum + Math.max(0, Number(vehicle.rental_fee ?? 0)),
    0,
  );
  const eligibleSubtotal = grossSlotFee + grossRentalFee;
  const discount = Math.min(Math.max(0, Number(snapshot.discount_amount ?? 0)), eligibleSubtotal);
  const slotDiscount =
    eligibleSubtotal > 0 ? Math.round((discount * grossSlotFee) / eligibleSubtotal) : 0;
  const rentalDiscount = discount - slotDiscount;

  return {
    slotFee: Math.max(0, grossSlotFee - slotDiscount),
    rentalFee: Math.max(0, grossRentalFee - rentalDiscount),
    fnbFee: Math.max(0, Number(snapshot.fnb_total ?? 0)),
  };
}

/**
 * Immutable receipt lines stored with the initial payment transaction.
 *
 * Payment components are created only after a gateway confirms the payment and
 * can subsequently change status throughout the booking lifecycle. A payment
 * result must instead describe exactly what was charged at that moment.
 */
function buildInitialPaymentReceiptComponents(
  snapshot: BookingSnapshot,
): Array<{ type: string; amount: number }> {
  const rentalFee = snapshot.vehicles.reduce(
    (sum, vehicle) => sum + Number(vehicle.rental_fee ?? 0),
    0,
  );
  return [
    { type: PaymentComponentType.SLOT_FEE, amount: Number(snapshot.slot_fee_total ?? 0) },
    { type: PaymentComponentType.RENTAL_FEE, amount: rentalFee },
    { type: PaymentComponentType.FB_PREORDER, amount: Number(snapshot.fnb_total ?? 0) },
    {
      type: PaymentComponentType.CONTEST_ENTRY_FEE,
      amount: Number(snapshot.contest_entry_fee ?? 0),
    },
    { type: 'PROMOTION_DISCOUNT', amount: -Number(snapshot.discount_amount ?? 0) },
  ].filter((component) => component.amount !== 0);
}

/**
 * An additional-payment transaction pays the exact component ids captured when
 * its checkout URL was generated. Older transactions did not capture ids, so
 * they intentionally retain the former "all pending components" fallback.
 */
async function getPendingComponentsForAdditionalTransaction(
  transaction: PaymentTransaction,
): Promise<PaymentComponent[]> {
  if (!transaction.bookingId) return [];

  const rawRequest = (transaction.rawRequest ?? {}) as {
    components?: Array<{ id?: string }>;
  };
  const componentIds = (rawRequest.components ?? [])
    .map((component) => component.id)
    .filter((id): id is string => Boolean(id));
  const pendingComponents = await AppDataSource.getRepository(PaymentComponent).find({
    where: { bookingId: transaction.bookingId, status: PaymentComponentStatus.PENDING },
  });

  return componentIds.length > 0
    ? pendingComponents.filter((component) => componentIds.includes(component.id))
    : pendingComponents;
}

// ── calculateRefundAmounts ────────────────────────────────────────────────────

/** Pure function — Constitution Principle V: exported for unit tests */
export function calculateRefundAmounts(
  snapshot: RefundSnapshot,
  role: UserRole,
  slotStart: Date,
  isNoShow = false,
): RefundBreakdown {
  const { slotFee, rentalFee, fnbFee } = getNetRefundablePrepaidAmounts(snapshot);
  // R3: no-show — 0% slot, 100% rental. There is no vehicle deposit.
  if (isNoShow) {
    return {
      slotFeeRefund: 0,
      rentalFeeRefund: rentalFee,
      depositRefund: 0,
      fnbRefund: fnbFee,
      totalRefund: rentalFee + fnbFee,
    };
  }

  // R2: provider cancellation — always 100% regardless of timing
  if (role === UserRole.PROVIDER) {
    const total = slotFee + rentalFee + fnbFee;
    return {
      slotFeeRefund: slotFee,
      rentalFeeRefund: rentalFee,
      depositRefund: 0,
      fnbRefund: fnbFee,
      totalRefund: total,
    };
  }

  // R1: customer cancellation — time-based slot fee window
  const hoursBeforeSlot = (slotStart.getTime() - Date.now()) / (1000 * 60 * 60);

  let slotFeeRefund: number;
  if (hoursBeforeSlot > 24) {
    slotFeeRefund = slotFee; // 100% of the amount actually collected
  } else if (hoursBeforeSlot >= 12) {
    slotFeeRefund = Math.round(slotFee * 0.5); // 50% of the amount actually collected
  } else {
    slotFeeRefund = 0; // 0%
  }

  return {
    slotFeeRefund,
    rentalFeeRefund: rentalFee,
    depositRefund: 0,
    fnbRefund: fnbFee,
    totalRefund: slotFeeRefund + rentalFee + fnbFee,
  };
}

/** A served pre-order is consumed and must not be refunded. */
export function calculateRefundablePreorderAmount(
  snapshotFnbTotal: number,
  servedPreorderAmount: number,
): number {
  return Math.max(
    0,
    Number(snapshotFnbTotal ?? 0) - Math.max(0, Number(servedPreorderAmount ?? 0)),
  );
}

async function getRefundablePreorderAmount(
  bookingId: string,
  snapshotFnbTotal: number,
): Promise<number> {
  const deliveredPreorders = await AppDataSource.getRepository(FnbOrder).find({
    where: {
      bookingId,
      orderType: FnbOrderType.PRE_ORDER,
      status: FnbOrderStatus.DELIVERED,
    },
    select: ['totalAmount'],
  });
  const servedAmount = deliveredPreorders.reduce(
    (sum, order) => sum + Number(order.totalAmount),
    0,
  );
  return calculateRefundablePreorderAmount(snapshotFnbTotal, servedAmount);
}

export interface CancellationQuote {
  canCancel: boolean;
  reason?: string;
  refund: RefundBreakdown;
}

/**
 * Server-authoritative cancellation preview. The UI uses this before asking for
 * confirmation so it cannot present gross prices or already-served F&B as a
 * refundable amount.
 */
export async function getCancellationQuote(
  bookingId: string,
  requesterId: string,
  role: UserRole,
): Promise<CancellationQuote> {
  const booking = await AppDataSource.getRepository(Booking).findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

  if (role === UserRole.CUSTOMER && booking.customerId !== requesterId) {
    throw new AppError('Access denied', 403, 'NOT_BOOKING_OWNER');
  }
  if (role === UserRole.PROVIDER) {
    const ownsCafe = await AppDataSource.getRepository(Cafe).exist({
      where: { id: booking.cafeId, providerId: requesterId },
    });
    if (!ownsCafe) throw new AppError('Access denied', 403, 'BOOKING_CAFE_FORBIDDEN');
  }

  const emptyRefund: RefundBreakdown = {
    slotFeeRefund: 0,
    rentalFeeRefund: 0,
    depositRefund: 0,
    fnbRefund: 0,
    totalRefund: 0,
  };
  if (![BookingStatus.PENDING, BookingStatus.CONFIRMED].includes(booking.status)) {
    return {
      canCancel: false,
      reason: 'Đơn không còn ở trạng thái có thể hủy.',
      refund: emptyRefund,
    };
  }

  const hasOperationalSession = await AppDataSource.getRepository(Session).exist({
    where: {
      bookingId,
      status: In([
        SessionStatus.CHECKED_IN,
        SessionStatus.ACTIVE,
        SessionStatus.EXTENDING,
        SessionStatus.CHECKING_OUT,
        SessionStatus.COMPLETED,
      ]),
    },
  });
  if (hasOperationalSession) {
    return {
      canCancel: false,
      reason: 'Phiên chơi đã bắt đầu hoặc đang bàn giao xe; hãy xử lý qua luồng vận hành tại quầy.',
      refund: emptyRefund,
    };
  }

  if (booking.status === BookingStatus.PENDING) return { canCancel: true, refund: emptyRefund };

  const successfulPayment = await AppDataSource.getRepository(PaymentTransaction).exist({
    where: {
      bookingId,
      type: PaymentTransactionType.PAYMENT,
      status: PaymentTransactionStatus.SUCCESS,
    },
  });
  const snapshot = booking.snapshot as unknown as BookingSnapshot | null;
  if (!successfulPayment || !snapshot) return { canCancel: true, refund: emptyRefund };

  const calculatedRefund = calculateRefundAmounts(snapshot, role, booking.slotStart);
  const refundableFnbAmount = await getRefundablePreorderAmount(bookingId, snapshot.fnb_total);
  const fnbRefund = Math.min(calculatedRefund.fnbRefund, refundableFnbAmount);
  return {
    canCancel: true,
    refund: {
      ...calculatedRefund,
      fnbRefund,
      totalRefund: calculatedRefund.slotFeeRefund + calculatedRefund.rentalFeeRefund + fnbRefund,
    },
  };
}

// ── createCheckoutUrl ─────────────────────────────────────────────────────────

/**
 * Resolves contest-driven pricing adjustments for a booking.
 * Regular bookings get the identity adjustment; contest bookings read the
 * contest's config.rental_policy (read-only). Exported for unit tests.
 */
export async function resolveContestPricingAdjustments(
  booking: Pick<Booking, 'contestId' | 'source'>,
): Promise<ContestPricingAdjustments & { contestId: string | null }> {
  const identity = { waiveSlotFee: false, depositMultiplier: 1, contestId: null };
  const isContestBooking = booking.contestId != null || booking.source === BookingSource.CONTEST;
  if (!isContestBooking || !booking.contestId) return identity;

  const contest = await AppDataSource.getRepository(Contest).findOne({
    where: { id: booking.contestId },
    select: ['id', 'config'],
  });
  if (!contest) return identity;

  const adjustments = applyContestRentalPricing(booking, getContestRentalPolicy(contest));
  return { ...adjustments, contestId: contest.id };
}

export interface CheckoutResult {
  payment_url: string | null;
  txn_ref: string;
  total_amount: number;
  confirmed?: boolean;
  slots_used?: number;
  slots_remaining_after?: number;
}

/** Freezes prices into snapshot, returns VNPay redirect URL. If total=0, confirms inline. */
export async function createCheckoutUrl(
  bookingId: string,
  ipAddr: string,
  customReturnUrl?: string,
  gatewayName = 'vnpay',
): Promise<CheckoutResult> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
  if (booking.status !== 'PENDING') {
    throw new AppError('Booking is not in PENDING state', 400, 'BOOKING_NOT_PENDING');
  }
  if (booking.paymentExpiresAt < new Date()) {
    await transition(bookingId, 'PAYMENT_TIMEOUT');
    throw new AppError('Payment window expired', 400, 'PAYMENT_EXPIRED');
  }

  const gateway = getPaymentGateway(gatewayName);

  // Collect pricing from child rows to freeze into snapshot
  const bvRepo = AppDataSource.getRepository(BookingVehicle);
  const bookingVehicles = await bvRepo.find({ where: { bookingId } });

  logger.info('PaymentService', 'checkout vehicles snapshot', {
    bookingId,
    count: bookingVehicles.length,
    rows: bookingVehicles.map((v) => ({
      vehicleId: v.vehicleId,
      rentalFeeSnapshot: Number(v.rentalFeeSnapshot),
    })),
  });

  const fnbRepo = AppDataSource.getRepository(FnbOrder);
  const fnbOrders = await fnbRepo.find({ where: { bookingId, orderType: FnbOrderType.PRE_ORDER } });
  const fnbTotal = fnbOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  const rentalFeeTotal = bookingVehicles.reduce((sum, v) => sum + Number(v.rentalFeeSnapshot), 0);

  // Compute slot fee from cafe rate × number of slots × player count (Constitution Principle I)
  const cafeRepo = AppDataSource.getRepository(Cafe);
  const cafe = await cafeRepo.findOne({ where: { id: booking.cafeId } });
  if (!cafe) throw new AppError('Cafe not found', 404, 'CAFE_NOT_FOUND');

  const participantCount = await AppDataSource.getRepository(BookingParticipant).count({
    where: { bookingId },
  });
  const playerCount = Math.max(1, participantCount);

  const slotMinutes = (booking.slotEnd.getTime() - booking.slotStart.getTime()) / 60_000;
  const slotCount = slotMinutes / cafe.slotDurationMinutes;

  // Read the pricing multiplier frozen at booking creation (snapshot-first principle).
  // Do NOT recalculate from live pricing rules — the multiplier may have changed.
  const creationSnapshot = booking.snapshot as unknown as Record<string, unknown> | null;
  const slotMultiplier = (creationSnapshot?.slot_fee_multiplier as number | undefined) ?? 1;
  const rawSlotFee = Math.round(
    Number(cafe.slotFeeRate) * slotCount * playerCount * slotMultiplier,
  );

  const frozenSlotFee = Number(creationSnapshot?.slot_fee_total);

  // Use the quoted amount frozen at booking creation. The fallback serves
  // historical bookings created before this snapshot field existed.
  const packageUsed = (booking.snapshot as unknown as BookingSnapshot | null)?.package_used;
  const slotFee = Number.isFinite(frozenSlotFee)
    ? frozenSlotFee
    : booking.customerPackageId
      ? 0
      : rawSlotFee;

  // Contest policy may waive the slot fee. Vehicle deposits are no longer a
  // chargeable part of any booking payment.
  const contestAdj = await resolveContestPricingAdjustments(booking);
  const finalSlotFee = contestAdj.waiveSlotFee ? 0 : slotFee;
  // Contest entry fee folded into this booking's payment by the contest
  // registration flow (WF-B combined payment) — frozen at registration time.
  const contestEntryFee = Number(creationSnapshot?.contest_entry_fee ?? 0);

  const grossTotal = finalSlotFee + rentalFeeTotal + fnbTotal;
  const discountAmount = Number(booking.discountAmount) || 0;
  const totalCharged = Math.max(0, grossTotal - discountAmount) + contestEntryFee;

  logger.info('PaymentService', 'checkout totals', {
    bookingId,
    slotFee: finalSlotFee,
    rentalFeeTotal,
    fnbTotal,
    discountAmount,
    totalCharged,
    playerCount,
    slotCount,
    slotMultiplier,
    contestPricing: contestAdj.contestId ? contestAdj : undefined,
  });

  // Preserve creation-time fields so PaymentResultPage and invoice can still read them
  const preservedCreationFields: Record<string, unknown> = {};
  for (const key of [
    'pricing_rule_label',
    'slot_fee_multiplier',
    'promotion_applied',
    'track_type_id',
    'track_type_code',
    'track_type_name',
  ]) {
    if (creationSnapshot?.[key] !== undefined) preservedCreationFields[key] = creationSnapshot[key];
  }

  const snapshot: BookingSnapshot = {
    slot_fee_total: finalSlotFee,
    vehicles: bookingVehicles.map((v) => ({
      booking_vehicle_id: v.id,
      rental_fee: Number(v.rentalFeeSnapshot),
    })),
    fnb_total: fnbTotal,
    discount_amount: discountAmount,
    total_charged: totalCharged,
    platform_fee_pct: 0,
    captured_at: new Date().toISOString(),
    ...(contestEntryFee > 0 ? { contest_entry_fee: contestEntryFee } : {}),
    ...(contestAdj.contestId
      ? {
          contest_pricing: {
            contest_id: contestAdj.contestId,
            waive_slot_fee: contestAdj.waiveSlotFee,
          },
        }
      : {}),
    ...(packageUsed ? { package_used: packageUsed } : {}),
    ...preservedCreationFields,
  } as BookingSnapshot;

  await bookingRepo.update(bookingId, { snapshot: snapshot as unknown as object });

  // Zero-total bypass: skip VNPay, confirm inline (D3 from research.md)
  if (totalCharged === 0 && (booking.customerPackageId || booking.promotionId)) {
    const txnRef = `pkg_${bookingId.replace(/-/g, '').substring(0, 28)}`;
    const txRepo = AppDataSource.getRepository(PaymentTransaction);
    const existingTx = await txRepo.findOne({ where: { txnRef } });
    if (!existingTx) {
      await txRepo.save(
        txRepo.create({
          bookingId,
          customerPackageId: null,
          contestRegistrationId: null,
          subjectType: PaymentTransactionSubjectType.BOOKING,
          type: PaymentTransactionType.PAYMENT,
          gateway: 'DIRECT',
          txnRef,
          amount: 0,
          status: PaymentTransactionStatus.SUCCESS,
          rawRequest: {
            zeroTotal: true,
            packageApplied: booking.customerPackageId,
            components: buildInitialPaymentReceiptComponents(snapshot),
          },
        }),
      );
    }

    await transition(bookingId, 'PAYMENT_CONFIRMED');
    await createPaymentComponents(booking, snapshot, bookingVehicles);
    await incrementPromoUsesCount(bookingId).catch(() => {}); // best-effort

    let slotsRemainingAfter = 0;
    if (snapshot.package_used) {
      const qr = AppDataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await deductSlots(
          snapshot.package_used.customer_package_id,
          snapshot.package_used.slots_used,
          qr,
        );
        await qr.commitTransaction();
        const { CustomerPackage } = await import('../models/customer-package.entity');
        const cp = await AppDataSource.getRepository(CustomerPackage).findOne({
          where: { id: snapshot.package_used.customer_package_id },
        });
        slotsRemainingAfter = cp?.slotsRemaining ?? 0;
      } catch (err) {
        await qr.rollbackTransaction();
        logger.error(
          'PaymentService',
          `deductSlots failed (zero-total) bookingId=${bookingId}`,
          err,
        );
      } finally {
        await qr.release();
      }
    }

    await broadcastBookingUpdated(booking, BookingStatus.CONFIRMED, 'PAYMENT_CONFIRMED');

    Promise.all([
      emailService.sendBookingConfirmation(bookingId),
      emailService.sendBookingInvoice(bookingId),
      pushBookingNew(booking),
    ]).catch((err) => {
      logger.error('PaymentService', 'post-payment email failed (zero-total)', err);
    });

    logger.info('PaymentService', `zero-total confirmed bookingId=${bookingId}`);
    return {
      payment_url: null,
      txn_ref: txnRef,
      total_amount: 0,
      confirmed: true,
      slots_used: snapshot.package_used?.slots_used,
      slots_remaining_after: slotsRemainingAfter,
    };
  }

  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const latestPendingAttempt = await txRepo.findOne({
    where: {
      bookingId,
      type: PaymentTransactionType.PAYMENT,
      status: PaymentTransactionStatus.PENDING,
    },
    order: { createdAt: 'DESC' },
  });
  const pendingRequest = (latestPendingAttempt?.rawRequest ?? {}) as {
    additionalPayment?: boolean;
    paymentUrl?: string;
    gatewayUrlExpiresAt?: string;
  };
  const gatewayUrlExpiresAt = pendingRequest.gatewayUrlExpiresAt
    ? new Date(pendingRequest.gatewayUrlExpiresAt)
    : null;
  if (
    latestPendingAttempt &&
    !pendingRequest.additionalPayment &&
    pendingRequest.paymentUrl &&
    gatewayUrlExpiresAt &&
    gatewayUrlExpiresAt > new Date()
  ) {
    return {
      payment_url: pendingRequest.paymentUrl,
      txn_ref: latestPendingAttempt.txnRef,
      total_amount: Number(latestPendingAttempt.amount),
    };
  }
  if (latestPendingAttempt && !pendingRequest.additionalPayment) {
    await txRepo.update(latestPendingAttempt.id, {
      status: PaymentTransactionStatus.FAILED,
      rawResponse: {
        ...((latestPendingAttempt.rawResponse ?? {}) as Record<string, unknown>),
        reason: 'CHECKOUT_ATTEMPT_EXPIRED_OR_REPLACED',
        replacedAt: new Date().toISOString(),
      },
    });
  }

  // Every retry has a new gateway reference; a failed/cancelled VNPay attempt
  // must never be reused.
  const txnRef = `b_${bookingId.replace(/-/g, '').slice(0, 16)}_${randomUUID().replace(/-/g, '')}`;

  const gatewayResult = gateway.createPaymentUrl({
    amount: totalCharged,
    txnRef,
    orderInfo: `RCField booking ${bookingId.substring(0, 8)}`,
    ipAddr,
    returnUrl: customReturnUrl,
    bankCode: 'VNBANK',
  });

  logger.debug(
    'PaymentService',
    `payment URL params: amount=${totalCharged} txnRef=${txnRef} gateway=${gateway.name} url=${gatewayResult.payment_url}`,
  );

  // Record the exact URL and its 15-minute gateway lifetime. A later checkout
  // may safely return this URL or create a fresh attempt after it expires.
  const tx = txRepo.create({
    bookingId,
    customerPackageId: null,
    contestRegistrationId: null,
    subjectType: PaymentTransactionSubjectType.BOOKING,
    type: PaymentTransactionType.PAYMENT,
    gateway: gateway.name,
    txnRef,
    amount: totalCharged,
    status: PaymentTransactionStatus.PENDING,
    rawRequest: {
      bookingId,
      totalCharged,
      ipAddr,
      gateway: gateway.name,
      paymentUrl: gatewayResult.payment_url,
      gatewayUrlExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      components: buildInitialPaymentReceiptComponents(snapshot),
    },
  });
  await txRepo.save(tx);

  // Auto-confirm for local/test flows: legacy VNPay mock env OR explicit mock gateway.
  if (gateway.name === 'MOCK' || env.vnpay.mockEnabled) {
    await processMockConfirmation(txnRef);
    const target = new URL('/payment/result', env.frontendUrl);
    target.searchParams.set('status', 'success');
    target.searchParams.set('txn_ref', txnRef);
    target.searchParams.set('booking_id', bookingId);
    target.searchParams.set('mock', '1');
    logger.info(
      'PaymentService',
      `mock checkout confirmed txnRef=${txnRef} bookingId=${bookingId}`,
    );
    return { payment_url: target.toString(), txn_ref: txnRef, total_amount: totalCharged };
  }

  logger.info('PaymentService', `checkout created txnRef=${txnRef} bookingId=${bookingId}`);

  return {
    payment_url: gatewayResult.payment_url,
    txn_ref: txnRef,
    total_amount: totalCharged,
  };
}

// ── createPaymentComponents ───────────────────────────────────────────────────

export async function createPaymentComponents(
  booking: Booking,
  snapshot: BookingSnapshot,
  bookingVehicles: BookingVehicle[],
): Promise<void> {
  const slotFeeTotal = Number(
    snapshot.slot_fee_total ?? (snapshot as unknown as Record<string, unknown>).slot_fee ?? 0,
  );
  const waiveSlotFee = snapshot.contest_pricing?.waive_slot_fee === true;

  const components: Partial<PaymentComponent>[] = [];
  if (!waiveSlotFee) {
    components.push({
      bookingId: booking.id,
      bookingVehicleId: null,
      type: PaymentComponentType.SLOT_FEE,
      amount: slotFeeTotal,
      status: PaymentComponentStatus.HELD,
    });
  }

  for (const bv of bookingVehicles) {
    components.push({
      bookingId: booking.id,
      bookingVehicleId: bv.id,
      type: PaymentComponentType.RENTAL_FEE,
      amount: Number(bv.rentalFeeSnapshot ?? 0),
      status: PaymentComponentStatus.HELD,
    });
  }

  const fnbTotal = Number(
    snapshot.fnb_total ?? (snapshot as unknown as Record<string, unknown>).fnb_preorder_fee ?? 0,
  );
  if (fnbTotal > 0) {
    components.push({
      bookingId: booking.id,
      bookingVehicleId: null,
      type: PaymentComponentType.FB_PREORDER,
      amount: fnbTotal,
      status: PaymentComponentStatus.HELD,
    });
  }

  const compRepo = AppDataSource.getRepository(PaymentComponent);
  await AppDataSource.transaction(async (em) => {
    for (const comp of components) {
      await em.save(compRepo.create(comp));
    }
  });
}

// ── processConfirmation ───────────────────────────────────────────────────────

/**
 * WF-B combined payment: when a contest rental booking is paid, the contest
 * entry fee was charged in the same transaction, so mark the linked
 * registration's entry fee as paid. Idempotent (conditional UPDATE) and
 * best-effort — a failure here must never break the payment flow.
 */
async function markContestEntryFeePaidOnBookingSuccess(booking: Booking): Promise<void> {
  if (!booking.contestId) return;
  try {
    const updateRaw = await AppDataSource.query(
      `UPDATE contest_registrations
       SET payment_status = $2, updated_at = NOW()
       WHERE booking_id = $1 AND payment_status = $3
       RETURNING id`,
      [
        booking.id,
        ContestEntryFeePaymentStatus.MARKED_PAID,
        ContestEntryFeePaymentStatus.PENDING_PAYMENT,
      ],
    );
    const updatedRows: { id: string }[] = Array.isArray(updateRaw[0]) ? updateRaw[0] : updateRaw;
    if (!updatedRows.length) return;

    const registrationId = updatedRows[0].id;
    await writeContestAudit({
      contestId: booking.contestId,
      registrationId,
      actorId: null,
      actorRole: 'SYSTEM',
      eventType: 'registration.entry_fee_marked_paid',
      afterJson: { paymentStatus: ContestEntryFeePaymentStatus.MARKED_PAID },
      reason: 'Entry fee paid with booking payment',
      metadata: { booking_id: booking.id },
    });

    const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
      where: { id: registrationId },
    });
    if (registration) {
      await sendContestRegistrationStatusNotification(
        registration,
        NotificationType.CONTEST_REGISTRATION_APPROVED,
        'Phi tham gia giai dau da duoc thanh toan',
        'Phi tham gia giai dau cua ban da duoc thanh toan cung voi booking thue xe.',
      );
    }
  } catch (err) {
    logger.error(
      'PaymentService',
      `contest entry fee sync failed bookingId=${booking.id}: ${(err as Error).message}`,
    );
  }
}

/** Idempotent IPN/return handler for VNPay — kept for backward compatibility. */
export async function processConfirmation(
  vnpParams: Record<string, unknown>,
): Promise<{ rspCode: string; message: string }> {
  return processGatewayConfirmation(vnpParams, 'vnpay');
}

/** Generic gateway confirmation: verify then apply business logic. */
export async function processGatewayConfirmation(
  params: Record<string, unknown>,
  gatewayName: string,
): Promise<{ rspCode: string; message: string }> {
  const gateway = getPaymentGateway(gatewayName);
  const result = gateway.verifyCallback(params);

  if (!result.isValid) {
    return { rspCode: '97', message: 'Invalid signature' };
  }

  return processConfirmationResult(result);
}

/** Apply business logic once a transaction has been verified. */
export async function processConfirmationResult(
  result: PaymentVerificationResult,
): Promise<{ rspCode: string; message: string }> {
  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const tx = await txRepo.findOne({ where: { txnRef: result.txnRef } });

  if (!tx) {
    return { rspCode: '01', message: 'Order not found' };
  }

  // Idempotency: already processed
  if (tx.status === PaymentTransactionStatus.SUCCESS) {
    return { rspCode: '02', message: 'Order already confirmed' };
  }

  if (!result.isSuccess) {
    await txRepo.update(tx.id, {
      status: PaymentTransactionStatus.FAILED,
      rawResponse: result.raw as object,
    });
    logger.info('PaymentService', `payment failed txnRef=${result.txnRef}`);
    return { rspCode: result.responseCode, message: 'Payment failed' };
  }

  if (Number(tx.amount) !== Number(result.amount)) {
    await txRepo.update(tx.id, {
      status: PaymentTransactionStatus.FAILED,
      rawResponse: { ...result.raw, reason: 'AMOUNT_MISMATCH' },
    });
    logger.warn('PaymentService', `amount mismatch txnRef=${result.txnRef}`, {
      expectedAmount: tx.amount,
      receivedAmount: result.amount,
    });
    return { rspCode: '04', message: 'Invalid amount' };
  }

  const isInitialBookingPayment = tx.bookingId != null && !result.txnRef.startsWith('ctr_');
  if (isInitialBookingPayment) {
    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: tx.bookingId! },
    });
    if (
      !booking ||
      booking.status !== BookingStatus.PENDING ||
      booking.paymentExpiresAt <= new Date()
    ) {
      await txRepo.update(tx.id, {
        status: PaymentTransactionStatus.FAILED,
        rawResponse: { ...result.raw, reason: 'BOOKING_HOLD_NO_LONGER_ACTIVE' },
      });
      logger.warn(
        'PaymentService',
        `late payment requires reconciliation txnRef=${result.txnRef}`,
        {
          bookingId: tx.bookingId,
          bookingStatus: booking?.status,
        },
      );
      return { rspCode: '99', message: 'Booking hold is no longer active' };
    }
  }

  // Mark transaction SUCCESS
  await txRepo.update(tx.id, {
    status: PaymentTransactionStatus.SUCCESS,
    rawResponse: result.raw as object,
  });

  const paymentSource = tx.gateway ?? 'VNPAY';

  if (tx.subjectType === PaymentTransactionSubjectType.CONTEST_ENTRY) {
    if (!tx.contestRegistrationId) {
      logger.error(
        'PaymentService',
        `contest entry transaction missing registrationId txnRef=${result.txnRef}`,
      );
      return { rspCode: '01', message: 'Contest registration missing' };
    }
    const registrationRepo = AppDataSource.getRepository(ContestRegistration);
    const registration = await registrationRepo.findOne({
      where: { id: tx.contestRegistrationId },
    });
    if (!registration) {
      return { rspCode: '01', message: 'Contest registration not found' };
    }
    registration.paymentStatus = ContestEntryFeePaymentStatus.MARKED_PAID;
    registration.entryFeeMarkedPaidAt = new Date();
    registration.entryFeeMarkedPaidBy = null;
    registration.metadata = {
      ...(registration.metadata ?? {}),
      payment_source: paymentSource,
      payment_txn_ref: result.txnRef,
    };
    await registrationRepo.save(registration);
    await writeContestAudit({
      contestId: registration.contestId,
      registrationId: registration.id,
      actorId: null,
      actorRole: 'SYSTEM',
      eventType: 'registration.entry_fee_marked_paid',
      afterJson: { paymentStatus: registration.paymentStatus, payment_source: paymentSource },
      reason: `${paymentSource} confirmation`,
    });
    // Thuê xe của quán: trả tiền xong là có suất, không phải chờ ai bấm duyệt.
    await autoConfirmRentalRegistration(registration.id);
    logger.info(
      'PaymentService',
      `contest entry confirmed registrationId=${registration.id} txnRef=${result.txnRef}`,
    );
    return { rspCode: '00', message: 'Confirm Success' };
  }

  // Branch: checkout/counter payment (second VNPAY payment)
  if (result.txnRef.startsWith('ctr_')) {
    if (!tx.bookingId) {
      logger.error(
        'PaymentService',
        `checkout payment transaction has no bookingId txnRef=${result.txnRef}`,
      );
      return { rspCode: '01', message: 'Booking ID missing' };
    }
    const pendingComponents = await getPendingComponentsForAdditionalTransaction(tx);

    await AppDataSource.transaction(async (em) => {
      // Mark all service components as DISBURSED (paid via gateway)
      for (const comp of pendingComponents) {
        comp.status = PaymentComponentStatus.DISBURSED;
        await em.save(comp);
      }
    });

    // Notify staff/customer via WebSocket
    try {
      const bookingRepo = AppDataSource.getRepository(Booking);
      const booking = await bookingRepo.findOne({ where: { id: tx.bookingId } });
      if (booking) {
        if (booking.customerId) {
          await createNotification(
            booking.customerId,
            NotificationType.CUSTOMER_PAYMENT_CONFIRMED,
            'Thanh toán dịch vụ phát sinh thành công',
            `Phí phát sinh đơn hàng ${booking.id.substring(0, 8).toUpperCase()} đã được thanh toán online thành công qua ${paymentSource}.`,
            {
              bookingId: tx.bookingId,
              totalCounterBill: tx.amount,
              netCounterAmount: tx.amount,
              route: `/booking/${tx.bookingId}`,
            },
          );
          wsService.pushToUser(booking.customerId, 'CUSTOMER_PAYMENT_CONFIRMED', {
            bookingId: tx.bookingId,
            totalCounterBill: tx.amount,
            netCounterAmount: tx.amount,
          });
        }

        // Also push notification to session staff if checkin is assigned
        const { Session } = await import('../models/session.entity');
        const session = await AppDataSource.getRepository(Session).findOne({
          where: { bookingId: booking.id },
        });
        if (session && session.checkedInBy) {
          await createNotification(
            session.checkedInBy,
            NotificationType.CUSTOMER_PAYMENT_CONFIRMED,
            'Khách đã thanh toán phí phát sinh',
            `Phí phát sinh đơn hàng ${booking.id.substring(0, 8).toUpperCase()} đã được thanh toán online thành công.`,
            {
              bookingId: tx.bookingId,
              sessionId: session.id,
              totalCounterBill: tx.amount,
              route: `/staff/sessions/${session.id}`,
            },
          );
          wsService.pushToUser(session.checkedInBy, 'CUSTOMER_PAYMENT_CONFIRMED', {
            bookingId: tx.bookingId,
            sessionId: session.id,
            totalCounterBill: tx.amount,
          });
        }

        if (booking.status === BookingStatus.AWAITING_PAYMENT) {
          await transition(booking.id, 'PAYMENT_SETTLED');
        }
        await pushBookingPaymentUpdated(booking);
      }
    } catch (err) {
      logger.error('PaymentService', 'Failed to notify on checkout payment confirmation', err);
    }

    logger.info('PaymentService', `checkout payment confirmed txnRef=${result.txnRef}`);
    return { rspCode: '00', message: 'Confirm Success' };
  }

  // Branch: package purchase activation vs booking confirmation (D2 from research.md)
  if (tx.customerPackageId != null) {
    await activateCustomerPackage(tx.customerPackageId);
    logger.info(
      'PaymentService',
      `package activated customerPackageId=${tx.customerPackageId} txnRef=${result.txnRef}`,
    );
    return { rspCode: '00', message: 'Confirm Success' };
  }

  if (!tx.bookingId) {
    logger.error(
      'PaymentService',
      `tx has no bookingId or customerPackageId txnRef=${result.txnRef}`,
    );
    return { rspCode: '01', message: 'Order source unknown' };
  }

  const confirmedBookingId = tx.bookingId;

  // Transition booking to CONFIRMED
  const booking = await transition(confirmedBookingId, 'PAYMENT_CONFIRMED');
  await incrementPromoUsesCount(confirmedBookingId).catch(() => {}); // best-effort
  await markContestEntryFeePaidOnBookingSuccess(booking);

  // Create payment components
  const bvRepo = AppDataSource.getRepository(BookingVehicle);
  const bookingVehicles = await bvRepo.find({ where: { bookingId: confirmedBookingId } });
  const snapshot = booking.snapshot as unknown as BookingSnapshot | null;

  if (snapshot) {
    await createPaymentComponents(booking, snapshot, bookingVehicles);

    // Deduct slots if package was used (D4 from research.md)
    if (snapshot.package_used) {
      const qr = AppDataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await deductSlots(
          snapshot.package_used.customer_package_id,
          snapshot.package_used.slots_used,
          qr,
        );
        await qr.commitTransaction();
      } catch (err) {
        await qr.rollbackTransaction();
        logger.error('PaymentService', `deductSlots failed bookingId=${confirmedBookingId}`, err);
      } finally {
        await qr.release();
      }
    }
  }

  await broadcastBookingUpdated(booking, BookingStatus.CONFIRMED, 'PAYMENT_CONFIRMED');

  // Fire-and-forget: must not block or fail the IPN response
  Promise.all([
    emailService.sendBookingConfirmation(confirmedBookingId),
    emailService.sendBookingInvoice(confirmedBookingId),
    pushBookingNew(booking),
  ]).catch((err) => {
    logger.error('PaymentService', 'post-payment email failed', err);
  });

  logger.info('PaymentService', `confirmed bookingId=${tx.bookingId} txnRef=${result.txnRef}`);
  return { rspCode: '00', message: 'Confirm Success' };
}

export async function processMockConfirmation(
  txnRef: string,
): Promise<{ rspCode: string; message: string }> {
  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const tx = await txRepo.findOne({ where: { txnRef } });

  if (!tx) {
    return { rspCode: '01', message: 'Order not found' };
  }

  if (tx.status === PaymentTransactionStatus.SUCCESS) {
    return { rspCode: '02', message: 'Order already confirmed' };
  }

  await txRepo.update(tx.id, {
    status: PaymentTransactionStatus.SUCCESS,
    rawResponse: { mock: true, txnRef },
  });

  if (tx.subjectType === PaymentTransactionSubjectType.CONTEST_ENTRY) {
    if (!tx.contestRegistrationId) {
      return { rspCode: '01', message: 'Contest registration missing' };
    }
    const registrationRepo = AppDataSource.getRepository(ContestRegistration);
    const registration = await registrationRepo.findOne({
      where: { id: tx.contestRegistrationId },
    });
    if (!registration) {
      return { rspCode: '01', message: 'Contest registration not found' };
    }
    registration.paymentStatus = ContestEntryFeePaymentStatus.MARKED_PAID;
    registration.entryFeeMarkedPaidAt = new Date();
    registration.entryFeeMarkedPaidBy = null;
    registration.metadata = {
      ...(registration.metadata ?? {}),
      payment_source: 'MOCK',
      payment_txn_ref: txnRef,
    };
    await registrationRepo.save(registration);
    await writeContestAudit({
      contestId: registration.contestId,
      registrationId: registration.id,
      actorId: null,
      actorRole: 'SYSTEM',
      eventType: 'registration.entry_fee_marked_paid',
      afterJson: { paymentStatus: registration.paymentStatus, payment_source: 'MOCK' },
      reason: 'Mock VNPay confirmation',
    });
    return { rspCode: '00', message: 'Mock Confirm Success' };
  }

  // Branch: checkout/counter payment (second VNPAY payment)
  if (txnRef.startsWith('ctr_')) {
    if (!tx.bookingId) {
      logger.error(
        'PaymentService',
        `mock checkout payment transaction has no bookingId txnRef=${txnRef}`,
      );
      return { rspCode: '01', message: 'Booking ID missing' };
    }
    const pendingComponents = await getPendingComponentsForAdditionalTransaction(tx);

    await AppDataSource.transaction(async (em) => {
      // Mark all service components as DISBURSED (paid via VNPAY)
      for (const comp of pendingComponents) {
        comp.status = PaymentComponentStatus.DISBURSED;
        await em.save(comp);
      }
    });

    // Notify staff/customer via WebSocket
    try {
      const bookingRepo = AppDataSource.getRepository(Booking);
      const booking = await bookingRepo.findOne({ where: { id: tx.bookingId } });
      if (booking) {
        if (booking.customerId) {
          await createNotification(
            booking.customerId,
            NotificationType.CUSTOMER_PAYMENT_CONFIRMED,
            'Thanh toán dịch vụ phát sinh thành công',
            `Phí phát sinh đơn hàng ${booking.id.substring(0, 8).toUpperCase()} đã được thanh toán online thành công qua VNPAY.`,
            {
              bookingId: tx.bookingId,
              totalCounterBill: tx.amount,
              netCounterAmount: tx.amount,
              route: `/booking/${tx.bookingId}`,
            },
          );
          wsService.pushToUser(booking.customerId, 'CUSTOMER_PAYMENT_CONFIRMED', {
            bookingId: tx.bookingId,
            totalCounterBill: tx.amount,
            netCounterAmount: tx.amount,
          });
        }

        const { Session } = await import('../models/session.entity');
        const session = await AppDataSource.getRepository(Session).findOne({
          where: { bookingId: booking.id },
        });
        if (session && session.checkedInBy) {
          await createNotification(
            session.checkedInBy,
            NotificationType.CUSTOMER_PAYMENT_CONFIRMED,
            'Khách đã thanh toán phí phát sinh',
            `Phí phát sinh đơn hàng ${booking.id.substring(0, 8).toUpperCase()} đã được thanh toán online thành công.`,
            {
              bookingId: tx.bookingId,
              sessionId: session.id,
              totalCounterBill: tx.amount,
              route: `/staff/sessions/${session.id}`,
            },
          );
          wsService.pushToUser(session.checkedInBy, 'CUSTOMER_PAYMENT_CONFIRMED', {
            bookingId: tx.bookingId,
            sessionId: session.id,
            totalCounterBill: tx.amount,
          });
        }

        if (booking.status === BookingStatus.AWAITING_PAYMENT) {
          await transition(booking.id, 'PAYMENT_SETTLED');
        }
        await pushBookingPaymentUpdated(booking);
      }
    } catch (err) {
      logger.error('PaymentService', 'Failed to notify on mock checkout payment confirmation', err);
    }

    logger.info('PaymentService', `mock checkout payment confirmed txnRef=${txnRef}`);
    return { rspCode: '00', message: 'Mock Confirm Success' };
  }

  // Branch: package purchase activation vs booking confirmation
  if (tx.customerPackageId != null) {
    await activateCustomerPackage(tx.customerPackageId);
    logger.info(
      'PaymentService',
      `mock package activated customerPackageId=${tx.customerPackageId}`,
    );
    return { rspCode: '00', message: 'Mock Confirm Success' };
  }

  if (!tx.bookingId) {
    return { rspCode: '01', message: 'Order source unknown' };
  }

  const mockBookingId = tx.bookingId;

  const booking = await transition(mockBookingId, 'PAYMENT_CONFIRMED');
  await incrementPromoUsesCount(mockBookingId).catch(() => {}); // best-effort
  await markContestEntryFeePaidOnBookingSuccess(booking);
  const bvRepo = AppDataSource.getRepository(BookingVehicle);
  const bookingVehicles = await bvRepo.find({ where: { bookingId: mockBookingId } });
  const snapshot = booking.snapshot as unknown as BookingSnapshot | null;

  if (snapshot) {
    await createPaymentComponents(booking, snapshot, bookingVehicles);

    // Deduct slots if package was used
    if (snapshot.package_used) {
      const qr = AppDataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await deductSlots(
          snapshot.package_used.customer_package_id,
          snapshot.package_used.slots_used,
          qr,
        );
        await qr.commitTransaction();
      } catch (err) {
        await qr.rollbackTransaction();
        logger.error('PaymentService', `deductSlots failed (mock) bookingId=${mockBookingId}`, err);
      } finally {
        await qr.release();
      }
    }
  }

  await broadcastBookingUpdated(booking, BookingStatus.CONFIRMED, 'PAYMENT_CONFIRMED');

  Promise.all([
    emailService.sendBookingConfirmation(mockBookingId),
    emailService.sendBookingInvoice(mockBookingId),
    pushBookingNew(booking),
  ]).catch((err) => {
    logger.error('PaymentService', 'post-payment email failed (mock)', err);
  });

  logger.info('PaymentService', `mock confirmed bookingId=${mockBookingId} txnRef=${txnRef}`);
  return { rspCode: '00', message: 'Mock Confirm Success' };
}

// ── mockConfirmPayment (dev only) ─────────────────────────────────────────────

/** Bypasses VNPay — freezes snapshot, confirms booking, creates payment components.
 *  Only callable when NODE_ENV !== 'production'. */
export async function mockConfirmPayment(
  bookingId: string,
): Promise<{ redirect_url: string; txn_ref: string }> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
  if (booking.status !== 'PENDING') {
    throw new AppError('Booking is not in PENDING state', 400, 'BOOKING_NOT_PENDING');
  }

  const bvRepo = AppDataSource.getRepository(BookingVehicle);
  const bookingVehicles = await bvRepo.find({ where: { bookingId } });

  const fnbRepo = AppDataSource.getRepository(FnbOrder);
  const fnbOrders = await fnbRepo.find({ where: { bookingId, orderType: FnbOrderType.PRE_ORDER } });
  const fnbTotal = fnbOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  const rentalFeeTotal = bookingVehicles.reduce((sum, v) => sum + Number(v.rentalFeeSnapshot), 0);

  const cafeRepo = AppDataSource.getRepository(Cafe);
  const cafe = await cafeRepo.findOne({ where: { id: booking.cafeId } });
  if (!cafe) throw new AppError('Cafe not found', 404, 'CAFE_NOT_FOUND');

  const participantCount = await AppDataSource.getRepository(BookingParticipant).count({
    where: { bookingId },
  });
  const playerCount = Math.max(1, participantCount);

  const slotMinutes = (booking.slotEnd.getTime() - booking.slotStart.getTime()) / 60_000;
  const slotCount = slotMinutes / cafe.slotDurationMinutes;

  const mockCreationSnapshot = booking.snapshot as unknown as Record<string, unknown> | null;
  const slotMultiplier = (mockCreationSnapshot?.slot_fee_multiplier as number | undefined) ?? 1;
  const rawSlotFee = Math.round(
    Number(cafe.slotFeeRate) * slotCount * playerCount * slotMultiplier,
  );
  // If package was applied, slot fee is 0 (createBooking already validated ownership)
  const slotFee = booking.customerPackageId ? 0 : rawSlotFee;

  // Contest rental policy may waive the slot fee. Deposits are not charged.
  const contestAdj = await resolveContestPricingAdjustments(booking);
  const finalMockSlotFee = contestAdj.waiveSlotFee ? 0 : slotFee;
  const grossMockTotal = finalMockSlotFee + rentalFeeTotal + fnbTotal;
  const mockDiscountAmount = Number(booking.discountAmount) || 0;
  const contestEntryFee = Number(mockCreationSnapshot?.contest_entry_fee ?? 0);
  const totalCharged = Math.max(0, grossMockTotal - mockDiscountAmount) + contestEntryFee;

  const mockPreservedFields: Record<string, unknown> = {};
  for (const key of [
    'pricing_rule_label',
    'slot_fee_multiplier',
    'promotion_applied',
    'track_type_id',
    'track_type_code',
    'track_type_name',
  ]) {
    if (mockCreationSnapshot?.[key] !== undefined)
      mockPreservedFields[key] = mockCreationSnapshot[key];
  }

  const packageUsed = (mockCreationSnapshot as unknown as BookingSnapshot | null)?.package_used;

  const snapshot: BookingSnapshot = {
    slot_fee_total: finalMockSlotFee,
    vehicles: bookingVehicles.map((v) => ({
      booking_vehicle_id: v.id,
      rental_fee: Number(v.rentalFeeSnapshot),
    })),
    fnb_total: fnbTotal,
    discount_amount: mockDiscountAmount,
    total_charged: totalCharged,
    platform_fee_pct: 0,
    captured_at: new Date().toISOString(),
    ...(packageUsed ? { package_used: packageUsed } : {}),
    ...(contestEntryFee > 0 ? { contest_entry_fee: contestEntryFee } : {}),
    ...(contestAdj.contestId
      ? {
          contest_pricing: {
            contest_id: contestAdj.contestId,
            waive_slot_fee: contestAdj.waiveSlotFee,
          },
        }
      : {}),
    ...mockPreservedFields,
  } as BookingSnapshot;

  await bookingRepo.update(bookingId, { snapshot: snapshot as unknown as object });

  const txnRef = `mock_${bookingId.replace(/-/g, '').substring(0, 24)}`;
  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const tx = txRepo.create({
    bookingId,
    type: PaymentTransactionType.PAYMENT,
    customerPackageId: null,
    contestRegistrationId: null,
    subjectType: PaymentTransactionSubjectType.BOOKING,
    gateway: 'MOCK',
    txnRef,
    amount: totalCharged,
    status: PaymentTransactionStatus.SUCCESS,
    rawRequest: { mock: true },
    rawResponse: { mock: true, confirmedAt: new Date().toISOString() },
  });
  await txRepo.save(tx);

  await transition(bookingId, 'PAYMENT_CONFIRMED');
  await incrementPromoUsesCount(bookingId).catch(() => {}); // best-effort
  await markContestEntryFeePaidOnBookingSuccess(booking);
  await createPaymentComponents(booking, snapshot, bookingVehicles);

  // Deduct slots if package was used
  if (snapshot.package_used) {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await deductSlots(
        snapshot.package_used.customer_package_id,
        snapshot.package_used.slots_used,
        qr,
      );
      await qr.commitTransaction();
      logger.info('PaymentService', `mock deductSlots success bookingId=${bookingId}`);
    } catch (err) {
      await qr.rollbackTransaction();
      logger.error(
        'PaymentService',
        `deductSlots failed (mock-checkout) bookingId=${bookingId}`,
        err,
      );
    } finally {
      await qr.release();
    }
  }

  await broadcastBookingUpdated(booking, BookingStatus.CONFIRMED, 'PAYMENT_CONFIRMED');

  Promise.all([
    emailService.sendBookingConfirmation(bookingId),
    emailService.sendBookingInvoice(bookingId),
    pushBookingNew(booking),
  ]).catch((err) => {
    logger.error('PaymentService', 'post-payment email failed (mock-checkout)', err);
  });

  logger.info('PaymentService', `mock payment confirmed bookingId=${bookingId}`);

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const redirect_url = `${frontendUrl}/payment/result?status=success&txn_ref=${txnRef}`;
  return { redirect_url, txn_ref: txnRef };
}

// ── processRefund ─────────────────────────────────────────────────────────────

/** Marks payment components as REFUNDED after cancellation */
export async function processRefund(
  bookingId: string,
  cancelledByRole: UserRole,
  isNoShow = false,
): Promise<RefundBreakdown> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

  // Never create a refund record for a payment hold or a failed gateway
  // attempt. This also protects callers outside the booking controller.
  const successfulPayment = await AppDataSource.getRepository(PaymentTransaction).exist({
    where: {
      bookingId,
      type: PaymentTransactionType.PAYMENT,
      status: PaymentTransactionStatus.SUCCESS,
    },
  });
  if (!successfulPayment) {
    return { slotFeeRefund: 0, rentalFeeRefund: 0, depositRefund: 0, fnbRefund: 0, totalRefund: 0 };
  }

  const snapshot = booking.snapshot as unknown as BookingSnapshot | null;
  if (!snapshot) {
    // No payment was ever processed — nothing to refund
    return { slotFeeRefund: 0, rentalFeeRefund: 0, depositRefund: 0, fnbRefund: 0, totalRefund: 0 };
  }

  const calculatedRefund = calculateRefundAmounts(
    snapshot,
    cancelledByRole,
    booking.slotStart,
    isNoShow,
  );
  const refundableFnbAmount = await getRefundablePreorderAmount(bookingId, snapshot.fnb_total);
  const fnbRefund = Math.min(calculatedRefund.fnbRefund, refundableFnbAmount);
  const refund: RefundBreakdown = {
    ...calculatedRefund,
    fnbRefund,
    totalRefund: calculatedRefund.slotFeeRefund + calculatedRefund.rentalFeeRefund + fnbRefund,
  };
  if (refund.totalRefund <= 0) {
    return refund;
  }

  // Mark components as REFUNDED
  const compRepo = AppDataSource.getRepository(PaymentComponent);
  const components = await compRepo.find({ where: { bookingId } });

  await AppDataSource.transaction(async (em) => {
    for (const comp of components) {
      let refundedAmount = 0;
      const compAmount = Number(comp.amount);
      if (comp.type === PaymentComponentType.SLOT_FEE) {
        const ratio =
          snapshot.slot_fee_total > 0 ? refund.slotFeeRefund / snapshot.slot_fee_total : 0;
        refundedAmount = Math.round(compAmount * ratio);
      } else if (comp.type === PaymentComponentType.RENTAL_FEE) {
        const totalRentalFee = snapshot.vehicles.reduce((sum, v) => sum + v.rental_fee, 0);
        const ratio = totalRentalFee > 0 ? refund.rentalFeeRefund / totalRentalFee : 0;
        refundedAmount = Math.round(compAmount * ratio);
      } else if (comp.type === PaymentComponentType.FB_PREORDER) {
        const ratio = snapshot.fnb_total > 0 ? refund.fnbRefund / snapshot.fnb_total : 0;
        refundedAmount = Math.round(compAmount * ratio);
      }

      if (refundedAmount > 0) {
        await em.update(PaymentComponent, comp.id, {
          status: PaymentComponentStatus.PENDING_REFUND,
          refundedAmount,
        });
      }
    }

    // Record pending manual refund transaction
    const txnRef = `${bookingId.replace(/-/g, '').substring(0, 28)}RFND`;
    const txRepo = em.getRepository(PaymentTransaction);
    await txRepo.save(
      txRepo.create({
        bookingId,
        customerPackageId: null,
        contestRegistrationId: null,
        subjectType: PaymentTransactionSubjectType.BOOKING,
        type: PaymentTransactionType.REFUND,
        gateway: 'DIRECT',
        txnRef,
        amount: refund.totalRefund,
        status: PaymentTransactionStatus.PENDING,
        rawRequest: { cancelledByRole, isNoShow },
      }),
    );
  });

  logger.info(
    'PaymentService',
    `refund processed bookingId=${bookingId} total=${refund.totalRefund}`,
  );
  return refund;
}

export type ManualRefundMethod = 'CASH' | 'BANK_TRANSFER';

export interface ConfirmRefundInput {
  method: ManualRefundMethod;
}

export async function confirmRefund(
  bookingId: string,
  staffUserId: string,
  confirmation: ConfirmRefundInput,
): Promise<void> {
  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: bookingId },
    select: ['id', 'cafeId', 'customerId'],
  });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

  const [assignment] = await AppDataSource.query<{ exists: boolean }[]>(
    `SELECT EXISTS(
       SELECT 1
       FROM staff_cafe_assignments assignment
       JOIN users staff ON staff.id = assignment.staff_id
       WHERE assignment.staff_id = $1
         AND assignment.cafe_id = $2
         AND staff.is_active = true
         AND staff.deleted_at IS NULL
     ) AS "exists"`,
    [staffUserId, booking.cafeId],
  );
  if (!assignment?.exists) {
    throw new AppError('Bạn không thuộc cơ sở của đơn đặt này', 403, 'BOOKING_CAFE_FORBIDDEN');
  }

  const now = new Date();
  await AppDataSource.transaction(async (em) => {
    const pendingComps = await em
      .getRepository(PaymentComponent)
      .createQueryBuilder('component')
      .setLock('pessimistic_write')
      .where('component.booking_id = :bookingId', { bookingId })
      .andWhere('component.status = :status', { status: PaymentComponentStatus.PENDING_REFUND })
      .getMany();
    if (pendingComps.length === 0) {
      throw new AppError(
        'Không có khoản hoàn tiền nào đang chờ xử lý cho đơn hàng này',
        400,
        'NO_PENDING_REFUND',
      );
    }

    const pendingTx = await em.findOne(PaymentTransaction, {
      where: {
        bookingId,
        type: PaymentTransactionType.REFUND,
        status: PaymentTransactionStatus.PENDING,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!pendingTx) {
      throw new AppError(
        'Không tìm thấy giao dịch hoàn tiền đang chờ xử lý',
        409,
        'REFUND_TRANSACTION_NOT_FOUND',
      );
    }

    // 1. Update all PENDING_REFUND components to REFUNDED
    for (const comp of pendingComps) {
      comp.status = PaymentComponentStatus.REFUNDED;
      comp.refundedAt = now;
      await em.save(comp);
    }

    // 2. Update the PENDING REFUND transaction with an auditable handoff record.
    pendingTx.status = PaymentTransactionStatus.SUCCESS;
    pendingTx.updatedAt = now;
    pendingTx.rawResponse = {
      ...((pendingTx.rawResponse ?? {}) as Record<string, unknown>),
      auditAction: 'MANUAL_REFUND_CONFIRMED',
      confirmedAt: now.toISOString(),
      confirmedBy: staffUserId,
      manualRefund: true,
      method: confirmation.method,
      amount: Number(pendingTx.amount),
    };
    await em.save(pendingTx);
  });

  const payload = {
    bookingId,
    cafeId: booking.cafeId,
    action: 'REFUND_CONFIRMED',
    updatedAt: now.toISOString(),
  };
  wsService.pushToCafe(booking.cafeId, 'BOOKING_PAYMENT_UPDATED', payload);
  wsService.pushToUser(booking.customerId, 'BOOKING_PAYMENT_UPDATED', payload);
  logger.info('PaymentService', `manual refund confirmed for bookingId=${bookingId}`, {
    staffUserId,
    method: confirmation.method,
  });
}

export async function createCheckoutAdditionalPaymentUrl(
  bookingId: string,
  ipAddr: string,
  customReturnUrl?: string,
  gatewayName = 'vnpay',
): Promise<{ payment_url: string | null; txn_ref: string; total_amount: number }> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

  const gateway = getPaymentGateway(gatewayName);

  const compRepo = AppDataSource.getRepository(PaymentComponent);
  const pendingComponents = await compRepo.find({
    where: { bookingId, status: PaymentComponentStatus.PENDING },
  });

  const totalCharged = pendingComponents.reduce((sum, c) => sum + Number(c.amount), 0);
  if (totalCharged <= 0) {
    throw new AppError(
      'Không có khoản thanh toán phát sinh nào cần xử lý',
      400,
      'NO_PENDING_ADDITIONAL_FEES',
    );
  }

  // Create unique txnRef starting with ctr_ to distinguish from initial payment
  const txnRef = `ctr_${bookingId.replace(/-/g, '').substring(0, 18)}_${Date.now()
    .toString()
    .slice(-4)}`;

  const gatewayResult = gateway.createPaymentUrl({
    amount: totalCharged,
    txnRef,
    orderInfo: `RCField checkout ${bookingId.substring(0, 8)}`,
    ipAddr,
    returnUrl: customReturnUrl,
    bankCode: 'VNBANK',
  });

  // Record pending transaction
  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const tx = txRepo.create({
    bookingId,
    customerPackageId: null,
    contestRegistrationId: null,
    subjectType: PaymentTransactionSubjectType.BOOKING,
    type: PaymentTransactionType.PAYMENT,
    gateway: gateway.name,
    txnRef,
    amount: totalCharged,
    status: PaymentTransactionStatus.PENDING,
    rawRequest: {
      bookingId,
      totalCharged,
      ipAddr,
      additionalPayment: true,
      components: pendingComponents.map((component) => ({
        id: component.id,
        type: component.type,
        amount: Number(component.amount),
      })),
      returnUrl: customReturnUrl,
      gateway: gateway.name,
    },
  });
  await txRepo.save(tx);

  if (gateway.name === 'MOCK' || env.vnpay.mockEnabled) {
    await processMockConfirmation(txnRef);
    const target = new URL('/payment/result', env.frontendUrl);
    target.searchParams.set('status', 'success');
    target.searchParams.set('txn_ref', txnRef);
    target.searchParams.set('booking_id', bookingId);
    target.searchParams.set('mock', '1');
    return { payment_url: target.toString(), txn_ref: txnRef, total_amount: totalCharged };
  }

  return { payment_url: gatewayResult.payment_url, txn_ref: txnRef, total_amount: totalCharged };
}

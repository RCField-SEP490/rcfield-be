import { AppDataSource } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Booking } from '../models/booking.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { BookingParticipant } from '../models/booking-participant.entity';
import { Cafe } from '../models/cafe.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { FnbOrder } from '../models/fnb-order.entity';
import { PaymentComponent } from '../models/payment-component.entity';
import { PaymentTransaction } from '../models/payment-transaction.entity';
import {
  AppError,
  BookingStatus,
  FnbOrderType,
  PaymentComponentStatus,
  PaymentComponentType,
  PaymentTransactionStatus,
  PaymentTransactionSubjectType,
  PaymentTransactionType,
  UserRole,
  NotificationType,
  ContestEntryFeePaymentStatus,
} from '../types';
import { createPaymentUrl, verifyVnpayParams } from './vnpay.service';
import { transition } from './booking.service';
import { emailService } from './email.service';
import { activateCustomerPackage, deductSlots } from './customer-package.service';
import { incrementPromoUsesCount } from './promotion.service';
import { wsService } from './websocket.service';
import { createNotification } from './notification.service';
import { writeContestAudit } from './contest.helpers';

async function pushBookingNew(booking: Booking): Promise<void> {
  try {
    const cafe = await AppDataSource.getRepository(Cafe).findOne({
      where: { id: booking.cafeId },
      select: ['providerId', 'name'],
    });
    if (!cafe) return;
    const payload = {
      bookingId: booking.id,
      cafeName: cafe.name,
      slotStart: booking.slotStart,
    };
    wsService.pushToUser(cafe.providerId, 'booking.new', payload);
    wsService.pushToCafe(booking.cafeId, 'NEW_BOOKING', payload);
  } catch (err) {
    logger.error('PaymentService', 'pushBookingNew failed', err);
  }
}

// ── Snapshot types (Constitution Principle I: prices from snapshot, never live) ─

/** Minimal shape required for refund calculation — stable across snapshot versions */
export interface RefundSnapshot {
  slot_fee_total: number;
  vehicles: Array<{ rental_fee: number; security_deposit: number }>;
  fnb_total: number;
  discount_amount: number;
  total_charged: number;
}

/** Full snapshot stored on Booking.snapshot at checkout time */
export interface BookingSnapshot extends RefundSnapshot {
  platform_fee_pct: number;
  captured_at: string;
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

// ── calculateRefundAmounts ────────────────────────────────────────────────────

/** Pure function — Constitution Principle V: exported for unit tests */
export function calculateRefundAmounts(
  snapshot: RefundSnapshot,
  role: UserRole,
  slotStart: Date,
  isNoShow = false,
): RefundBreakdown {
  const totalRentalFee = snapshot.vehicles.reduce((sum, v) => sum + v.rental_fee, 0);
  const totalDeposit = snapshot.vehicles.reduce((sum, v) => sum + v.security_deposit, 0);

  // R3: no-show or payment timeout — 0% slot, 100% rental + deposit
  if (isNoShow) {
    return {
      slotFeeRefund: 0,
      rentalFeeRefund: totalRentalFee,
      depositRefund: totalDeposit,
      fnbRefund: snapshot.fnb_total,
      totalRefund: totalRentalFee + totalDeposit + snapshot.fnb_total,
    };
  }

  // R2: provider cancellation — always 100% regardless of timing
  if (role === UserRole.PROVIDER) {
    const total = snapshot.slot_fee_total + totalRentalFee + totalDeposit + snapshot.fnb_total;
    return {
      slotFeeRefund: snapshot.slot_fee_total,
      rentalFeeRefund: totalRentalFee,
      depositRefund: totalDeposit,
      fnbRefund: snapshot.fnb_total,
      totalRefund: total,
    };
  }

  // R1: customer cancellation — time-based slot fee window
  const hoursBeforeSlot = (slotStart.getTime() - Date.now()) / (1000 * 60 * 60);

  let slotFeeRefund: number;
  if (hoursBeforeSlot > 24) {
    slotFeeRefund = snapshot.slot_fee_total; // 100%
  } else if (hoursBeforeSlot >= 12) {
    slotFeeRefund = Math.round(snapshot.slot_fee_total * 0.5); // 50%
  } else {
    slotFeeRefund = 0; // 0%
  }

  return {
    slotFeeRefund,
    rentalFeeRefund: totalRentalFee,
    depositRefund: totalDeposit,
    fnbRefund: snapshot.fnb_total,
    totalRefund: slotFeeRefund + totalRentalFee + totalDeposit + snapshot.fnb_total,
  };
}

// ── createCheckoutUrl ─────────────────────────────────────────────────────────

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

  // Collect pricing from child rows to freeze into snapshot
  const bvRepo = AppDataSource.getRepository(BookingVehicle);
  const bookingVehicles = await bvRepo.find({ where: { bookingId } });

  logger.info('PaymentService', 'checkout vehicles snapshot', {
    bookingId,
    count: bookingVehicles.length,
    rows: bookingVehicles.map((v) => ({
      vehicleId: v.vehicleId,
      rentalFeeSnapshot: Number(v.rentalFeeSnapshot),
      securityDepositSnapshot: Number(v.securityDepositSnapshot),
    })),
  });

  const fnbRepo = AppDataSource.getRepository(FnbOrder);
  const fnbOrders = await fnbRepo.find({ where: { bookingId, orderType: FnbOrderType.PRE_ORDER } });
  const fnbTotal = fnbOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  const rentalFeeTotal = bookingVehicles.reduce((sum, v) => sum + Number(v.rentalFeeSnapshot), 0);
  const depositTotal = bookingVehicles.reduce(
    (sum, v) => sum + Number(v.securityDepositSnapshot),
    0,
  );

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

  // If package was applied, slot fee is 0 (createBooking already validated ownership)
  const packageUsed = (booking.snapshot as unknown as BookingSnapshot | null)?.package_used;
  const slotFee = booking.customerPackageId ? 0 : rawSlotFee;

  const grossTotal = slotFee + rentalFeeTotal + depositTotal + fnbTotal;
  const discountAmount = Number(booking.discountAmount) || 0;
  const totalCharged = Math.max(0, grossTotal - discountAmount);

  logger.info('PaymentService', 'checkout totals', {
    bookingId,
    slotFee,
    rentalFeeTotal,
    depositTotal,
    fnbTotal,
    discountAmount,
    totalCharged,
    playerCount,
    slotCount,
    slotMultiplier,
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
    slot_fee_total: slotFee,
    vehicles: bookingVehicles.map((v) => ({
      rental_fee: Number(v.rentalFeeSnapshot),
      security_deposit: Number(v.securityDepositSnapshot),
    })),
    fnb_total: fnbTotal,
    discount_amount: discountAmount,
    total_charged: totalCharged,
    platform_fee_pct: 0,
    captured_at: new Date().toISOString(),
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
          rawRequest: { zeroTotal: true, packageApplied: booking.customerPackageId },
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

  // Tạo txnRef duy nhất cho lần thanh toán này để cho phép thanh toán lại khi bị lỗi/hủy (giới hạn tối đa 30 ký tự của VNPay)
  const txnRef = `${bookingId.replace(/-/g, '').substring(0, 20)}_${Date.now().toString().slice(-4)}`;

  const vnpayPaymentUrl = createPaymentUrl({
    amount: totalCharged,
    txnRef,
    orderInfo: `RCField booking ${bookingId.substring(0, 8)}`,
    ipAddr,
    returnUrl: customReturnUrl,
    bankCode: 'VNBANK',
  });

  logger.debug(
    'VNPay',
    `payment URL params: amount=${totalCharged} txnRef=${txnRef} url=${vnpayPaymentUrl}`,
  );

  // Record pending transaction
  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const existingTx = await txRepo.findOne({ where: { txnRef } });
  if (!existingTx) {
    const tx = txRepo.create({
      bookingId,
      customerPackageId: null,
      contestRegistrationId: null,
      subjectType: PaymentTransactionSubjectType.BOOKING,
      type: PaymentTransactionType.PAYMENT,
      gateway: 'VNPAY',
      txnRef,
      amount: totalCharged,
      status: PaymentTransactionStatus.PENDING,
      rawRequest: { bookingId, totalCharged, ipAddr },
    });
    await txRepo.save(tx);
  }

  if (env.vnpay.mockEnabled) {
    await processMockConfirmation(txnRef);
    const target = new URL('/payment/result', env.frontendUrl);
    target.searchParams.set('status', 'success');
    target.searchParams.set('txn_ref', txnRef);
    target.searchParams.set('mock', '1');
    logger.info(
      'PaymentService',
      `mock checkout confirmed txnRef=${txnRef} bookingId=${bookingId}`,
    );
    return { payment_url: target.toString(), txn_ref: txnRef, total_amount: totalCharged };
  }

  logger.info('PaymentService', `checkout created txnRef=${txnRef} bookingId=${bookingId}`);

  return { payment_url: vnpayPaymentUrl, txn_ref: txnRef, total_amount: totalCharged };
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

  const components: Partial<PaymentComponent>[] = [
    {
      bookingId: booking.id,
      bookingVehicleId: null,
      type: PaymentComponentType.SLOT_FEE,
      amount: slotFeeTotal,
      status: PaymentComponentStatus.HELD,
    },
  ];

  for (const bv of bookingVehicles) {
    components.push({
      bookingId: booking.id,
      bookingVehicleId: bv.id,
      type: PaymentComponentType.RENTAL_FEE,
      amount: Number(bv.rentalFeeSnapshot ?? 0),
      status: PaymentComponentStatus.HELD,
    });
    if (Number(bv.securityDepositSnapshot ?? 0) > 0) {
      components.push({
        bookingId: booking.id,
        bookingVehicleId: bv.id,
        type: PaymentComponentType.SECURITY_DEPOSIT,
        amount: Number(bv.securityDepositSnapshot ?? 0),
        status: PaymentComponentStatus.HELD,
      });
    }
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

/** Idempotent IPN/return handler — safe to call multiple times for same txnRef */
export async function processConfirmation(
  vnpParams: Record<string, unknown>,
): Promise<{ rspCode: string; message: string }> {
  const result = verifyVnpayParams(vnpParams);

  if (!result.isValid) {
    return { rspCode: '97', message: 'Invalid signature' };
  }

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
      rawResponse: vnpParams as object,
    });
    logger.info('PaymentService', `payment failed txnRef=${result.txnRef}`);
    return { rspCode: result.responseCode, message: 'Payment failed' };
  }

  // Mark transaction SUCCESS
  await txRepo.update(tx.id, {
    status: PaymentTransactionStatus.SUCCESS,
    rawResponse: vnpParams as object,
  });

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
      payment_source: 'VNPAY',
      payment_txn_ref: result.txnRef,
    };
    await registrationRepo.save(registration);
    await writeContestAudit({
      contestId: registration.contestId,
      registrationId: registration.id,
      actorId: null,
      actorRole: 'SYSTEM',
      eventType: 'registration.entry_fee_marked_paid',
      afterJson: { paymentStatus: registration.paymentStatus, payment_source: 'VNPAY' },
      reason: 'VNPay confirmation',
    });
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
    const compRepo = AppDataSource.getRepository(PaymentComponent);
    const pendingComponents = await compRepo.find({
      where: { bookingId: tx.bookingId, status: PaymentComponentStatus.PENDING },
    });

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
              route: `/staff/session/${session.id}`,
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
    const compRepo = AppDataSource.getRepository(PaymentComponent);
    const pendingComponents = await compRepo.find({
      where: { bookingId: tx.bookingId, status: PaymentComponentStatus.PENDING },
    });

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
              route: `/staff/session/${session.id}`,
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
  const depositTotal = bookingVehicles.reduce(
    (sum, v) => sum + Number(v.securityDepositSnapshot),
    0,
  );

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
  const slotFee = Math.round(Number(cafe.slotFeeRate) * slotCount * playerCount * slotMultiplier);
  const grossMockTotal = slotFee + rentalFeeTotal + depositTotal + fnbTotal;
  const mockDiscountAmount = Number(booking.discountAmount) || 0;
  const totalCharged = Math.max(0, grossMockTotal - mockDiscountAmount);

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

  const snapshot: BookingSnapshot = {
    slot_fee_total: slotFee,
    vehicles: bookingVehicles.map((v) => ({
      rental_fee: Number(v.rentalFeeSnapshot),
      security_deposit: Number(v.securityDepositSnapshot),
    })),
    fnb_total: fnbTotal,
    discount_amount: mockDiscountAmount,
    total_charged: totalCharged,
    platform_fee_pct: 0,
    captured_at: new Date().toISOString(),
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
  await createPaymentComponents(booking, snapshot, bookingVehicles);

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

  const snapshot = booking.snapshot as unknown as BookingSnapshot | null;
  if (!snapshot) {
    // No payment was ever processed — nothing to refund
    return { slotFeeRefund: 0, rentalFeeRefund: 0, depositRefund: 0, fnbRefund: 0, totalRefund: 0 };
  }

  const refund = calculateRefundAmounts(snapshot, cancelledByRole, booking.slotStart, isNoShow);

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
      } else if (comp.type === PaymentComponentType.SECURITY_DEPOSIT) {
        const totalDeposit = snapshot.vehicles.reduce((sum, v) => sum + v.security_deposit, 0);
        const ratio = totalDeposit > 0 ? refund.depositRefund / totalDeposit : 0;
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

export async function confirmRefund(bookingId: string): Promise<void> {
  const compRepo = AppDataSource.getRepository(PaymentComponent);

  const pendingComps = await compRepo.find({
    where: { bookingId, status: PaymentComponentStatus.PENDING_REFUND },
  });

  if (pendingComps.length === 0) {
    throw new AppError(
      'Không có khoản hoàn tiền nào đang chờ xử lý cho đơn hàng này',
      400,
      'NO_PENDING_REFUND',
    );
  }

  const now = new Date();
  await AppDataSource.transaction(async (em) => {
    // 1. Update all PENDING_REFUND components to REFUNDED
    for (const comp of pendingComps) {
      comp.status = PaymentComponentStatus.REFUNDED;
      comp.refundedAt = now;
      await em.save(comp);
    }

    // 2. Update the PENDING REFUND transaction to SUCCESS
    const pendingTx = await em.findOne(PaymentTransaction, {
      where: {
        bookingId,
        type: PaymentTransactionType.REFUND,
        status: PaymentTransactionStatus.PENDING,
      },
    });

    if (pendingTx) {
      pendingTx.status = PaymentTransactionStatus.SUCCESS;
      pendingTx.updatedAt = now;
      if (pendingTx.rawResponse) {
        pendingTx.rawResponse = {
          ...(pendingTx.rawResponse as Record<string, unknown>),
          confirmedAt: now.toISOString(),
          manualRefund: true,
        };
      } else {
        pendingTx.rawResponse = { confirmedAt: now.toISOString(), manualRefund: true };
      }
      await em.save(pendingTx);
    }
  });

  logger.info('PaymentService', `manual refund confirmed for bookingId=${bookingId}`);
}

export async function createCheckoutAdditionalPaymentUrl(
  bookingId: string,
  ipAddr: string,
  customReturnUrl?: string,
): Promise<{ payment_url: string | null; txn_ref: string; total_amount: number }> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

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

  const vnpayPaymentUrl = createPaymentUrl({
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
    gateway: 'VNPAY',
    txnRef,
    amount: totalCharged,
    status: PaymentTransactionStatus.PENDING,
    rawRequest: {
      bookingId,
      totalCharged,
      ipAddr,
      additionalPayment: true,
      returnUrl: customReturnUrl,
    },
  });
  await txRepo.save(tx);

  if (env.vnpay.mockEnabled) {
    await processMockConfirmation(txnRef);
    const target = new URL('/payment/result', env.frontendUrl);
    target.searchParams.set('status', 'success');
    target.searchParams.set('txn_ref', txnRef);
    target.searchParams.set('mock', '1');
    return { payment_url: target.toString(), txn_ref: txnRef, total_amount: totalCharged };
  }

  return { payment_url: vnpayPaymentUrl, txn_ref: txnRef, total_amount: totalCharged };
}

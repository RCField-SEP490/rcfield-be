import { IsNull, QueryRunner } from 'typeorm';
import { AppDataSource } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { CustomerPackage } from '../models/customer-package.entity';
import { Package } from '../models/package.entity';
import { PaymentTransaction } from '../models/payment-transaction.entity';
import { Booking } from '../models/booking.entity';
import { Cafe } from '../models/cafe.entity';
import {
  AppError,
  CustomerPackageStatus,
  PackageStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
  UserRole,
} from '../types';
import { createPaymentUrl } from './vnpay.service';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface PurchasePackageResult {
  customer_package_id: string;
  payment_url: string;
  txn_ref: string;
  amount: number;
  expires_at: string;
}

// ── purchasePackage ───────────────────────────────────────────────────────────

/** Creates a CustomerPackage in PENDING_PAYMENT and a VNPay checkout URL */
export async function purchasePackage(
  cafeId: string,
  packageId: string,
  viewer: Viewer,
  ipAddr: string,
  customReturnUrl?: string,
): Promise<PurchasePackageResult> {
  const pkg = await AppDataSource.getRepository(Package).findOne({
    where: { id: packageId, cafeId, deletedAt: IsNull() },
  });
  if (!pkg) throw new AppError('Gói không tồn tại', 404, 'PACKAGE_NOT_FOUND');
  if (pkg.status !== PackageStatus.ACTIVE) {
    throw new AppError('Gói không hoạt động', 400, 'PACKAGE_INACTIVE');
  }

  const cpRepo = AppDataSource.getRepository(CustomerPackage);

  const existing = await cpRepo.findOne({
    where: [
      { customerId: viewer.userId, packageId, status: CustomerPackageStatus.ACTIVE },
      { customerId: viewer.userId, packageId, status: CustomerPackageStatus.PENDING_PAYMENT },
    ],
  });
  if (existing) {
    throw new AppError(
      'Bạn đã có gói này đang hoạt động hoặc chờ thanh toán',
      409,
      'PACKAGE_ALREADY_OWNED',
    );
  }

  const cp = cpRepo.create({
    customerId: viewer.userId,
    packageId,
    cafeId,
    slotsTotal: pkg.slotCount,
    slotsRemaining: pkg.slotCount,
    expiresAt: new Date(Date.now() + pkg.validDays * 24 * 60 * 60 * 1000),
    status: CustomerPackageStatus.PENDING_PAYMENT,
    purchasedPrice: Number(pkg.price),
    packageNameSnapshot: pkg.name,
  });
  const savedCp = await cpRepo.save(cp);

  // Tạo txnRef duy nhất bắt đầu bằng pkg_ để tránh trùng lặp khi bấm thanh toán lại đơn mua gói
  const txnRef = `pkg_${savedCp.id.replace(/-/g, '').substring(0, 20)}_${Date.now().toString().slice(-4)}`;

  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const existingTx = await txRepo.findOne({ where: { txnRef } });
  if (!existingTx) {
    const tx = txRepo.create({
      bookingId: null,
      customerPackageId: savedCp.id,
      type: PaymentTransactionType.PAYMENT,
      gateway: 'VNPAY',
      txnRef,
      amount: Number(pkg.price),
      status: PaymentTransactionStatus.PENDING,
      rawRequest: { customerId: viewer.userId, packageId, cafeId },
    });
    await txRepo.save(tx);
  }

  let paymentUrl: string;

  if (env.vnpay.mockEnabled) {
    // Auto-confirm inline — avoids circular import with payment.service
    await activateCustomerPackage(savedCp.id);
    await AppDataSource.getRepository(PaymentTransaction).update(
      { txnRef },
      { status: PaymentTransactionStatus.SUCCESS, rawResponse: { mock: true, txnRef } },
    );
    const target = new URL('/payment/result', env.frontendUrl);
    target.searchParams.set('status', 'success');
    target.searchParams.set('txn_ref', txnRef);
    target.searchParams.set('mock', '1');
    paymentUrl = target.toString();
    logger.info(
      'CustomerPackageService',
      `mock purchase confirmed customerPackageId=${savedCp.id}`,
    );
  } else {
    paymentUrl = createPaymentUrl({
      amount: Number(pkg.price),
      txnRef,
      orderInfo: `RCField package ${savedCp.id.substring(0, 8)}`,
      ipAddr,
      returnUrl: customReturnUrl,
      bankCode: 'VNBANK',
    });
  }

  logger.info(
    'CustomerPackageService',
    `purchase initiated customerPackageId=${savedCp.id} amount=${pkg.price}`,
  );

  return {
    customer_package_id: savedCp.id,
    payment_url: paymentUrl,
    txn_ref: txnRef,
    amount: Number(pkg.price),
    expires_at: savedCp.expiresAt.toISOString(),
  };
}

// ── activateCustomerPackage ───────────────────────────────────────────────────

/** Called from IPN — sets status=ACTIVE, recalculates expires_at from validDays */
export async function activateCustomerPackage(
  customerPackageId: string,
  queryRunner?: QueryRunner,
): Promise<void> {
  const repo = queryRunner
    ? queryRunner.manager.getRepository(CustomerPackage)
    : AppDataSource.getRepository(CustomerPackage);

  const cp = await repo.findOne({ where: { id: customerPackageId } });
  if (!cp) throw new AppError('CustomerPackage not found', 404, 'CUSTOMER_PACKAGE_NOT_FOUND');

  const pkg = await AppDataSource.getRepository(Package).findOne({
    where: { id: cp.packageId },
  });
  if (!pkg) throw new AppError('Package not found', 404, 'PACKAGE_NOT_FOUND');

  const validDays = pkg.validDays > 0 ? pkg.validDays : 30;
  if (pkg.validDays <= 0) {
    logger.warn(
      'CustomerPackageService',
      `packageId=${pkg.id} has invalid validDays=${pkg.validDays}, falling back to 30`,
    );
  }

  cp.status = CustomerPackageStatus.ACTIVE;
  cp.expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);

  await repo.save(cp);

  logger.info(
    'CustomerPackageService',
    `activated customerPackageId=${customerPackageId} validDays=${validDays} expires=${cp.expiresAt.toISOString()}`,
  );
}

// ── deductSlots ───────────────────────────────────────────────────────────────

/** Atomically decrement slots_remaining. Use FOR UPDATE (pessimistic lock). */
export async function deductSlots(
  customerPackageId: string,
  slotsUsed: number,
  queryRunner: QueryRunner,
): Promise<void> {
  const result = await queryRunner.manager.query<{ id: string; slots_remaining: number }[]>(
    `SELECT id, slots_remaining FROM customer_packages WHERE id = $1 FOR UPDATE`,
    [customerPackageId],
  );
  if (!result.length)
    throw new AppError('CustomerPackage not found', 404, 'CUSTOMER_PACKAGE_NOT_FOUND');

  const current = result[0].slots_remaining;
  if (current < slotsUsed) {
    throw new AppError('Package has insufficient slots', 400, 'PACKAGE_INSUFFICIENT_SLOTS');
  }

  const newRemaining = current - slotsUsed;
  const newStatus =
    newRemaining === 0 ? CustomerPackageStatus.EXHAUSTED : CustomerPackageStatus.ACTIVE;

  await queryRunner.manager.query(
    `UPDATE customer_packages SET slots_remaining = $1, status = $2, updated_at = NOW() WHERE id = $3`,
    [newRemaining, newStatus, customerPackageId],
  );

  logger.info(
    'CustomerPackageService',
    `deducted ${slotsUsed} slots from customerPackageId=${customerPackageId} remaining=${newRemaining}`,
  );
}

// ── refundSlots ───────────────────────────────────────────────────────────────

/** Atomically increment slots_remaining on cancellation before slot_start. */
export async function refundSlots(
  customerPackageId: string,
  slotsUsed: number,
  queryRunner: QueryRunner,
): Promise<void> {
  const result = await queryRunner.manager.query<
    { id: string; slots_remaining: number; status: string; slots_total: number }[]
  >(
    `SELECT id, slots_remaining, status, slots_total FROM customer_packages WHERE id = $1 FOR UPDATE`,
    [customerPackageId],
  );
  if (!result.length)
    throw new AppError('CustomerPackage not found', 404, 'CUSTOMER_PACKAGE_NOT_FOUND');

  const cp = result[0];
  const newRemaining = cp.slots_remaining + slotsUsed;
  // Restore to ACTIVE if was EXHAUSTED (valid per spec FR-015)
  const newStatus =
    cp.status === CustomerPackageStatus.EXHAUSTED ? CustomerPackageStatus.ACTIVE : cp.status;

  await queryRunner.manager.query(
    `UPDATE customer_packages SET slots_remaining = $1, status = $2, updated_at = NOW() WHERE id = $3`,
    [newRemaining, newStatus, customerPackageId],
  );

  logger.info(
    'CustomerPackageService',
    `refunded ${slotsUsed} slots to customerPackageId=${customerPackageId} remaining=${newRemaining}`,
  );
}

// ── listMyPackages ────────────────────────────────────────────────────────────

export interface MyPackageResponse {
  id: string;
  package_id: string;
  cafe_id: string;
  cafe_name: string;
  package_name: string;
  applicable_play_modes: string[];
  slots_total: number;
  slots_remaining: number;
  expires_at: string;
  status: CustomerPackageStatus;
  purchased_price: number;
  created_at: string;
}

/**
 * Trạng thái hiệu lực tại thời điểm đọc.
 *
 * Cột `cp.status` chỉ được cron `package-expiry.job.ts` cập nhật lúc 00:05 mỗi
 * ngày, nên gói đã quá hạn vẫn nằm ở ACTIVE cho tới lần chạy kế tiếp — và nếu
 * server không chạy vào thời điểm đó thì kẹt vô thời hạn. Suy ra trạng thái
 * ngay khi đọc để giao diện luôn đúng, không phụ thuộc cron.
 *
 * Chỉ chuyển ACTIVE → EXPIRED. EXHAUSTED (đã dùng hết lượt) giữ nguyên vì đó
 * mới là thông tin hữu ích với khách.
 */
const EFFECTIVE_STATUS_SQL = `CASE
  WHEN cp.status = '${CustomerPackageStatus.ACTIVE}' AND cp.expires_at < NOW()
  THEN '${CustomerPackageStatus.EXPIRED}'
  ELSE cp.status
END`;

export async function listMyPackages(
  customerId: string,
  query: { status?: CustomerPackageStatus; cafe_id?: string },
): Promise<MyPackageResponse[]> {
  let qb = AppDataSource.createQueryBuilder(CustomerPackage, 'cp')
    .innerJoin(Cafe, 'c', 'c.id = cp.cafe_id')
    .leftJoin(Package, 'pkg', 'pkg.id = cp.package_id')
    .select([
      'cp.id AS id',
      'cp.package_id AS package_id',
      'cp.cafe_id AS cafe_id',
      'c.name AS cafe_name',
      'cp.package_name_snapshot AS package_name',
      "COALESCE(pkg.applicable_play_modes, '{}') AS applicable_play_modes",
      'cp.slots_total AS slots_total',
      'cp.slots_remaining AS slots_remaining',
      'cp.expires_at AS expires_at',
      `${EFFECTIVE_STATUS_SQL} AS status`,
      'cp.purchased_price AS purchased_price',
      'cp.created_at AS created_at',
    ])
    .where('cp.customer_id = :customerId', { customerId })
    .orderBy('cp.created_at', 'DESC');

  if (query.status) {
    // Lọc theo trạng thái hiệu lực, không theo cột thô — nếu không, ?status=ACTIVE
    // sẽ trả về cả gói đã quá hạn mà cron chưa kịp cập nhật.
    qb = qb.andWhere(`${EFFECTIVE_STATUS_SQL} = :status`, { status: query.status });
  }
  if (query.cafe_id) {
    qb = qb.andWhere('cp.cafe_id = :cafeId', { cafeId: query.cafe_id });
  }

  const rows = await qb.getRawMany<MyPackageResponse>();
  return rows;
}

// ── getPackageUsageHistory ────────────────────────────────────────────────────

export interface PackageUsageEntry {
  booking_id: string;
  slot_start: string;
  slot_end: string;
  slots_used: number;
  cafe_name: string;
  booking_status: string;
}

export async function getPackageUsageHistory(
  customerPackageId: string,
  customerId: string,
): Promise<PackageUsageEntry[]> {
  const cpRepo = AppDataSource.getRepository(CustomerPackage);
  const cp = await cpRepo.findOne({ where: { id: customerPackageId, customerId } });
  if (!cp) throw new AppError('Package not found or not owned', 404, 'CUSTOMER_PACKAGE_NOT_FOUND');

  type RawUsageRow = {
    booking_id: string;
    slot_start: string;
    slot_end: string;
    booking_status: string;
    cafe_name: string;
    snapshot: { package_used?: { slots_used?: number } } | null;
  };

  const rows = await AppDataSource.createQueryBuilder(Booking, 'b')
    .innerJoin(Cafe, 'c', 'c.id = b.cafe_id')
    .select([
      'b.id AS booking_id',
      'b.slot_start AS slot_start',
      'b.slot_end AS slot_end',
      'b.status AS booking_status',
      'b.snapshot AS snapshot',
      'c.name AS cafe_name',
    ])
    .where('b.customer_package_id = :cpId', { cpId: customerPackageId })
    .andWhere('b.deleted_at IS NULL')
    .orderBy('b.slot_start', 'DESC')
    .getRawMany<RawUsageRow>();

  return rows.map((r) => ({
    booking_id: r.booking_id,
    slot_start: r.slot_start,
    slot_end: r.slot_end,
    slots_used: r.snapshot?.package_used?.slots_used ?? 0,
    cafe_name: r.cafe_name,
    booking_status: r.booking_status,
  }));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { IsNull, LessThan, MoreThan, Not, In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import {
  AppError,
  AuthProvider,
  BookingSource,
  BookingStatus,
  UserRole,
  SessionStatus,
  ParticipantRole,
  VehicleSource,
  SessionVehicleStatus,
  InspectionType,
  InspectionSubjectType,
  PhotoAngle,
  InspectionItemStatus,
  ExtensionProposalStatus,
  VehicleStatus,
  FnbOrderType,
  FnbOrderStatus,
  NotificationType,
  PaymentComponentType,
  PaymentComponentStatus,
  PaymentTransactionType,
  PaymentTransactionStatus,
  BookingParticipantType,
} from '../types';
import { User } from '../models/user.entity';
import { PaymentComponent } from '../models/payment-component.entity';
import { PaymentTransaction } from '../models/payment-transaction.entity';
import { StaffInviteToken } from '../models/staff-invite-token.entity';
import { Session } from '../models/session.entity';
import { SessionParticipant } from '../models/session-participant.entity';
import { SessionVehicle } from '../models/session-vehicle.entity';
import { Booking } from '../models/booking.entity';
import { BookingParticipant } from '../models/booking-participant.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { Vehicle } from '../models/vehicle.entity';
import { Inspection } from '../models/inspection.entity';
import { InspectionPhoto } from '../models/inspection-photo.entity';
import { InspectionChecklist } from '../models/inspection-checklist.entity';
import { ExtensionProposal } from '../models/extension-proposal.entity';
import { FnbOrder } from '../models/fnb-order.entity';
import { FnbOrderItem } from '../models/fnb-order-item.entity';
import { MenuItem } from '../models/menu-item.entity';
import { emailService } from './email.service';
import { authService } from './auth.service';
import { transition } from './booking.service';
import { env } from '../config/env';
import { wsService } from './websocket.service';
import { createNotification } from './notification.service';

export interface CreateStaffInput {
  cafe_id: string;
  full_name: string;
  email: string;
  phone?: string;
}

export interface StaffProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole.STAFF;
  cafeId: string;
  assignedBy: string;
  emailSent: boolean;
}

export interface StaffListItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  cafeId: string;
  cafeName: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  createdAt: string;
  activatedAt: string | null;
  inviteExpiresAt: string | null;
}

export interface TodayBookingItem {
  id: string;
  customerName: string;
  customerPhone: string | null;
  startTime: string;
  endTime: string;
  createdAt: string;
  status: string;
  mode: string;
  vehicleName: string | null;
  trackTypeName: string | null;
  participantCount: number;
  vehicleCount: number;
  fnbPreorderAmount: number;
}

const INVITE_TOKEN_TTL_HOURS = 48;

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function createStaffForProvider(
  providerId: string,
  input: CreateStaffInput,
): Promise<StaffProfile> {
  const email = input.email.toLowerCase().trim();
  logger.info('Staff', 'invite staff requested', { providerId, cafeId: input.cafe_id, email });

  const profile = await AppDataSource.transaction(async (manager) => {
    const [cafe] = await manager.query<{ id: string; provider_id: string }[]>(
      `SELECT id, provider_id
       FROM cafes
       WHERE id = $1 AND provider_id = $2 AND deleted_at IS NULL`,
      [input.cafe_id, providerId],
    );

    if (!cafe) {
      logger.warn('Staff', 'provider tried to invite staff outside owned cafe', {
        providerId,
        cafeId: input.cafe_id,
        email,
      });
      throw new AppError('Cafe không tồn tại hoặc không thuộc Provider này', 404, 'CAFE_NOT_FOUND');
    }

    const existing = await manager.getRepository(User).findOne({ where: { email } });
    if (existing) {
      logger.warn('Staff', 'staff email already exists', { providerId, cafeId: cafe.id, email });
      throw new AppError('Email đã được sử dụng', 409, 'EMAIL_ALREADY_EXISTS');
    }

    const userRepo = manager.getRepository(User);
    const staff = await userRepo.save(
      userRepo.create({
        email,
        full_name: input.full_name.trim(),
        phone: input.phone ?? null,
        password_hash: null,
        role: UserRole.STAFF,
        auth_provider: AuthProvider.LOCAL,
        is_active: false,
      }),
    );

    await manager.query(
      `INSERT INTO staff_cafe_assignments (staff_id, cafe_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [staff.id, cafe.id, providerId],
    );

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await manager.getRepository(StaffInviteToken).save(
      manager.getRepository(StaffInviteToken).create({
        user_id: staff.id,
        token: hashToken(rawToken),
        expires_at: expiresAt,
      }),
    );

    return {
      id: staff.id,
      email: staff.email,
      fullName: staff.full_name,
      phone: staff.phone,
      role: UserRole.STAFF as const,
      cafeId: cafe.id,
      assignedBy: providerId,
      rawToken,
    };
  });

  const inviteUrl = `${env.frontendUrl}/staff-invite/activate?token=${profile.rawToken}`;
  let emailSent = false;

  try {
    await emailService.sendStaffInvite({
      to: profile.email,
      fullName: profile.fullName,
      inviteUrl,
    });
    emailSent = true;
  } catch (err) {
    logger.error('Staff', 'failed to send invite email', err);
  }

  logger.info('Staff', 'staff invited', {
    providerId,
    cafeId: profile.cafeId,
    staffId: profile.id,
    email: profile.email,
    emailSent,
  });

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    phone: profile.phone,
    role: profile.role,
    cafeId: profile.cafeId,
    assignedBy: profile.assignedBy,
    emailSent,
  };
}

export async function listStaffForProvider(
  providerId: string,
  cafeId?: string,
): Promise<StaffListItem[]> {
  const params: unknown[] = [providerId];
  let cafeFilter = '';
  if (cafeId) {
    params.push(cafeId);
    cafeFilter = `AND c.id = $${params.length}`;
  }

  const rows = await AppDataSource.query<
    {
      id: string;
      email: string;
      full_name: string;
      phone: string | null;
      cafe_id: string;
      cafe_name: string;
      is_active: boolean;
      created_at: Date;
      activated_at: Date | null;
      has_active_token: boolean;
      invite_expires_at: Date | null;
    }[]
  >(
    `SELECT
       u.id,
       u.email,
       u.full_name,
       u.phone,
       c.id      AS cafe_id,
       c.name    AS cafe_name,
       u.is_active,
       u.created_at,
       u.updated_at AS activated_at,
       EXISTS(
         SELECT 1 FROM staff_invite_tokens t
         WHERE t.user_id = u.id
           AND t.used_at IS NULL
           AND t.expires_at > NOW()
       ) AS has_active_token,
       (
         SELECT t.expires_at FROM staff_invite_tokens t
         WHERE t.user_id = u.id
           AND t.used_at IS NULL
         ORDER BY t.created_at DESC
         LIMIT 1
       ) AS invite_expires_at
     FROM users u
     JOIN staff_cafe_assignments a ON a.staff_id = u.id
     JOIN cafes c ON c.id = a.cafe_id
     WHERE c.provider_id = $1
       AND u.deleted_at IS NULL
       ${cafeFilter}
     ORDER BY u.created_at DESC`,
    params,
  );

  return rows.map((row) => {
    let status: 'PENDING' | 'ACTIVE' | 'DISABLED';
    if (row.is_active) {
      status = 'ACTIVE';
    } else if (row.has_active_token) {
      status = 'PENDING';
    } else {
      status = 'DISABLED';
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      cafeId: row.cafe_id,
      cafeName: row.cafe_name,
      status,
      createdAt: row.created_at.toISOString(),
      activatedAt: status === 'ACTIVE' && row.activated_at ? row.activated_at.toISOString() : null,
      inviteExpiresAt:
        status === 'PENDING' && row.invite_expires_at ? row.invite_expires_at.toISOString() : null,
    };
  });
}

export async function deactivateStaff(providerId: string, staffId: string): Promise<void> {
  const staff = await getStaffOwnedByProvider(providerId, staffId);

  const hasActiveToken = await hasActiveInviteToken(staffId);

  if (!staff.is_active && !hasActiveToken) {
    throw new AppError('Nhân viên đã bị vô hiệu hóa', 409, 'STAFF_ALREADY_DISABLED');
  }

  await AppDataSource.getRepository(User).update(staffId, { is_active: false });
  logger.info('Staff', 'staff deactivated', { providerId, staffId });
}

export async function reactivateStaff(providerId: string, staffId: string): Promise<void> {
  const staff = await getStaffOwnedByProvider(providerId, staffId);

  if (staff.is_active) {
    throw new AppError('Nhân viên đang hoạt động', 409, 'STAFF_NOT_DISABLED');
  }

  const hasActiveToken = await hasActiveInviteToken(staffId);
  if (hasActiveToken) {
    throw new AppError(
      'Nhân viên chưa kích hoạt tài khoản. Dùng "Gửi lại lời mời" thay vì kích hoạt lại.',
      409,
      'STAFF_PENDING_ACTIVATION',
    );
  }

  await AppDataSource.getRepository(User).update(staffId, { is_active: true });
  logger.info('Staff', 'staff reactivated', { providerId, staffId });
}

export async function resendInvite(
  providerId: string,
  staffId: string,
): Promise<{ emailSent: boolean }> {
  const staff = await getStaffOwnedByProvider(providerId, staffId);

  if (staff.is_active) {
    throw new AppError(
      'Tài khoản đã được kích hoạt. Không thể gửi lại lời mời.',
      409,
      'STAFF_ALREADY_ACTIVE',
    );
  }

  const tokenRepo = AppDataSource.getRepository(StaffInviteToken);
  await tokenRepo.delete({ user_id: staffId });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await tokenRepo.save(
    tokenRepo.create({
      user_id: staffId,
      token: hashToken(rawToken),
      expires_at: expiresAt,
    }),
  );

  const inviteUrl = `${env.frontendUrl}/staff-invite/activate?token=${rawToken}`;
  let emailSent = false;

  try {
    await emailService.sendStaffInvite({
      to: staff.email,
      fullName: staff.full_name,
      inviteUrl,
    });
    emailSent = true;
  } catch (err) {
    logger.error('Staff', 'failed to resend invite email', err);
  }

  logger.info('Staff', 'invite resent', { providerId, staffId, emailSent });
  return { emailSent };
}

export async function validateInviteToken(
  rawToken: string,
): Promise<{ email: string; fullName: string }> {
  const tokenRepo = AppDataSource.getRepository(StaffInviteToken);
  const row = await tokenRepo.findOne({
    where: { token: hashToken(rawToken) },
  });

  if (!row || row.used_at) {
    throw new AppError(
      'Link kích hoạt không hợp lệ hoặc đã được sử dụng',
      400,
      'INVITE_TOKEN_INVALID',
    );
  }

  if (row.expires_at <= new Date()) {
    throw new AppError(
      'Link kích hoạt đã hết hạn. Vui lòng liên hệ Provider để gửi lại lời mời.',
      410,
      'INVITE_TOKEN_EXPIRED',
    );
  }

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: row.user_id } });
  if (!user) {
    throw new AppError('Tài khoản không tồn tại', 404, 'USER_NOT_FOUND');
  }

  return { email: user.email, fullName: user.full_name };
}

export async function activateStaffAccount(
  rawToken: string,
  password: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; fullName: string; role: string; cafeId: string | null };
}> {
  const tokenRepo = AppDataSource.getRepository(StaffInviteToken);
  const row = await tokenRepo.findOne({ where: { token: hashToken(rawToken) } });

  if (!row || row.used_at) {
    throw new AppError(
      'Link kích hoạt không hợp lệ hoặc đã được sử dụng',
      400,
      'INVITE_TOKEN_INVALID',
    );
  }

  if (row.expires_at <= new Date()) {
    throw new AppError('Link kích hoạt đã hết hạn', 410, 'INVITE_TOKEN_EXPIRED');
  }

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: row.user_id } });
  if (!user) {
    throw new AppError('Tài khoản không tồn tại', 404, 'USER_NOT_FOUND');
  }

  user.password_hash = await bcrypt.hash(password, 10);
  user.is_active = true;
  await userRepo.save(user);

  await tokenRepo.update(row.id, { used_at: new Date() });

  const tokens = await authService.issueTokenPair(user);

  const [assignment] = await AppDataSource.query<{ cafe_id: string }[]>(
    `SELECT cafe_id FROM staff_cafe_assignments WHERE staff_id = $1`,
    [user.id],
  );

  logger.info('Staff', 'staff account activated', { staffId: user.id, email: user.email });

  return {
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      cafeId: assignment?.cafe_id ?? null,
    },
  };
}

export async function getTodayBookings(cafeId: string): Promise<any[]> {
  const rows = await AppDataSource.query<any[]>(
    `SELECT
       b.id,
       b.status,
       b.play_mode,
       b.slot_start,
       b.slot_end,
       b.slot_count,
       b.discount_amount,
       b.notes,
       c.name AS cafe_name,
       c.address AS cafe_address,
       c.phone AS cafe_phone,
       tt.name AS track_name
     FROM bookings b
     JOIN cafes c ON c.id = b.cafe_id
     LEFT JOIN track_types tt ON tt.id = b.track_type_id
     WHERE b.cafe_id = $1
       AND b.slot_start::date = (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
       AND b.status IN ('PENDING', 'CONFIRMED', 'NO_SHOW', 'COMPLETED', 'CANCELLED')
     ORDER BY b.slot_start ASC`,
    [cafeId],
  );

  const bookingsList = [];

  for (const row of rows) {
    // 1. Fetch planned participants
    const bpList = await AppDataSource.getRepository(BookingParticipant).find({
      where: { bookingId: row.id },
    });
    const plannedParticipants = [];
    const participantDetails: { name: string; phone?: string; isBooker: boolean }[] = [];
    for (const bp of bpList) {
      let name: string;
      let phone: string | undefined;
      if (bp.userId) {
        const user = await AppDataSource.getRepository(User).findOne({ where: { id: bp.userId } });
        name = user?.full_name || bp.guestName || 'Người chơi';
        phone = user?.phone || bp.guestPhone || undefined;
      } else {
        name = bp.guestName || 'Người chơi';
        phone = bp.guestPhone || undefined;
      }
      plannedParticipants.push(name);
      participantDetails.push({
        name,
        phone,
        isBooker: bp.participantType === BookingParticipantType.BOOKER,
      });
    }

    // 2. Fetch planned vehicles
    const bvList = await AppDataSource.getRepository(BookingVehicle).find({
      where: { bookingId: row.id },
    });
    const plannedVehicles = [];
    for (const bv of bvList) {
      const vehicle = await AppDataSource.getRepository(Vehicle).findOne({
        where: { id: bv.vehicleId },
        relations: ['catalog'],
      });
      plannedVehicles.push(vehicle?.catalog?.name || vehicle?.identifier || 'Xe thuê');
    }

    // 3. Fetch sessions
    const sessionsInDb = await AppDataSource.getRepository(Session).find({
      where: { bookingId: row.id },
    });
    const sessionsList = [];
    for (const s of sessionsInDb) {
      const sDetail = await getSessionDetail(s.id);
      sessionsList.push(sDetail);
    }

    // 4. Load real payment components and compute fees
    const comps = await AppDataSource.getRepository(PaymentComponent).find({
      where: { bookingId: row.id },
    });

    const depositComp = comps.find((c) => c.type === PaymentComponentType.SECURITY_DEPOSIT);
    const slotComp = comps.find((c) => c.type === PaymentComponentType.SLOT_FEE);
    const rentalComps = comps.filter((c) => c.type === PaymentComponentType.RENTAL_FEE);
    const preorderFnbComp = comps.find(
      (c) =>
        c.type === PaymentComponentType.FB_PREORDER &&
        (c.status === PaymentComponentStatus.HELD ||
          c.status === PaymentComponentStatus.REFUNDED ||
          c.status === PaymentComponentStatus.DISBURSED),
    );

    const depositAmount = depositComp ? Number(depositComp.amount) : 0;
    const slotFee = slotComp ? Number(slotComp.amount) : 120000;
    const rentalFee =
      rentalComps.length > 0
        ? rentalComps.reduce((sum, c) => sum + Number(c.amount), 0)
        : bvList.length * 100000;
    const fnbPreorderFee = preorderFnbComp ? Number(preorderFnbComp.amount) : 0;
    const totalAmount = slotFee + rentalFee + fnbPreorderFee;

    bookingsList.push({
      bookingId: row.id,
      shortCode: `RCF-${row.id.substring(0, 4).toUpperCase()}`,
      cafeId: cafeId,
      cafeName: row.cafe_name,
      cafeAddress: row.cafe_address,
      cafePhone: row.cafe_phone,
      trackName: row.track_name || 'Đường đua Super Drift A',
      trackType: row.play_mode === 'BYOC' ? 'DRIFT_ASPHALT' : 'DRIFT_CARPET',
      bookingMode: 'SINGLE',
      playMode: row.play_mode,
      status: row.status,
      slotStart: row.slot_start.toISOString(),
      slotEnd: row.slot_end.toISOString(),
      slotCount: Number(row.slot_count),
      depositAmount,
      slotFee,
      rentalFee,
      fnbPreorderFee,
      discountAmount: Number(row.discount_amount) || 0,
      totalAmount,
      paymentStatus: row.status === 'PENDING' ? 'UNPAID' : 'PAID',
      payment_components: comps,
      plannedParticipants,
      participantDetails,
      plannedVehicles,
      sessions: sessionsList,
    });
  }

  return bookingsList;
}

export interface FnbOrderItemDetail {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes: string | null;
}

export interface TodayFnbOrderItem {
  id: string;
  bookingId: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  slotStart: string;
  customerName: string;
  items: FnbOrderItemDetail[];
}

export async function getTodayFnbOrders(cafeId: string): Promise<TodayFnbOrderItem[]> {
  const rows = await AppDataSource.query<
    {
      id: string;
      booking_id: string;
      status: string;
      total_amount: string;
      created_at: Date;
      slot_start: Date;
      customer_name: string;
      items: FnbOrderItemDetail[] | null;
    }[]
  >(
    `SELECT
       fo.id,
       fo.booking_id,
       fo.status,
       fo.total_amount,
       fo.created_at,
       b.slot_start,
       u.full_name  AS customer_name,
       json_agg(
         json_build_object(
           'name',      COALESCE(mi.name, foi.item_name_snapshot, 'Món ăn'),
           'quantity',  foi.quantity,
           'unitPrice', foi.unit_price,
           'subtotal',  foi.subtotal,
           'notes',     foi.notes
         ) ORDER BY foi.created_at
       ) FILTER (WHERE foi.id IS NOT NULL) AS items
     FROM fnb_orders fo
     JOIN bookings b ON b.id = fo.booking_id
     JOIN users u    ON u.id = b.customer_id
     LEFT JOIN fnb_order_items foi ON foi.fnb_order_id = fo.id
     LEFT JOIN menu_items mi       ON mi.id = foi.menu_item_id
     WHERE b.cafe_id = $1
       AND b.slot_start::date = (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
       AND fo.order_type = 'PRE_ORDER'
       AND fo.status != 'CANCELLED'
     GROUP BY fo.id, b.slot_start, u.full_name
     ORDER BY b.slot_start ASC`,
    [cafeId],
  );

  return rows.map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    status: row.status,
    totalAmount: Number(row.total_amount),
    createdAt: row.created_at.toISOString(),
    slotStart: row.slot_start.toISOString(),
    customerName: row.customer_name,
    items: row.items ?? [],
  }));
}

export async function updateFnbOrderStatus(
  orderId: string,
  cafeId: string,
  newStatus: string,
): Promise<void> {
  const [order] = await AppDataSource.query<{ id: string; status: string }[]>(
    `SELECT fo.id, fo.status
     FROM fnb_orders fo
     JOIN bookings b ON b.id = fo.booking_id
     WHERE fo.id = $1 AND b.cafe_id = $2`,
    [orderId, cafeId],
  );

  if (!order) {
    throw new AppError('Đơn F&B không tồn tại', 404, 'FNB_ORDER_NOT_FOUND');
  }

  const allowed: Record<string, string[]> = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['DELIVERED'],
  };

  if (!allowed[order.status]?.includes(newStatus)) {
    throw new AppError(
      `Không thể chuyển trạng thái từ ${order.status} sang ${newStatus}`,
      409,
      'FNB_ORDER_INVALID_TRANSITION',
    );
  }

  await AppDataSource.query(`UPDATE fnb_orders SET status = $1 WHERE id = $2`, [
    newStatus,
    orderId,
  ]);

  logger.info('Staff', 'fnb order status updated', { orderId, cafeId, newStatus });
}

export async function transferStaff(
  providerId: string,
  staffId: string,
  newCafeId: string,
): Promise<void> {
  await getStaffOwnedByProvider(providerId, staffId);

  const [newCafe] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM cafes WHERE id = $1 AND provider_id = $2 AND deleted_at IS NULL`,
    [newCafeId, providerId],
  );

  if (!newCafe) {
    throw new AppError(
      'Chi nhánh không tồn tại hoặc không thuộc Provider này',
      404,
      'CAFE_NOT_FOUND',
    );
  }

  const [current] = await AppDataSource.query<{ cafe_id: string }[]>(
    `SELECT cafe_id FROM staff_cafe_assignments WHERE staff_id = $1`,
    [staffId],
  );

  if (current?.cafe_id === newCafeId) {
    throw new AppError('Nhân viên đã thuộc chi nhánh này', 409, 'STAFF_ALREADY_IN_CAFE');
  }

  await AppDataSource.query(`UPDATE staff_cafe_assignments SET cafe_id = $1 WHERE staff_id = $2`, [
    newCafeId,
    staffId,
  ]);

  logger.info('Staff', 'staff transferred', { providerId, staffId, newCafeId });
}

async function getStaffOwnedByProvider(providerId: string, staffId: string): Promise<User> {
  const [row] = await AppDataSource.query<{ id: string }[]>(
    `SELECT u.id
     FROM users u
     JOIN staff_cafe_assignments a ON a.staff_id = u.id
     JOIN cafes c ON c.id = a.cafe_id
     WHERE u.id = $1 AND c.provider_id = $2 AND u.deleted_at IS NULL`,
    [staffId, providerId],
  );

  if (!row) {
    throw new AppError(
      'Nhân viên không tồn tại hoặc không thuộc Provider này',
      404,
      'STAFF_NOT_FOUND',
    );
  }

  const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: staffId } });
  return user;
}

export async function getStaffForImpersonation(
  providerId: string,
  staffId: string,
): Promise<{ id: string; email: string; fullName: string; cafeName: string; cafeId: string }> {
  const [row] = await AppDataSource.query<
    {
      id: string;
      email: string;
      full_name: string;
      cafe_id: string;
      cafe_name: string;
      is_active: boolean;
    }[]
  >(
    `SELECT u.id, u.email, u.full_name, c.id AS cafe_id, c.name AS cafe_name, u.is_active
     FROM users u
     JOIN staff_cafe_assignments a ON a.staff_id = u.id
     JOIN cafes c ON c.id = a.cafe_id
     WHERE u.id = $1 AND c.provider_id = $2 AND u.deleted_at IS NULL`,
    [staffId, providerId],
  );

  if (!row) {
    throw new AppError(
      'Nhân viên không tồn tại hoặc không thuộc Provider này',
      404,
      'STAFF_NOT_FOUND',
    );
  }

  if (!row.is_active) {
    throw new AppError(
      'Chỉ có thể xem phiên của nhân viên đang hoạt động',
      400,
      'STAFF_NOT_ACTIVE',
    );
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    cafeName: row.cafe_name,
    cafeId: row.cafe_id,
  };
}

async function hasActiveInviteToken(staffId: string): Promise<boolean> {
  const [result] = await AppDataSource.query<{ exists: boolean }[]>(
    `SELECT EXISTS(
       SELECT 1 FROM staff_invite_tokens
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
     ) AS exists`,
    [staffId],
  );
  return result.exists;
}

export async function startCheckIn(bookingId: string, staffUserId: string): Promise<any> {
  const booking = await AppDataSource.getRepository(Booking).findOne({ where: { id: bookingId } });
  if (!booking) {
    throw new AppError('Đơn đặt lịch không tồn tại', 404, 'BOOKING_NOT_FOUND');
  }
  if (booking.status !== 'CONFIRMED') {
    throw new AppError(
      'Chỉ có thể Check-In đơn đặt lịch có trạng thái CONFIRMED',
      400,
      'INVALID_BOOKING_STATUS',
    );
  }

  const existing = await AppDataSource.getRepository(Session).findOne({ where: { bookingId } });
  if (existing) {
    return existing;
  }

  const session = new Session();
  session.bookingId = bookingId;
  session.cafeId = booking.cafeId;
  session.status = SessionStatus.CHECKED_IN;
  session.checkedInBy = staffUserId;
  session.actualStartAt = new Date();
  session.plannedEndAt = booking.slotEnd;
  session.actualTotalAmount = 0;
  await AppDataSource.getRepository(Session).save(session);

  const bookingParticipants = await AppDataSource.getRepository(BookingParticipant).find({
    where: { bookingId },
  });

  for (const bp of bookingParticipants) {
    const sp = new SessionParticipant();
    sp.sessionId = session.id;
    sp.bookingParticipantId = bp.id;
    sp.userId = bp.userId;
    if (bp.userId) {
      const user = await AppDataSource.getRepository(User).findOne({ where: { id: bp.userId } });
      sp.displayName = user?.full_name || bp.guestName || 'Khách chơi';
      sp.phone = user?.phone || bp.guestPhone;
    } else {
      sp.displayName = bp.guestName || 'Khách chơi';
      sp.phone = bp.guestPhone;
    }
    sp.role = ParticipantRole.DRIVER;
    sp.isPrimaryResponsible = bp.isPrimaryResponsible;
    sp.checkedInAt = new Date();
    await AppDataSource.getRepository(SessionParticipant).save(sp);
  }

  const bookingVehicles = await AppDataSource.getRepository(BookingVehicle).find({
    where: { bookingId },
  });

  if (bookingVehicles.length > 0) {
    for (const bv of bookingVehicles) {
      const sv = new SessionVehicle();
      sv.sessionId = session.id;
      sv.bookingVehicleId = bv.id;
      sv.vehicleSource = VehicleSource.RENTAL;
      sv.vehicleId = bv.vehicleId;
      sv.status = SessionVehicleStatus.ASSIGNED;
      await AppDataSource.getRepository(SessionVehicle).save(sv);
    }
  } else if (booking.playMode === 'BYOC') {
    // One BYOC vehicle slot per participant — link via assigned_to_participant_id for labeling
    const sessionParticipants = await AppDataSource.getRepository(SessionParticipant).find({
      where: { sessionId: session.id },
    });
    const slots = sessionParticipants.length > 0 ? sessionParticipants : [null];
    for (const sp of slots) {
      const sv = new SessionVehicle();
      sv.sessionId = session.id;
      sv.vehicleSource = VehicleSource.BYOC;
      sv.status = SessionVehicleStatus.ASSIGNED;
      if (sp) sv.assignedToParticipantId = sp.id;
      await AppDataSource.getRepository(SessionVehicle).save(sv);
    }
  }

  return session;
}

export async function getSessionDetail(sessionId: string): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const staffUser = await AppDataSource.getRepository(User).findOne({
    where: { id: session.checkedInBy },
  });

  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  if (!booking) {
    throw new AppError('Không tìm thấy đơn đặt lịch gốc của phiên này', 404, 'BOOKING_NOT_FOUND');
  }

  const participants = await AppDataSource.getRepository(SessionParticipant).find({
    where: { sessionId },
  });

  const sessionVehicles = await AppDataSource.getRepository(SessionVehicle).find({
    where: { sessionId },
  });
  const vehiclesList = [];
  for (const sv of sessionVehicles) {
    let name = 'Xe tự mang (BYOC)';
    let imageUrl = undefined;
    if (sv.vehicleSource === VehicleSource.RENTAL && sv.vehicleId) {
      const vehicle = await AppDataSource.getRepository(Vehicle).findOne({
        where: { id: sv.vehicleId },
        relations: ['catalog'],
      });
      if (vehicle) {
        name = vehicle.catalog?.name || vehicle.identifier || 'Xe thuê';
        imageUrl = vehicle.distinctiveImageUrl || undefined;
      }
    } else if (sv.vehicleSource === VehicleSource.BYOC && sv.assignedToParticipantId) {
      const sp = participants.find((p) => p.id === sv.assignedToParticipantId);
      if (sp?.displayName) name = `Xe của ${sp.displayName} (BYOC)`;
    }
    vehiclesList.push({
      vehicleId: sv.vehicleId || sv.id,
      name,
      type: sv.vehicleSource === VehicleSource.RENTAL ? 'RENT' : 'BYOC',
      imageUrl,
    });
  }

  const inspections = await AppDataSource.getRepository(Inspection).find({ where: { sessionId } });
  const mappedInspections = [];
  let damageClaim = undefined;

  for (const insp of inspections) {
    const photos = await AppDataSource.getRepository(InspectionPhoto).find({
      where: { inspectionId: insp.id },
    });
    const checklist = await AppDataSource.getRepository(InspectionChecklist).find({
      where: { inspectionId: insp.id },
    });

    mappedInspections.push({
      inspectionId: insp.id,
      type: insp.type,
      photos: photos.map((p) => ({
        url: p.url,
        angle: p.angle,
        direction: p.angle,
        notes: p.metadata?.notes ?? '',
      })),
      checklist: checklist.map((c) => ({
        itemKey: c.itemKey,
        itemLabel: c.itemLabel,
        status: c.status,
        note: c.note,
        id: c.itemKey,
        label: c.itemLabel,
        checked: c.status === InspectionItemStatus.OK,
        notes: c.note ?? '',
      })),
      staffNotes: insp.damageDescription || '',
      customerConfirmed: insp.customerConfirmed,
      customerConfirmedAt: insp.customerConfirmedAt?.toISOString(),
      damageFlagged: insp.damageNoted,
      damageDescription: insp.damageDescription,
      estimatedCost: insp.damageCostEstimate ? Number(insp.damageCostEstimate) : undefined,
    });

    if (insp.type === InspectionType.CHECK_OUT && insp.damageNoted) {
      const checkInPhoto = inspections.find((i) => i.type === InspectionType.CHECK_IN)?.id;
      const checkInPhotoUrl = checkInPhoto
        ? (
            await AppDataSource.getRepository(InspectionPhoto).findOne({
              where: { inspectionId: checkInPhoto },
            })
          )?.url || ''
        : '';
      const checkOutPhotoUrl = photos[0]?.url || '';

      const estimatedCost = Number(insp.damageCostEstimate) || 0;
      const damageMultiplier = 1.5;
      const finalCharge = estimatedCost * damageMultiplier;

      damageClaim = {
        claimId: insp.id,
        description: insp.damageDescription || 'Hư hỏng thiết bị',
        estimatedCost,
        damageMultiplier,
        finalCharge,
        checkInPhoto: checkInPhotoUrl,
        checkOutPhoto: checkOutPhotoUrl,
        status: session.status === SessionStatus.COMPLETED ? 'CONFIRMED' : 'PENDING',
        expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
      };
    }
  }

  // Include both on-site session orders AND the booking's pre-order
  const fnbOrders = await AppDataSource.getRepository(FnbOrder).find({
    where: [{ sessionId }, { bookingId: session.bookingId, orderType: FnbOrderType.PRE_ORDER }],
  });
  const mappedFnbOrders = [];
  for (const order of fnbOrders) {
    const items = await AppDataSource.getRepository(FnbOrderItem).find({
      where: { fnbOrderId: order.id },
    });
    const itemDetails = [];
    for (const item of items) {
      const menuItem = item.menuItemId
        ? await AppDataSource.getRepository(MenuItem).findOne({ where: { id: item.menuItemId } })
        : null;
      itemDetails.push({
        name: menuItem?.name || item.itemNameSnapshot || 'Món ăn',
        qty: item.quantity,
        price: Number(item.unitPrice),
      });
    }
    mappedFnbOrders.push({
      orderId: order.id,
      orderType: order.orderType,
      status: order.status,
      items: itemDetails,
      total: Number(order.totalAmount),
    });
  }

  const latestProposal = await AppDataSource.getRepository(ExtensionProposal).findOne({
    where: { sessionId },
    order: { createdAt: 'DESC' },
  });

  let extensionProposal = undefined;
  if (latestProposal) {
    extensionProposal = {
      proposalId: latestProposal.id,
      extraMinutes: latestProposal.durationMinutes,
      additionalFee: Number(latestProposal.feeAmount),
      newPlannedEnd: new Date(
        session.plannedEndAt.getTime() + latestProposal.durationMinutes * 60000,
      ).toISOString(),
      expiresAt: new Date(latestProposal.createdAt.getTime() + 10 * 60000).toISOString(),
      status: latestProposal.status,
    };
  }

  return {
    sessionId: session.id,
    bookingId: session.bookingId,
    status: session.status,
    staffName: staffUser?.full_name || 'Nhân viên trực ca',
    actualStart: session.actualStartAt ? session.actualStartAt.toISOString() : undefined,
    actualEnd: session.actualEndAt ? session.actualEndAt.toISOString() : undefined,
    plannedEnd: session.plannedEndAt.toISOString(),
    participants: participants.map((p) => ({
      name: p.displayName || 'Người chơi',
      type: 'PLAYER',
    })),
    vehicles: vehiclesList,
    inspections: mappedInspections,
    damageClaim,
    extensionProposal,
    fnbOrders: mappedFnbOrders,
  };
}

export async function getCustomerSessionDetail(
  sessionId: string,
  customerId: string,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  if (!booking || booking.customerId !== customerId) {
    throw new AppError('Bạn không có quyền xem phiên này', 403, 'FORBIDDEN');
  }

  return getSessionDetail(sessionId);
}

export async function submitInspection(
  sessionId: string,
  staffUserId: string,
  data: any,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const { type, photos, checklist, staffNotes, damageFlagged, damageDetails } = data;

  let sessionVehicleId = null;
  const svRepo = AppDataSource.getRepository(SessionVehicle);
  const activeSVs = await svRepo.find({ where: { sessionId } });
  if (activeSVs.length > 0) {
    sessionVehicleId = activeSVs[0].id;
  }

  const inspection = new Inspection();
  inspection.sessionId = sessionId;
  inspection.sessionVehicleId = sessionVehicleId;
  inspection.type = type === 'CHECK_IN' ? InspectionType.CHECK_IN : InspectionType.CHECK_OUT;
  inspection.subjectType = InspectionSubjectType.RENTAL_VEHICLE;
  inspection.performedBy = staffUserId;
  inspection.preExistingFlag = type === 'CHECK_IN' ? false : true;
  inspection.damageNoted = !!damageFlagged;
  inspection.damageDescription = staffNotes || (damageDetails ? damageDetails.description : null);
  inspection.damageCostEstimate = damageDetails ? damageDetails.estimatedCost : null;
  inspection.customerConfirmed = false;
  await AppDataSource.getRepository(Inspection).save(inspection);

  if (photos && Array.isArray(photos)) {
    for (const photo of photos) {
      const p = new InspectionPhoto();
      p.inspectionId = inspection.id;
      p.angle = photo.angle || PhotoAngle.FRONT;
      p.url = photo.url;
      p.uploadedBy = staffUserId;
      p.metadata = photo.metadata ?? (photo.notes ? { notes: photo.notes } : null);
      await AppDataSource.getRepository(InspectionPhoto).save(p);
    }
  }

  if (checklist && Array.isArray(checklist)) {
    for (const item of checklist) {
      const c = new InspectionChecklist();
      c.inspectionId = inspection.id;
      c.itemKey = item.itemKey;
      c.itemLabel = item.itemLabel;
      c.status = item.status || InspectionItemStatus.OK;
      c.note = item.note || '';
      await AppDataSource.getRepository(InspectionChecklist).save(c);
    }
  }

  if (inspection.type === InspectionType.CHECK_IN) {
    // Auto-confirm CHECK_IN — staff and customer are co-located, no async confirmation needed
    inspection.customerConfirmed = true;
    inspection.customerConfirmedAt = new Date();
    await AppDataSource.getRepository(Inspection).save(inspection);

    session.status = SessionStatus.ACTIVE;
    session.actualStartAt = new Date();
    await AppDataSource.getRepository(Session).save(session);

    for (const sv of activeSVs) {
      sv.status = SessionVehicleStatus.IN_USE;
      await svRepo.save(sv);
      if (sv.vehicleId) {
        await AppDataSource.getRepository(Vehicle).update(sv.vehicleId, {
          status: VehicleStatus.IN_USE,
        });
      }
    }

    if (session.checkedInBy) {
      await createNotification(
        session.checkedInBy,
        NotificationType.CUSTOMER_CHECKIN_CONFIRMED,
        'Xe đã được bàn giao',
        `Biên bản bàn giao xe phiên chơi ${session.id.substring(0, 8)} đã được xác nhận.`,
      );
      wsService.pushToUser(session.checkedInBy, 'CUSTOMER_CHECKIN_CONFIRMED', {
        sessionId,
        inspectionId: inspection.id,
        sessionStatus: session.status,
      });
    }
  } else {
    // CHECK_OUT — set CHECKING_OUT and notify customer to confirm billing
    session.status = SessionStatus.CHECKING_OUT;
    await AppDataSource.getRepository(Session).save(session);

    if (activeSVs.length > 0) {
      for (const sv of activeSVs) {
        sv.status = damageFlagged ? SessionVehicleStatus.DAMAGED : SessionVehicleStatus.RETURNED;
        await svRepo.save(sv);
      }
    }

    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: session.bookingId },
    });
    if (booking?.customerId) {
      await createNotification(
        booking.customerId,
        'SESSION_CHECKOUT_INSPECTION' as any,
        'Biên bản trả xe',
        'Nhân viên trực ca vừa gửi biên bản trả xe. Vui lòng bấm vào để kiểm tra và xác nhận.',
      );
      wsService.pushToUser(booking.customerId, 'SESSION_CHECKOUT_INSPECTION', {
        sessionId,
        inspectionId: inspection.id,
        type: inspection.type,
        route: `/customer/inspections/${sessionId}?inspectionId=${inspection.id}`,
        damageFlagged: !!damageFlagged,
      });
    }
  }

  return inspection;
}

export async function proposeExtension(
  sessionId: string,
  staffUserId: string,
  data: any,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const { extraMinutes, additionalFee, direct } = data;

  // Check whether the extended slot conflicts with an existing booking at the same cafe
  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  if (booking) {
    const proposedEnd = new Date(booking.slotEnd.getTime() + extraMinutes * 60 * 1000);
    const conflict = await AppDataSource.getRepository(Booking).findOne({
      where: {
        cafeId: booking.cafeId,
        id: Not(booking.id),
        status: Not(In([BookingStatus.CANCELLED, BookingStatus.NO_SHOW])),
        slotStart: LessThan(proposedEnd),
        slotEnd: MoreThan(booking.slotEnd),
      },
    });
    if (conflict) {
      throw new AppError(
        `Slot tiếp theo đã có đơn đặt lịch (${conflict.slotStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}). Không thể gia hạn thêm ${extraMinutes} phút.`,
        409,
        'SLOT_CONFLICT',
      );
    }
  }

  const proposal = new ExtensionProposal();
  proposal.sessionId = sessionId;
  proposal.proposedBy = staffUserId;
  proposal.durationMinutes = extraMinutes;
  proposal.feeAmount = additionalFee;

  if (direct) {
    // Staff directly approves — customer physically present and agreed at the counter
    proposal.status = ExtensionProposalStatus.APPROVED;
    proposal.respondedBy = staffUserId;
    proposal.respondedAt = new Date();
    await AppDataSource.getRepository(ExtensionProposal).save(proposal);

    session.plannedEndAt = new Date(session.plannedEndAt.getTime() + extraMinutes * 60000);
    session.actualTotalAmount = Number(session.actualTotalAmount) + Number(additionalFee);
    session.status = SessionStatus.ACTIVE;
    await AppDataSource.getRepository(Session).save(session);

    if (booking) {
      booking.slotCount = Number(booking.slotCount) + Math.ceil(extraMinutes / 30);
      await AppDataSource.getRepository(Booking).save(booking);

      if (booking.customerId) {
        await createNotification(
          booking.customerId,
          'SESSION_EXTENSION_PROPOSED' as any,
          'Ca chơi đã được gia hạn',
          `Ca chơi của bạn đã được gia hạn thêm ${extraMinutes} phút bởi nhân viên.`,
        );
      }
    }

    return proposal;
  }

  proposal.status = ExtensionProposalStatus.PENDING;
  await AppDataSource.getRepository(ExtensionProposal).save(proposal);
  const expiresAt = new Date((proposal.createdAt ?? new Date()).getTime() + 10 * 60000);

  session.status = SessionStatus.EXTENDING;
  await AppDataSource.getRepository(Session).save(session);

  // Notify customer via WebSocket and save in DB
  if (booking?.customerId) {
    await createNotification(
      booking.customerId,
      'SESSION_EXTENSION_PROPOSED' as any,
      'Yêu cầu xác nhận gia hạn',
      `Nhân viên trực ca đề xuất gia hạn thêm ${proposal.durationMinutes} phút. Vui lòng bấm vào để xem và phản hồi.`,
    );

    wsService.pushToUser(booking.customerId, 'SESSION_EXTENSION_PROPOSED', {
      sessionId,
      proposalId: proposal.id,
      extraMinutes: proposal.durationMinutes,
      additionalFee: Number(proposal.feeAmount),
      expiresAt: expiresAt.toISOString(),
      route: `/customer/extension-response/${sessionId}`,
    });
  }

  return proposal;
}

export async function addSessionFnbOrder(
  sessionId: string,
  staffUserId: string,
  data: any,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const { items } = data;
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('Không có sản phẩm nào được chọn', 400, 'EMPTY_FNB_ORDER');
  }

  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);

  const fnbOrder = new FnbOrder();
  fnbOrder.bookingId = session.bookingId;
  fnbOrder.sessionId = session.id;
  fnbOrder.orderType = FnbOrderType.ON_SITE;
  fnbOrder.status = FnbOrderStatus.PENDING;
  fnbOrder.totalAmount = total;
  fnbOrder.createdBy = staffUserId;
  fnbOrder.notes = 'Gọi món tại quầy [ACTIVE SESSION]';
  await AppDataSource.getRepository(FnbOrder).save(fnbOrder);

  const menuItemRepo = AppDataSource.getRepository(MenuItem);

  for (const item of items) {
    const menuItem = await menuItemRepo.findOne({
      where: { name: item.name, cafeId: session.cafeId },
    });
    if (!menuItem) {
      throw new AppError(`Món ăn ${item.name} không tồn tại`, 404, 'MENU_ITEM_NOT_FOUND');
    }

    const foi = new FnbOrderItem();
    foi.fnbOrderId = fnbOrder.id;
    foi.menuItemId = menuItem.id;
    foi.quantity = item.qty;
    foi.unitPrice = item.price;
    foi.subtotal = item.qty * item.price;
    await AppDataSource.getRepository(FnbOrderItem).save(foi);
  }

  session.actualTotalAmount = Number(session.actualTotalAmount) + total;
  await AppDataSource.getRepository(Session).save(session);

  // Notify customer of new Fnb order added
  try {
    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: session.bookingId },
    });
    if (booking && booking.customerId) {
      await createNotification(
        booking.customerId,
        NotificationType.SESSION_FNB_ORDER_ADDED,
        'Dịch vụ đồ ăn & uống được thêm',
        `Nhân viên vừa thêm món ăn/nước uống mới vào phiên chơi của bạn.`,
      );

      wsService.pushToUser(booking.customerId, 'SESSION_FNB_ORDER_ADDED', {
        sessionId: session.id,
        totalAmount: total,
      });
    }
  } catch (err) {
    logger.error('FnbOrderNotification', 'Failed to send notification to customer', err);
  }

  return fnbOrder;
}

export async function swapSessionVehicle(
  sessionId: string,
  oldVehicleId: string,
  newVehicleId: string,
  oldVehicleNewStatus: string,
  _staffUserId: string,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const svRepo = AppDataSource.getRepository(SessionVehicle);
  const activeSV = await svRepo.findOne({
    where: { sessionId, vehicleId: oldVehicleId, returnedAt: IsNull() },
  });

  if (!activeSV) {
    throw new AppError(
      'Không tìm thấy xe đang chạy này trong phiên',
      404,
      'VEHICLE_NOT_IN_SESSION',
    );
  }

  activeSV.returnedAt = new Date();
  activeSV.status =
    oldVehicleNewStatus === 'MAINTENANCE'
      ? SessionVehicleStatus.DAMAGED
      : SessionVehicleStatus.RETURNED;
  activeSV.notes = `Đổi sang xe mới mã ID ${newVehicleId}`;
  await svRepo.save(activeSV);

  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const oldVeh = await vehicleRepo.findOne({ where: { id: oldVehicleId } });
  if (oldVeh) {
    oldVeh.status =
      oldVehicleNewStatus === 'MAINTENANCE' ? VehicleStatus.MAINTENANCE : VehicleStatus.AVAILABLE;
    await vehicleRepo.save(oldVeh);
  }

  const newVeh = await vehicleRepo.findOne({ where: { id: newVehicleId } });
  if (!newVeh) {
    throw new AppError('Xe thay thế không tồn tại', 404, 'REPLACEMENT_VEHICLE_NOT_FOUND');
  }
  if (newVeh.status !== VehicleStatus.AVAILABLE) {
    throw new AppError(
      'Xe thay thế hiện không khả dụng (bận hoặc bảo trì)',
      400,
      'REPLACEMENT_VEHICLE_UNAVAILABLE',
    );
  }

  newVeh.status = VehicleStatus.IN_USE;
  await vehicleRepo.save(newVeh);

  const newSV = new SessionVehicle();
  newSV.sessionId = sessionId;
  newSV.bookingVehicleId = activeSV.bookingVehicleId;
  newSV.vehicleSource = VehicleSource.RENTAL;
  newSV.vehicleId = newVehicleId;
  newSV.assignedToParticipantId = activeSV.assignedToParticipantId;
  newSV.status = SessionVehicleStatus.IN_USE;
  newSV.startedAt = new Date();
  await svRepo.save(newSV);

  return newSV;
}

export async function simulateClientCheckInResponse(sessionId: string): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const inspectionRepo = AppDataSource.getRepository(Inspection);
  const checkInInspection = await inspectionRepo.findOne({
    where: { sessionId, type: InspectionType.CHECK_IN },
  });

  if (checkInInspection) {
    checkInInspection.customerConfirmed = true;
    checkInInspection.customerConfirmedAt = new Date();
    await inspectionRepo.save(checkInInspection);
  }

  session.status = SessionStatus.ACTIVE;
  session.actualStartAt = new Date();
  await AppDataSource.getRepository(Session).save(session);

  const svRepo = AppDataSource.getRepository(SessionVehicle);
  const sessionVehicles = await svRepo.find({ where: { sessionId } });
  const vehicleRepo = AppDataSource.getRepository(Vehicle);

  for (const sv of sessionVehicles) {
    sv.status = SessionVehicleStatus.IN_USE;
    sv.startedAt = new Date();
    await svRepo.save(sv);

    if (sv.vehicleSource === VehicleSource.RENTAL && sv.vehicleId) {
      const veh = await vehicleRepo.findOne({ where: { id: sv.vehicleId } });
      if (veh) {
        veh.status = VehicleStatus.IN_USE;
        await vehicleRepo.save(veh);
      }
    }
  }

  return session;
}

export async function simulateClientCheckOutResponse(sessionId: string): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const inspectionRepo = AppDataSource.getRepository(Inspection);
  const checkOutInspection = await inspectionRepo.findOne({
    where: { sessionId, type: InspectionType.CHECK_OUT },
  });

  if (checkOutInspection) {
    checkOutInspection.customerConfirmed = true;
    checkOutInspection.customerConfirmedAt = new Date();
    await inspectionRepo.save(checkOutInspection);
  }

  session.status = SessionStatus.COMPLETED;
  session.actualEndAt = new Date();
  await AppDataSource.getRepository(Session).save(session);

  const svRepo = AppDataSource.getRepository(SessionVehicle);
  const sessionVehicles = await svRepo.find({ where: { sessionId } });
  const vehicleRepo = AppDataSource.getRepository(Vehicle);

  const damageFlagged = checkOutInspection?.damageNoted || false;

  for (const sv of sessionVehicles) {
    sv.status = damageFlagged ? SessionVehicleStatus.DAMAGED : SessionVehicleStatus.RETURNED;
    sv.returnedAt = new Date();
    await svRepo.save(sv);

    if (sv.vehicleSource === VehicleSource.RENTAL && sv.vehicleId) {
      const veh = await vehicleRepo.findOne({ where: { id: sv.vehicleId } });
      if (veh) {
        veh.status = damageFlagged ? VehicleStatus.MAINTENANCE : VehicleStatus.AVAILABLE;
        await vehicleRepo.save(veh);
      }
    }
  }

  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  if (booking) {
    booking.status = BookingStatus.COMPLETED;
    booking.completedAt = new Date();
    await AppDataSource.getRepository(Booking).save(booking);
    if (booking.source !== BookingSource.STAFF_MANUAL) {
      await createNotification(
        booking.customerId,
        NotificationType.BOOKING_REVIEW_REQUEST,
        'Đánh giá trải nghiệm của bạn',
        'Cảm ơn bạn đã sử dụng dịch vụ! Hãy dành 1 phút đánh giá trải nghiệm của bạn.',
      );
      wsService.pushToUser(booking.customerId, 'BOOKING_REVIEW_REQUEST', {
        bookingId: booking.id,
      });
    }
  }

  // Settle invoice at checkout — called unconditionally so BYOC sessions
  // (no checkOutInspection) still get extension fees and on-site F&B billed
  await settleSessionCheckoutBilling(sessionId, checkOutInspection ?? null);

  return session;
}

export async function simulateClientExtensionResponse(
  sessionId: string,
  approved: boolean,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) {
    throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');
  }

  const propRepo = AppDataSource.getRepository(ExtensionProposal);
  const latestProposal = await propRepo.findOne({
    where: { sessionId, status: ExtensionProposalStatus.PENDING },
    order: { createdAt: 'DESC' },
  });

  if (!latestProposal) {
    throw new AppError(
      'Không tìm thấy yêu cầu gia hạn nào đang chờ duyệt',
      404,
      'NO_PENDING_EXTENSION_PROPOSAL',
    );
  }

  latestProposal.status = approved
    ? ExtensionProposalStatus.APPROVED
    : ExtensionProposalStatus.REJECTED;
  latestProposal.respondedAt = new Date();
  await propRepo.save(latestProposal);

  session.status = SessionStatus.ACTIVE;

  if (approved) {
    session.plannedEndAt = new Date(
      session.plannedEndAt.getTime() + latestProposal.durationMinutes * 60000,
    );

    session.actualTotalAmount =
      Number(session.actualTotalAmount) + Number(latestProposal.feeAmount);

    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: session.bookingId },
    });
    if (booking) {
      booking.slotCount =
        Number(booking.slotCount) + Math.ceil(latestProposal.durationMinutes / 30);
      await AppDataSource.getRepository(Booking).save(booking);
    }
  }

  await AppDataSource.getRepository(Session).save(session);

  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER-SIDE ACTIONS (real client flow, not simulated)
// ─────────────────────────────────────────────────────────────────────────────

export async function customerConfirmInspection(
  sessionId: string,
  inspectionId: string,
  customerId: string,
  agreed: boolean,
  disagreementNote?: string,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');

  // Verify customer owns this session's booking
  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  if (!booking || booking.customerId !== customerId) {
    throw new AppError('Bạn không có quyền xác nhận phiên này', 403, 'FORBIDDEN');
  }

  const inspRepo = AppDataSource.getRepository(Inspection);
  const inspection = await inspRepo.findOne({ where: { id: inspectionId, sessionId } });
  if (!inspection)
    throw new AppError('Biên bản kiểm xe không tồn tại', 404, 'INSPECTION_NOT_FOUND');

  // CHECK_IN is auto-confirmed by staff submission — customer action not needed
  if (inspection.type === InspectionType.CHECK_IN) {
    throw new AppError(
      'Biên bản bàn giao xe đã được xác nhận tự động khi nhân viên gửi',
      400,
      'ALREADY_CONFIRMED',
    );
  }

  inspection.customerConfirmed = agreed;
  inspection.customerConfirmedAt = new Date();
  if (!agreed && disagreementNote) {
    inspection.damageDescription =
      (inspection.damageDescription || '') + ` [KH phản hồi: ${disagreementNote}]`;
  }
  await inspRepo.save(inspection);

  if (agreed) {
    session.status = SessionStatus.COMPLETED;
    session.actualEndAt = new Date();
    await AppDataSource.getRepository(Session).save(session);

    const svRepo = AppDataSource.getRepository(SessionVehicle);
    const svs = await svRepo.find({ where: { sessionId } });
    for (const sv of svs) {
      const newVehicleStatus = inspection.damageNoted
        ? VehicleStatus.MAINTENANCE
        : VehicleStatus.AVAILABLE;
      if (sv.vehicleId) {
        await AppDataSource.getRepository(Vehicle).update(sv.vehicleId, {
          status: newVehicleStatus,
        });
      }
    }

    await settleSessionCheckoutBilling(sessionId, inspection);

    const allSessions = await AppDataSource.getRepository(Session).find({
      where: { bookingId: session.bookingId },
    });
    const allDone = allSessions.every((s) => s.status === SessionStatus.COMPLETED);
    if (allDone) {
      const pendingCount = await AppDataSource.getRepository(PaymentComponent).count({
        where: { bookingId: session.bookingId, status: PaymentComponentStatus.PENDING },
      });
      if (pendingCount > 0) {
        await AppDataSource.getRepository(Booking).update(session.bookingId, {
          status: BookingStatus.AWAITING_PAYMENT,
        });
      } else {
        const completedAt = new Date();
        await AppDataSource.getRepository(Booking).update(session.bookingId, {
          status: BookingStatus.COMPLETED,
          completedAt,
        });
        if (booking.source !== BookingSource.STAFF_MANUAL) {
          await createNotification(
            booking.customerId,
            NotificationType.BOOKING_REVIEW_REQUEST,
            'Đánh giá trải nghiệm của bạn',
            'Cảm ơn bạn đã sử dụng dịch vụ! Hãy dành 1 phút đánh giá trải nghiệm của bạn.',
          );
          wsService.pushToUser(booking.customerId, 'BOOKING_REVIEW_REQUEST', {
            bookingId: booking.id,
          });
        }
      }
    }

    if (session.checkedInBy) {
      await createNotification(
        session.checkedInBy,
        NotificationType.CUSTOMER_CHECKOUT_CONFIRMED,
        'Khách hàng đã trả xe',
        `Khách hàng vừa xác nhận biên bản trả xe của phiên chơi ${session.id.substring(0, 8)}.`,
      );

      wsService.pushToUser(session.checkedInBy, 'CUSTOMER_CHECKOUT_CONFIRMED', {
        sessionId,
        inspectionId,
        sessionStatus: session.status,
      });
    }
  } else {
    // Customer disputed CHECK_OUT — reset to ACTIVE so staff can re-inspect
    session.status = SessionStatus.ACTIVE;
    await AppDataSource.getRepository(Session).save(session);

    if (session.checkedInBy) {
      await createNotification(
        session.checkedInBy,
        NotificationType.CUSTOMER_INSPECTION_DISPUTED,
        'Biên bản bị phản hồi sai lệch',
        `Khách hàng phản hồi biên bản kiểm xe phiên chơi ${session.id.substring(0, 8)}: "${disagreementNote}".`,
      );

      wsService.pushToUser(session.checkedInBy, 'CUSTOMER_INSPECTION_DISPUTED', {
        sessionId,
        inspectionId,
        type: inspection.type,
        note: disagreementNote,
      });
    }
  }

  return { success: true, agreed, sessionStatus: session.status };
}

export async function customerRespondExtension(
  sessionId: string,
  customerId: string,
  approved: boolean,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');

  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  if (!booking || booking.customerId !== customerId) {
    throw new AppError('Bạn không có quyền phản hồi phiên này', 403, 'FORBIDDEN');
  }

  const propRepo = AppDataSource.getRepository(ExtensionProposal);
  const latestProposal = await propRepo.findOne({
    where: { sessionId, status: ExtensionProposalStatus.PENDING },
    order: { createdAt: 'DESC' },
  });
  if (!latestProposal)
    throw new AppError('Không có đề xuất gia hạn đang chờ', 404, 'NO_PENDING_EXTENSION');

  const expiresAt = new Date(latestProposal.createdAt.getTime() + 10 * 60000);
  if (expiresAt.getTime() <= Date.now()) {
    latestProposal.status = ExtensionProposalStatus.EXPIRED;
    latestProposal.respondedBy = customerId;
    latestProposal.respondedAt = new Date();
    await propRepo.save(latestProposal);

    session.status = SessionStatus.ACTIVE;
    await AppDataSource.getRepository(Session).save(session);

    throw new AppError('Đề xuất gia hạn đã hết hạn', 400, 'EXTENSION_EXPIRED');
  }

  latestProposal.status = approved
    ? ExtensionProposalStatus.APPROVED
    : ExtensionProposalStatus.REJECTED;
  latestProposal.respondedBy = customerId;
  latestProposal.respondedAt = new Date();
  await propRepo.save(latestProposal);

  session.status = SessionStatus.ACTIVE;
  if (approved) {
    session.plannedEndAt = new Date(
      session.plannedEndAt.getTime() + latestProposal.durationMinutes * 60000,
    );
    session.actualTotalAmount =
      Number(session.actualTotalAmount) + Number(latestProposal.feeAmount);
    booking.slotCount = Number(booking.slotCount) + Math.ceil(latestProposal.durationMinutes / 30);
    await AppDataSource.getRepository(Booking).save(booking);
  }
  await AppDataSource.getRepository(Session).save(session);

  // Notify staff
  if (session.checkedInBy) {
    await createNotification(
      session.checkedInBy,
      approved
        ? NotificationType.CUSTOMER_EXTENSION_APPROVED
        : NotificationType.CUSTOMER_EXTENSION_REJECTED,
      approved ? 'Khách đồng ý gia hạn' : 'Khách từ chối gia hạn',
      approved
        ? `Khách hàng đã đồng ý đề xuất gia hạn thêm ${latestProposal.durationMinutes} phút cho phiên chơi ${session.id.substring(0, 8)}.`
        : `Khách hàng đã từ chối đề xuất gia hạn thêm ${latestProposal.durationMinutes} phút cho phiên chơi ${session.id.substring(0, 8)}.`,
    );

    wsService.pushToUser(
      session.checkedInBy,
      approved ? 'CUSTOMER_EXTENSION_APPROVED' : 'CUSTOMER_EXTENSION_REJECTED',
      {
        sessionId,
        proposalId: latestProposal.id,
        extraMinutes: latestProposal.durationMinutes,
        sessionStatus: session.status,
      },
    );
  }

  return {
    success: true,
    approved,
    newPlannedEnd: session.plannedEndAt,
    sessionStatus: session.status,
  };
}

export async function settleSessionCheckoutBilling(
  sessionId: string,
  inspection: Inspection | null,
): Promise<void> {
  const sessionRepo = AppDataSource.getRepository(Session);
  const session = await sessionRepo.findOne({ where: { id: sessionId } });
  if (!session) return;

  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: session.bookingId } });
  if (!booking) return;

  const compRepo = AppDataSource.getRepository(PaymentComponent);

  // 1. Fetch existing payment components (prepaid)
  const existingComponents = await compRepo.find({ where: { bookingId: booking.id } });

  // 2. Fetch approved extensions → Service consumption fee
  const extensions = await AppDataSource.getRepository(ExtensionProposal).find({
    where: { sessionId: session.id, status: ExtensionProposalStatus.APPROVED },
  });
  const totalExtensionFee = extensions.reduce((sum, ext) => sum + Number(ext.feeAmount), 0);

  // 3. Fetch on-site F&B orders → Service consumption fee
  const onsiteFnbs = await AppDataSource.getRepository(FnbOrder).find({
    where: { sessionId: session.id, orderType: FnbOrderType.ON_SITE },
  });
  const totalOnsiteFnb = onsiteFnbs.reduce((sum, fnb) => sum + Number(fnb.totalAmount), 0);

  // 4. Calculate damage charge from checkout inspection → Asset protection fee
  let damageCharge = 0;
  if (inspection && inspection.type === InspectionType.CHECK_OUT && inspection.damageNoted) {
    const estimatedCost = Number(inspection.damageCostEstimate) || 0;
    const damageMultiplier = Number(inspection.aiAnalysisJson?.damageMultiplier) || 1.5;
    damageCharge = estimatedCost * damageMultiplier;
  }

  // ── DEPOSIT RECONCILIATION (Asset Protection Only) ────────────────────────
  // The security deposit ONLY offsets vehicle damage charges.
  // F&B and extension fees are separate service consumption bills → counter payment.
  const depositComp = existingComponents.find(
    (c) => c.type === PaymentComponentType.SECURITY_DEPOSIT,
  );
  const depositAmount = depositComp ? Number(depositComp.amount) : 0;

  // How much of the deposit is consumed to cover vehicle damage?
  const depositConsumedByDamage = Math.min(depositAmount, damageCharge);
  // How much deposit remains to be returned to the customer?
  const depositRefundAmount = depositAmount - depositConsumedByDamage;
  // How much vehicle damage exceeds the deposit (customer pays extra at counter)?
  const damageExceedingDeposit = Math.max(0, damageCharge - depositAmount);

  // Update deposit component: mark as PENDING_REFUND (awaiting Staff counter confirmation)
  if (depositComp) {
    if (depositConsumedByDamage === depositAmount) {
      // Deposit fully consumed by damage — no refund
      depositComp.status = PaymentComponentStatus.DISBURSED;
      depositComp.refundedAmount = 0;
    } else {
      // Partial or full refund due — Staff must hand back cash/confirm
      depositComp.status = PaymentComponentStatus.PENDING_REFUND;
      depositComp.refundedAmount = depositRefundAmount;
    }
    await compRepo.save(depositComp);
  }

  // ── SERVICE CONSUMPTION BILL (Counter Payment) ────────────────────────────
  // Total the customer owes at the counter:
  //   F&B onsite + Extension fees + damage amount that exceeds the deposit
  const totalCounterBill = totalExtensionFee + totalOnsiteFnb + damageExceedingDeposit;

  // Create individual PENDING components for each service fee
  const newComponents: Partial<PaymentComponent>[] = [];

  if (totalExtensionFee > 0) {
    const exists = existingComponents.some((c) => c.type === PaymentComponentType.EXTENSION_FEE);
    if (!exists) {
      newComponents.push({
        bookingId: booking.id,
        type: PaymentComponentType.EXTENSION_FEE,
        amount: totalExtensionFee,
        status: PaymentComponentStatus.PENDING,
      });
    }
  }

  if (totalOnsiteFnb > 0) {
    const exists = existingComponents.some(
      (c) =>
        c.type === PaymentComponentType.FB_PREORDER && c.status === PaymentComponentStatus.PENDING,
    );
    if (!exists) {
      newComponents.push({
        bookingId: booking.id,
        type: PaymentComponentType.FB_PREORDER,
        amount: totalOnsiteFnb,
        status: PaymentComponentStatus.PENDING,
      });
    }
  }

  // Damage amount that exceeds deposit is billed separately at counter
  if (damageExceedingDeposit > 0) {
    const exists = existingComponents.some((c) => c.type === PaymentComponentType.DAMAGE_CHARGE);
    if (!exists) {
      newComponents.push({
        bookingId: booking.id,
        type: PaymentComponentType.DAMAGE_CHARGE,
        amount: damageExceedingDeposit,
        status: PaymentComponentStatus.PENDING,
      });
    }
  } else if (damageCharge > 0 && damageExceedingDeposit === 0) {
    // Damage fully covered by deposit — still record the component for audit
    const exists = existingComponents.some((c) => c.type === PaymentComponentType.DAMAGE_CHARGE);
    if (!exists) {
      newComponents.push({
        bookingId: booking.id,
        type: PaymentComponentType.DAMAGE_CHARGE,
        amount: damageCharge,
        status: PaymentComponentStatus.DISBURSED, // Covered by deposit, nothing more to pay
      });
    }
  }

  if (newComponents.length > 0) {
    await AppDataSource.transaction(async (em) => {
      for (const comp of newComponents) {
        await em.save(compRepo.create(comp));
      }
    });
  }

  // Store settlement summary on session for quick UI retrieval
  session.notes = JSON.stringify({
    ...(session.notes ? JSON.parse(session.notes) : {}),
    settlement: {
      depositAmount,
      depositConsumedByDamage,
      depositRefundAmount,
      damageCharge,
      totalExtensionFee,
      totalOnsiteFnb,
      damageExceedingDeposit,
      totalCounterBill,
      netCounterAmount: totalCounterBill - depositRefundAmount,
    },
  });
  await sessionRepo.save(session);
}

export async function settlePendingPayments(bookingId: string): Promise<any> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

  const compRepo = AppDataSource.getRepository(PaymentComponent);
  const txRepo = AppDataSource.getRepository(PaymentTransaction);

  // ── FLOW 1: DEPOSIT REFUND ────────────────────────────────────────────────
  // Finalize the deposit component: Staff confirms they physically returned the
  // refund amount to the customer. Move from PENDING_REFUND → REFUNDED / PARTIALLY_REFUNDED.
  const depositComp = await compRepo.findOne({
    where: { bookingId, type: PaymentComponentType.SECURITY_DEPOSIT },
  });

  let depositRefundAmount = 0;
  if (depositComp && depositComp.status === PaymentComponentStatus.PENDING_REFUND) {
    depositRefundAmount = Number(depositComp.refundedAmount) || 0;
    const depositTotal = Number(depositComp.amount);
    const consumed = depositTotal - depositRefundAmount;

    if (consumed === 0) {
      // No damage at all — full deposit returned
      depositComp.status = PaymentComponentStatus.REFUNDED;
    } else {
      // Partial deduction for vehicle damage
      depositComp.status = PaymentComponentStatus.PARTIALLY_REFUNDED;
    }
    depositComp.refundedAt = new Date();
    await compRepo.save(depositComp);

    // Record REFUND transaction for audit (amount = what was physically returned)
    if (depositRefundAmount > 0) {
      const refundRef = `dref_${bookingId.replace(/-/g, '').substring(0, 22)}_${Date.now().toString().slice(-4)}`;
      await txRepo.save(
        txRepo.create({
          bookingId,
          type: PaymentTransactionType.REFUND,
          gateway: 'DIRECT',
          txnRef: refundRef,
          amount: depositRefundAmount,
          status: PaymentTransactionStatus.SUCCESS,
          rawRequest: { depositRefund: true },
          rawResponse: {
            settledAt: new Date().toISOString(),
            depositTotal: depositComp.amount,
            consumed,
            refunded: depositRefundAmount,
          },
        }),
      );
    }
  }

  // ── FLOW 2: SERVICE SETTLEMENT (Counter Payment) ──────────────────────────
  // Collect all PENDING service components (F&B, Extension, Damage-exceeding-deposit)
  const pendingComponents = await compRepo.find({
    where: { bookingId, status: PaymentComponentStatus.PENDING },
  });

  const totalCounterBill = pendingComponents.reduce((sum, c) => sum + Number(c.amount), 0);

  // Net amount the customer actually hands over at the counter:
  //   They owe totalCounterBill but get back depositRefundAmount in cash.
  //   Staff collects: totalCounterBill - depositRefundAmount (or adds change if negative)
  const netCounterAmount = totalCounterBill - depositRefundAmount;

  await AppDataSource.transaction(async (em) => {
    // Mark all service components as DISBURSED (paid at counter)
    for (const comp of pendingComponents) {
      comp.status = PaymentComponentStatus.DISBURSED;
      await em.save(comp);
    }

    // Record PAYMENT/DIRECT transaction only if there's an actual service bill
    if (totalCounterBill > 0) {
      const ctrRef = `ctr_${bookingId.replace(/-/g, '').substring(0, 22)}_${Date.now().toString().slice(-4)}`;
      await em.save(
        txRepo.create({
          bookingId,
          type: PaymentTransactionType.PAYMENT,
          gateway: 'DIRECT',
          txnRef: ctrRef,
          amount: totalCounterBill,
          status: PaymentTransactionStatus.SUCCESS,
          rawRequest: { counterSettlement: true },
          rawResponse: {
            settledAt: new Date().toISOString(),
            totalCounterBill,
            depositRefundAmount,
            netCounterAmount,
          },
        }),
      );
    }
  });

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  try {
    if (booking.customerId) {
      await createNotification(
        booking.customerId,
        NotificationType.CUSTOMER_PAYMENT_CONFIRMED,
        'Thanh toán thành công',
        `Đơn đặt ${booking.id.substring(0, 8).toUpperCase()} đã được quyết toán hoàn tất tại quầy.`,
      );
      wsService.pushToUser(booking.customerId, 'CUSTOMER_PAYMENT_CONFIRMED', {
        bookingId,
        totalCounterBill,
        depositRefundAmount,
        netCounterAmount,
      });
    }
  } catch (err) {
    logger.error('SettlePendingNotification', 'Failed to notify customer', err);
  }

  if (booking.status === BookingStatus.AWAITING_PAYMENT) {
    await transition(bookingId, 'PAYMENT_SETTLED');
    if (booking.source !== BookingSource.STAFF_MANUAL && booking.customerId) {
      await createNotification(
        booking.customerId,
        NotificationType.BOOKING_REVIEW_REQUEST,
        'Đánh giá trải nghiệm của bạn',
        'Cảm ơn bạn đã sử dụng dịch vụ! Hãy dành 1 phút đánh giá trải nghiệm của bạn.',
      ).catch(() => {});
      wsService.pushToUser(booking.customerId, 'BOOKING_REVIEW_REQUEST', { bookingId });
    }
  }

  return {
    success: true,
    depositRefundAmount,
    totalCounterBill,
    netCounterAmount,
    settledComponents: pendingComponents.length,
  };
}

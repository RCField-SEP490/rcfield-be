/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { IsNull, SelectQueryBuilder } from 'typeorm';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import {
  AppError,
  AuthProvider,
  BookingMode,
  BookingSource,
  BookingStatus,
  UserRole,
  SessionStatus,
  ParticipantRole,
  VehicleSource,
  SessionVehicleStatus,
  InspectionType,
  InspectionSubjectType,
  DamagePartType,
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
  CafeOperatingHours,
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
import { Cafe } from '../models/cafe.entity';
import { CafeTrackConfig } from '../models/cafe-track-config.entity';
import { TrackType } from '../models/track-type.entity';
import { Vehicle } from '../models/vehicle.entity';
import { Inspection } from '../models/inspection.entity';
import { DamageLineItem } from '../models/damage-line-item.entity';
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
import { createWalkInBooking as createWalkInBookingService } from './booking.service';

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
  lastActiveAt: string | null;
}

export interface TodayBookingItem {
  bookingId: string;
  shortCode: string;
  cafeId: string;
  cafeName: string;
  cafeAddress: string;
  cafePhone: string;
  trackName: string;
  trackType: string;
  bookingMode: 'SINGLE' | 'PACKAGE' | 'SUBSCRIPTION';
  playMode: BookingMode;
  source: BookingSource;
  status: BookingStatus;
  slotStart: string;
  slotEnd: string;
  slotCount: number;
  depositAmount: number;
  slotFee: number;
  rentalFee: number;
  fnbPreorderFee: number;
  fnbOnsiteFee: number;
  discountAmount: number;
  totalAmount: number;
  paymentStatus: 'UNPAID' | 'PAID';
  payment_components: PaymentComponent[];
  plannedParticipants: string[];
  participantDetails: { name: string; phone?: string; isBooker: boolean }[];
  plannedVehicles: string[];
  sessions: any[];
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
      last_active_at: Date | null;
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
       u.last_active_at,
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
      lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
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

function getVietnamCalendarDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export async function getTodayBookings(cafeId: string): Promise<TodayBookingItem[]> {
  return getBookingsByDate(cafeId, getVietnamCalendarDate());
}

export async function getBookingsByDate(
  cafeId: string,
  bookingDate: string,
): Promise<TodayBookingItem[]> {
  const rows = await AppDataSource.query<any[]>(
    `SELECT
       b.id,
       b.status,
       b.play_mode,
       b.source,
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
       AND (b.slot_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $2::date
       AND b.status IN ('PENDING', 'CONFIRMED', 'NO_SHOW', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED')
     ORDER BY b.slot_start ASC`,
    [cafeId, bookingDate],
  );

  const bookingsList: TodayBookingItem[] = [];

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

    const depositAmount = depositComp ? Number(depositComp.amount) : 0;
    const slotFee = slotComp ? Number(slotComp.amount) : 120000;
    const rentalFee =
      rentalComps.length > 0
        ? rentalComps.reduce((sum, c) => sum + Number(c.amount), 0)
        : bvList.length * 100000;
    const fnbOrders = await AppDataSource.getRepository(FnbOrder).find({
      where: { bookingId: row.id },
    });
    const fnbPreorderFee = fnbOrders
      .filter(
        (o) => o.orderType === FnbOrderType.PRE_ORDER && o.status !== FnbOrderStatus.CANCELLED,
      )
      .reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const fnbOnsiteFee = fnbOrders
      .filter((o) => o.orderType === FnbOrderType.ON_SITE && o.status !== FnbOrderStatus.CANCELLED)
      .reduce((sum, o) => sum + Number(o.totalAmount), 0);
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
      source: row.source,
      status: row.status,
      slotStart: row.slot_start.toISOString(),
      slotEnd: row.slot_end.toISOString(),
      slotCount: Number(row.slot_count),
      depositAmount,
      slotFee,
      rentalFee,
      fnbPreorderFee,
      fnbOnsiteFee,
      discountAmount: Number(row.discount_amount) || 0,
      totalAmount,
      paymentStatus:
        row.status === 'PENDING' ||
        comps.some(
          (c) =>
            c.status === PaymentComponentStatus.PENDING ||
            c.status === PaymentComponentStatus.PENDING_REFUND,
        )
          ? 'UNPAID'
          : 'PAID',
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

export interface StaffDetailProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  cafeName: string;
  cafeId: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  createdAt: string;
  activatedAt: string | null;
  lastActiveAt: string | null;
}

export interface StaffKpiSummary {
  staffId: string;
  period: '7d' | '30d' | '90d';
  totalCheckIns: number;
  totalFnbOrdersHandled: number;
  totalExtensionsApproved: number;
  onTimeCheckInRate: number | null;
  activeDaysCount: number;
}

export interface StaffActivityEvent {
  id: string;
  type: 'CHECK_IN' | 'CHECK_OUT' | 'FNB_ORDER' | 'EXTENSION_APPROVED';
  eventTime: string;
  label: string;
  bookingId: string;
  bookingSource: 'APP' | 'STAFF_MANUAL';
}

export interface StaffActivityPage {
  events: StaffActivityEvent[];
  total: number;
  hasMore: boolean;
}

export async function getStaffDetail(
  providerId: string,
  staffId: string,
): Promise<StaffDetailProfile> {
  const [row] = await AppDataSource.query<
    {
      id: string;
      full_name: string;
      email: string;
      phone: string | null;
      cafe_id: string;
      cafe_name: string;
      is_active: boolean;
      created_at: Date;
      activated_at: Date | null;
      invite_expires_at: Date | null;
      has_active_token: boolean;
      last_active_at: Date | null;
    }[]
  >(
    `SELECT
       u.id, u.full_name, u.email, u.phone, u.is_active, u.created_at, u.last_active_at,
       u.updated_at AS activated_at,
       c.id AS cafe_id, c.name AS cafe_name,
       EXISTS(
         SELECT 1 FROM staff_invite_tokens t
         WHERE t.user_id = u.id AND t.used_at IS NULL AND t.expires_at > NOW()
       ) AS has_active_token,
       (
         SELECT t.expires_at FROM staff_invite_tokens t
         WHERE t.user_id = u.id AND t.used_at IS NULL
         ORDER BY t.created_at DESC LIMIT 1
       ) AS invite_expires_at
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
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    cafeName: row.cafe_name,
    cafeId: row.cafe_id,
    status,
    createdAt: row.created_at.toISOString(),
    activatedAt: status === 'ACTIVE' && row.activated_at ? row.activated_at.toISOString() : null,
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
  };
}

export async function getStaffKpi(
  providerId: string,
  staffId: string,
  period: '7d' | '30d' | '90d',
): Promise<StaffKpiSummary> {
  await getStaffOwnedByProvider(providerId, staffId);

  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;

  const [checkInsRow, fnbRow, extensionsRow, onTimeRow, activeDaysRow] = await Promise.all([
    AppDataSource.query<[{ count: string }]>(
      `SELECT COUNT(*)::int AS count FROM sessions
       WHERE checked_in_by = $1 AND created_at >= NOW() - INTERVAL '${days} days'`,
      [staffId],
    ),
    AppDataSource.query<[{ count: string }]>(
      `SELECT COUNT(*)::int AS count FROM fnb_orders
       WHERE created_by = $1 AND status = 'DELIVERED'
       AND created_at >= NOW() - INTERVAL '${days} days'`,
      [staffId],
    ),
    AppDataSource.query<[{ count: string }]>(
      `SELECT COUNT(*)::int AS count FROM extension_proposals
       WHERE proposed_by = $1 AND status = 'APPROVED'
       AND created_at >= NOW() - INTERVAL '${days} days'`,
      [staffId],
    ),
    AppDataSource.query<[{ rate: string | null }]>(
      `SELECT
         COUNT(*) FILTER (
           WHERE s.created_at BETWEEN b.slot_start - INTERVAL '15 minutes'
                                  AND b.slot_start + INTERVAL '15 minutes'
         )::float / NULLIF(COUNT(*), 0) * 100 AS rate
       FROM sessions s
       JOIN bookings b ON b.id = s.booking_id
       WHERE s.checked_in_by = $1
       AND s.created_at >= NOW() - INTERVAL '${days} days'`,
      [staffId],
    ),
    AppDataSource.query<[{ count: string }]>(
      `SELECT COUNT(DISTINCT DATE(event_time))::int AS count FROM (
         SELECT created_at AS event_time FROM sessions WHERE checked_in_by = $1
           AND created_at >= NOW() - INTERVAL '${days} days'
         UNION ALL
         SELECT created_at FROM fnb_orders WHERE created_by = $1
           AND created_at >= NOW() - INTERVAL '${days} days'
         UNION ALL
         SELECT created_at FROM extension_proposals WHERE proposed_by = $1
           AND created_at >= NOW() - INTERVAL '${days} days'
       ) sub`,
      [staffId],
    ),
  ]);

  const rate = onTimeRow[0]?.rate;

  return {
    staffId,
    period,
    totalCheckIns: Number(checkInsRow[0]?.count ?? 0),
    totalFnbOrdersHandled: Number(fnbRow[0]?.count ?? 0),
    totalExtensionsApproved: Number(extensionsRow[0]?.count ?? 0),
    onTimeCheckInRate: rate != null ? Math.round(Number(rate) * 10) / 10 : null,
    activeDaysCount: Number(activeDaysRow[0]?.count ?? 0),
  };
}

export async function getStaffActivity(
  providerId: string,
  staffId: string,
  limit: number,
  offset: number,
): Promise<StaffActivityPage> {
  await getStaffOwnedByProvider(providerId, staffId);

  const [events, totalRow] = await Promise.all([
    AppDataSource.query<
      {
        id: string;
        type: string;
        event_time: Date;
        label: string;
        booking_id: string;
        booking_source: string;
      }[]
    >(
      `SELECT type, ref_id AS id, event_time, label, booking_id, booking_source FROM (
         SELECT 'CHECK_IN' AS type, s.id AS ref_id, s.created_at AS event_time,
                'Check-in' AS label,
                s.booking_id,
                b.source AS booking_source
         FROM sessions s JOIN bookings b ON b.id = s.booking_id
         WHERE s.checked_in_by = $1
         UNION ALL
         SELECT 'FNB_ORDER', fo.id, fo.created_at,
                'Order #' || UPPER(SUBSTRING(fo.id::text, 1, 4)),
                fo.booking_id,
                b.source
         FROM fnb_orders fo JOIN bookings b ON b.id = fo.booking_id
         WHERE fo.created_by = $1
         UNION ALL
         SELECT 'EXTENSION_APPROVED', ep.id, ep.created_at,
                'Gia hạn +' || ep.duration_minutes || ' phút',
                s.booking_id,
                b.source
         FROM extension_proposals ep
         JOIN sessions s ON s.id = ep.session_id
         JOIN bookings b ON b.id = s.booking_id
         WHERE ep.proposed_by = $1 AND ep.status = 'APPROVED'
         UNION ALL
         SELECT 'CHECK_OUT', s.id, s.actual_end_at,
                'Check-out',
                s.booking_id,
                b.source
         FROM sessions s JOIN bookings b ON b.id = s.booking_id
         WHERE s.checked_out_by = $1 AND s.actual_end_at IS NOT NULL
       ) events
       ORDER BY event_time DESC
       LIMIT $2 OFFSET $3`,
      [staffId, limit, offset],
    ),
    AppDataSource.query<[{ count: string }]>(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT id FROM sessions WHERE checked_in_by = $1
         UNION ALL
         SELECT id FROM fnb_orders WHERE created_by = $1
         UNION ALL
         SELECT id FROM extension_proposals WHERE proposed_by = $1 AND status = 'APPROVED'
         UNION ALL
         SELECT id FROM sessions WHERE checked_out_by = $1 AND actual_end_at IS NOT NULL
       ) sub`,
      [staffId],
    ),
  ]);

  const total = Number(totalRow[0]?.count ?? 0);

  return {
    events: events.map((e) => ({
      id: e.id,
      type: e.type as StaffActivityEvent['type'],
      eventTime: e.event_time.toISOString(),
      label: e.label,
      bookingId: e.booking_id,
      bookingSource: e.booking_source as StaffActivityEvent['bookingSource'],
    })),
    total,
    hasMore: offset + events.length < total,
  };
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
  // A session that has already become active is safe to reopen. CHECKED_IN only
  // means the handover is pending, so it must still obey the check-in deadline.
  if (existing && existing.status !== SessionStatus.CHECKED_IN) {
    return existing;
  }

  if (booking.slotStart.getTime() + 30 * 60 * 1000 < Date.now()) {
    throw new AppError(
      'Đơn đã quá thời hạn check-in 30 phút kể từ giờ bắt đầu',
      400,
      'CHECK_IN_WINDOW_EXPIRED',
    );
  }

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
  const cafe = await AppDataSource.getRepository(Cafe).findOne({ where: { id: booking.cafeId } });
  if (!cafe) {
    throw new AppError('Cafe không tồn tại', 404, 'CAFE_NOT_FOUND');
  }
  const trackType = await AppDataSource.getRepository(TrackType).findOne({
    where: { id: booking.trackTypeId },
  });

  const participants = await AppDataSource.getRepository(SessionParticipant).find({
    where: { sessionId },
  });
  const participantUserIds = participants
    .map((participant) => participant.userId)
    .filter((userId): userId is string => Boolean(userId));
  const participantUsers = participantUserIds.length
    ? await AppDataSource.getRepository(User).findByIds(participantUserIds)
    : [];
  const participantUserById = new Map(participantUsers.map((user) => [user.id, user]));
  // A session keeps a display-name snapshot for walk-in guests, but registered
  // customers must always be shown by their current profile name. Otherwise a
  // name change after check-in is never reflected in staff/customer history.
  const getParticipantName = (participant: SessionParticipant) =>
    (participant.userId
      ? participantUserById.get(participant.userId)?.full_name?.trim()
      : undefined) ||
    participant.displayName ||
    'Người chơi';

  const sessionVehicles = await AppDataSource.getRepository(SessionVehicle).find({
    where: { sessionId },
  });
  const vehiclesList = [];
  for (const sv of sessionVehicles) {
    let name = 'Xe tự mang (BYOC)';
    let imageUrl = undefined;
    let damageMultiplier = 1;
    if (sv.vehicleSource === VehicleSource.RENTAL && sv.vehicleId) {
      const vehicle = await AppDataSource.getRepository(Vehicle).findOne({
        where: { id: sv.vehicleId },
        relations: ['catalog'],
      });
      if (vehicle) {
        name = vehicle.catalog?.name || vehicle.identifier || 'Xe thuê';
        imageUrl = vehicle.distinctiveImageUrl || vehicle.catalog?.coverImageUrl || undefined;
        damageMultiplier = Number(vehicle.catalog?.damageMultiplier) || 1;
      }
    } else if (sv.vehicleSource === VehicleSource.BYOC && sv.assignedToParticipantId) {
      const sp = participants.find((p) => p.id === sv.assignedToParticipantId);
      if (sp) name = `Xe của ${getParticipantName(sp)} (BYOC)`;
    }
    vehiclesList.push({
      vehicleId: sv.vehicleId || sv.id,
      name,
      type: sv.vehicleSource === VehicleSource.RENTAL ? 'RENT' : 'BYOC',
      imageUrl,
      damageMultiplier,
    });
  }

  const rawInspections = await AppDataSource.getRepository(Inspection).find({
    where: { sessionId },
    order: { createdAt: 'DESC' },
  });
  const latestInspectionByType = new Map<InspectionType, Inspection>();
  for (const inspection of rawInspections) {
    if (!latestInspectionByType.has(inspection.type)) {
      latestInspectionByType.set(inspection.type, inspection);
    }
  }
  const inspections = [
    latestInspectionByType.get(InspectionType.CHECK_IN),
    latestInspectionByType.get(InspectionType.CHECK_OUT),
  ].filter((inspection): inspection is Inspection => Boolean(inspection));
  const mappedInspections = [];
  let damageClaim = undefined;

  let checkoutInspection: any = undefined;

  for (const insp of inspections) {
    const photos = await AppDataSource.getRepository(InspectionPhoto).find({
      where: { inspectionId: insp.id },
    });
    const checklist = await AppDataSource.getRepository(InspectionChecklist).find({
      where: { inspectionId: insp.id },
    });

    let damageLineItemsMapped: any[] = [];
    let totalDamageCharge = 0;
    if (insp.type === InspectionType.CHECK_OUT) {
      const lineItems = await AppDataSource.getRepository(DamageLineItem).find({
        where: { inspectionId: insp.id },
      });
      damageLineItemsMapped = lineItems.map((li) => ({
        id: li.id,
        partType: li.partType,
        customPartName: li.customPartName,
        partsPrice: Number(li.partsPrice),
        laborPrice: Number(li.laborPrice),
        lineTotal: Number(li.partsPrice) + Number(li.laborPrice),
      }));
      if (lineItems.length > 0) {
        totalDamageCharge = lineItems.reduce(
          (sum, li) => sum + Number(li.partsPrice) + Number(li.laborPrice),
          0,
        );
      } else {
        // Fallback for legacy records without line items
        totalDamageCharge = (Number(insp.damageCostEstimate) || 0) * 1.5;
      }
    }

    const mappedInsp = {
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
      damageLineItems: damageLineItemsMapped,
      totalDamageCharge,
    };
    mappedInspections.push(mappedInsp);

    if (insp.type === InspectionType.CHECK_OUT) {
      checkoutInspection = mappedInsp;

      if (insp.damageNoted) {
        const checkInPhoto = inspections.find((i) => i.type === InspectionType.CHECK_IN)?.id;
        const checkInPhotoUrl = checkInPhoto
          ? (
              await AppDataSource.getRepository(InspectionPhoto).findOne({
                where: { inspectionId: checkInPhoto },
              })
            )?.url || ''
          : '';
        const checkOutPhotoUrl = photos[0]?.url || '';

        damageClaim = {
          claimId: insp.id,
          description: insp.damageDescription || 'Hư hỏng thiết bị',
          damageLineItems: damageLineItemsMapped,
          totalDamageCharge,
          checkInPhoto: checkInPhotoUrl,
          checkOutPhoto: checkOutPhotoUrl,
          status: session.status === SessionStatus.COMPLETED ? 'CONFIRMED' : 'PENDING',
          expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
        };
      }
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
  const approvedExtensions = await AppDataSource.getRepository(ExtensionProposal).find({
    where: { sessionId, status: ExtensionProposalStatus.APPROVED },
  });
  const approvedExtensionFee = approvedExtensions.reduce(
    (sum, ext) => sum + Number(ext.feeAmount),
    0,
  );
  const approvedExtensionMinutes = approvedExtensions.reduce(
    (sum, ext) => sum + Number(ext.durationMinutes),
    0,
  );
  const mappedApprovedExtensions = approvedExtensions
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((ext) => ({
      proposalId: ext.id,
      extraMinutes: ext.durationMinutes,
      additionalFee: Number(ext.feeAmount),
      approvedAt: ext.respondedAt?.toISOString() ?? ext.updatedAt.toISOString(),
    }));

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
  const extensionPricingOptions = await buildExtensionPricingOptions(booking, session, cafe);
  const paymentComponents = await AppDataSource.getRepository(PaymentComponent).find({
    where: { bookingId: booking.id },
  });
  const slotFee = paymentComponents
    .filter((component) => component.type === PaymentComponentType.SLOT_FEE)
    .reduce((sum, component) => sum + Number(component.amount), 0);
  const rentalFee = paymentComponents
    .filter((component) => component.type === PaymentComponentType.RENTAL_FEE)
    .reduce((sum, component) => sum + Number(component.amount), 0);
  const fnbPreorderFee = mappedFnbOrders
    .filter(
      (order) =>
        order.orderType === FnbOrderType.PRE_ORDER && order.status !== FnbOrderStatus.CANCELLED,
    )
    .reduce((sum, order) => sum + Number(order.total), 0);
  const pendingPaymentComponents = paymentComponents.filter(
    (component) => component.status === PaymentComponentStatus.PENDING,
  );
  const pendingRefundComponents = paymentComponents.filter(
    (component) => component.status === PaymentComponentStatus.PENDING_REFUND,
  );
  const outstandingAmount = pendingPaymentComponents.reduce(
    (sum, component) => sum + Number(component.amount),
    0,
  );
  const pendingRefundAmount = pendingRefundComponents.reduce(
    (sum, component) => sum + Number(component.refundedAmount || 0),
    0,
  );
  const requiresSettlement =
    pendingPaymentComponents.length > 0 || pendingRefundComponents.length > 0;

  return {
    sessionId: session.id,
    bookingId: session.bookingId,
    cafeId: booking.cafeId,
    cafeName: cafe.name,
    cafeAddress: cafe.address,
    bookingSource: booking.source,
    playMode: booking.playMode,
    status: session.status,
    staffName: staffUser?.full_name || 'Nhân viên trực ca',
    actualStart: session.actualStartAt ? session.actualStartAt.toISOString() : undefined,
    actualEnd: session.actualEndAt ? session.actualEndAt.toISOString() : undefined,
    plannedEnd: session.plannedEndAt.toISOString(),
    participants: participants.map((p) => ({
      name: getParticipantName(p),
      type: 'PLAYER',
      avatarUrl: p.userId ? participantUserById.get(p.userId)?.avatar_url || undefined : undefined,
    })),
    vehicles: vehiclesList,
    inspections: mappedInspections,
    checkoutInspection,
    damageClaim,
    extensionProposal,
    approvedExtensionFee,
    approvedExtensionMinutes,
    approvedExtensions: mappedApprovedExtensions,
    extensionPricingOptions,
    fnbOrders: mappedFnbOrders,
    paymentSummary: {
      outstandingAmount,
      pendingRefundAmount,
      pendingPaymentCount: pendingPaymentComponents.length,
      pendingRefundCount: pendingRefundComponents.length,
      requiresSettlement,
    },
    // A session can be opened from the staff's historical list, where the
    // in-memory "today" context does not contain its booking. Return the
    // booking summary here so that page can render after a reload as well.
    booking: {
      bookingId: booking.id,
      shortCode: `RCF-${booking.id.substring(0, 4).toUpperCase()}`,
      cafeId: cafe.id,
      cafeName: cafe.name,
      cafeAddress: cafe.address,
      cafePhone: cafe.phone,
      trackName: trackType?.name || 'Đường đua',
      trackType: trackType?.code || '',
      bookingMode: 'SINGLE',
      playMode: booking.playMode,
      source: booking.source,
      status: booking.status,
      slotStart: booking.slotStart.toISOString(),
      slotEnd: booking.slotEnd.toISOString(),
      slotCount: booking.slotCount,
      depositAmount: paymentComponents
        .filter((component) => component.type === PaymentComponentType.SECURITY_DEPOSIT)
        .reduce((sum, component) => sum + Number(component.amount), 0),
      slotFee,
      rentalFee,
      fnbPreorderFee,
      discountAmount: Number(booking.discountAmount) || 0,
      totalAmount: slotFee + rentalFee + fnbPreorderFee,
      paymentStatus: requiresSettlement ? 'UNPAID' : 'PAID',
      payment_components: paymentComponents,
      plannedParticipants: participants.map((participant) => getParticipantName(participant)),
      participantDetails: participants.map((participant) => ({
        name: getParticipantName(participant),
        isBooker: false,
      })),
      plannedVehicles: vehiclesList.map((vehicle) => vehicle.name),
      sessions: [],
    },
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

  const { type, photos, checklist, staffNotes, damageFlagged, damageLineItems } = data;
  const inspectionType = type === 'CHECK_IN' ? InspectionType.CHECK_IN : InspectionType.CHECK_OUT;

  const existingInspection = await AppDataSource.getRepository(Inspection).findOne({
    where: { sessionId, type: inspectionType },
    order: { createdAt: 'DESC' },
  });
  if (
    existingInspection &&
    (inspectionType === InspectionType.CHECK_IN || !existingInspection.customerConfirmedAt)
  ) {
    return existingInspection;
  }

  let sessionVehicleId = null;
  const svRepo = AppDataSource.getRepository(SessionVehicle);
  const activeSVs = await svRepo.find({ where: { sessionId } });
  if (activeSVs.length > 0) {
    sessionVehicleId = activeSVs[0].id;
  }

  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });

  const inspection = new Inspection();
  inspection.sessionId = sessionId;
  inspection.sessionVehicleId = sessionVehicleId;
  inspection.type = inspectionType;
  const isByoc =
    booking?.playMode === 'BYOC' ||
    (activeSVs.length > 0 && activeSVs[0].vehicleSource === VehicleSource.BYOC);
  inspection.subjectType = isByoc
    ? InspectionSubjectType.BYOC_VEHICLE
    : InspectionSubjectType.RENTAL_VEHICLE;
  inspection.performedBy = staffUserId;
  inspection.preExistingFlag = type === 'CHECK_IN' ? false : true;
  inspection.damageNoted = !!damageFlagged;
  inspection.damageDescription = staffNotes || null;
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
        // Emit realtime cập nhật trạng thái xe cho provider
        try {
          const [vehMeta] = await AppDataSource.query<
            { cafe_id: string; identifier: string; provider_id: string }[]
          >(
            `SELECT v.cafe_id, v.identifier, c.provider_id FROM vehicles v JOIN cafes c ON c.id = v.cafe_id WHERE v.id = $1`,
            [sv.vehicleId],
          );
          if (vehMeta) {
            wsService.pushToUser(vehMeta.provider_id, 'VEHICLE_STATUS_CHANGED', {
              vehicleId: sv.vehicleId,
              cafeId: vehMeta.cafe_id,
              identifier: vehMeta.identifier,
              status: 'IN_USE',
            });
          }
        } catch {
          /* non-critical */
        }
      }
    }

    if (session.checkedInBy) {
      try {
        await createNotification(
          session.checkedInBy,
          NotificationType.CUSTOMER_CHECKIN_CONFIRMED,
          'Xe đã được bàn giao',
          `Biên bản bàn giao xe phiên chơi ${session.id.substring(0, 8)} đã được xác nhận.`,
          { sessionId, inspectionId: inspection.id, sessionStatus: session.status },
        );
        wsService.pushToUser(session.checkedInBy, 'CUSTOMER_CHECKIN_CONFIRMED', {
          sessionId,
          inspectionId: inspection.id,
          sessionStatus: session.status,
        });
      } catch (err) {
        logger.error('InspectionNotification', 'Failed to notify staff check-in confirmation', err);
      }
    }
  } else {
    // CHECK_OUT — set CHECKING_OUT or COMPLETED (for BYOC)
    if (booking && booking.playMode === 'BYOC') {
      session.status = SessionStatus.COMPLETED;
      session.actualEndAt = new Date();
      session.checkedOutBy = staffUserId;
      await AppDataSource.getRepository(Session).save(session);

      booking.status = BookingStatus.COMPLETED;
      booking.completedAt = new Date();
      await AppDataSource.getRepository(Booking).save(booking);

      await settleSessionCheckoutBilling(sessionId, inspection);
    } else {
      session.status = SessionStatus.CHECKING_OUT;
      session.checkedOutBy = staffUserId;
      await AppDataSource.getRepository(Session).save(session);
    }

    if (activeSVs.length > 0) {
      for (const sv of activeSVs) {
        sv.status = damageFlagged ? SessionVehicleStatus.DAMAGED : SessionVehicleStatus.RETURNED;
        if (booking && booking.playMode === 'BYOC') {
          sv.returnedAt = new Date();
        }
        await svRepo.save(sv);
      }
    }

    // Save damage line items in same transaction context
    if (Array.isArray(damageLineItems) && damageLineItems.length > 0) {
      const lineItemRepo = AppDataSource.getRepository(DamageLineItem);
      for (const item of damageLineItems) {
        const li = new DamageLineItem();
        li.inspectionId = inspection.id;
        li.partType = item.partType as DamagePartType;
        li.customPartName =
          item.partType === DamagePartType.OTHER ? (item.customPartName ?? null) : null;
        li.partsPrice = Number(item.partsPrice) || 0;
        li.laborPrice = Number(item.laborPrice) || 0;
        await lineItemRepo.save(li);
      }
    }
  }

  // Notify customer via WebSocket and save in DB
  if (booking?.customerId) {
    try {
      if (booking.playMode === 'BYOC' && inspection.type === InspectionType.CHECK_OUT) {
        await createNotification(
          booking.customerId,
          NotificationType.CUSTOMER_CHECKOUT_CONFIRMED,
          'Hoàn thành phiên chơi',
          'Phiên chơi của bạn đã kết thúc thành công. Cảm ơn bạn!',
        );

        wsService.pushToUser(booking.customerId, 'CUSTOMER_CHECKOUT_CONFIRMED', {
          sessionId,
          inspectionId: inspection.id,
          sessionStatus: session.status,
        });
      } else {
        const eventType =
          inspection.type === InspectionType.CHECK_IN
            ? 'SESSION_CHECKIN_INSPECTION'
            : 'SESSION_CHECKOUT_INSPECTION';
        await createNotification(
          booking.customerId,
          eventType as any,
          inspection.type === InspectionType.CHECK_IN ? 'Biên bản bàn giao xe' : 'Biên bản trả xe',
          inspection.type === InspectionType.CHECK_IN
            ? 'Nhân viên trực ca vừa gửi biên bản bàn giao xe. Vui lòng bấm vào để kiểm tra và xác nhận.'
            : 'Nhân viên trực ca vừa gửi biên bản trả xe. Vui lòng bấm vào để kiểm tra và xác nhận.',
          {
            sessionId,
            inspectionId: inspection.id,
            inspectionType: inspection.type,
            route: `/customer/inspections/${sessionId}?inspectionId=${inspection.id}`,
            damageFlagged: !!damageFlagged,
          },
        );

        wsService.pushToUser(booking.customerId, eventType, {
          sessionId,
          bookingId: booking.id,
          inspectionId: inspection.id,
          type: inspection.type,
          route: `/customer/inspections/${sessionId}?inspectionId=${inspection.id}`,
          damageFlagged: !!damageFlagged,
        });
      }
    } catch (err) {
      logger.error('InspectionNotification', 'Failed to notify customer inspection', err);
    }
  }

  const savedLineItems = await AppDataSource.getRepository(DamageLineItem).find({
    where: { inspectionId: inspection.id },
  });
  const totalDamageCharge = savedLineItems.reduce(
    (sum, li) => sum + Number(li.partsPrice) + Number(li.laborPrice),
    0,
  );

  // Create DAMAGE_CHARGE PENDING component immediately so the customer can pay via VNPAY
  // while session is still CHECKING_OUT. settleSessionCheckoutBilling will skip re-creation
  // via its !exists guard when the session is eventually confirmed/completed.
  if (inspection.type === InspectionType.CHECK_OUT && totalDamageCharge > 0 && booking) {
    const compRepo = AppDataSource.getRepository(PaymentComponent);
    const existing = await compRepo.findOne({
      where: { bookingId: booking.id, type: PaymentComponentType.DAMAGE_CHARGE },
    });
    if (!existing) {
      const damageComp = compRepo.create({
        bookingId: booking.id,
        type: PaymentComponentType.DAMAGE_CHARGE,
        amount: totalDamageCharge,
        status: PaymentComponentStatus.PENDING,
      });
      await compRepo.save(damageComp);
    }
  }

  logger.info('Staff', 'submitInspection', {
    sessionId,
    inspectionId: inspection.id,
    type: inspection.type,
    damageFlagged,
    lineItemCount: savedLineItems.length,
    totalDamageCharge,
  });

  return {
    inspectionId: inspection.id,
    sessionId,
    type: inspection.type,
    damageNoted: inspection.damageNoted,
    damageLineItems: savedLineItems.map((li) => ({
      id: li.id,
      partType: li.partType,
      customPartName: li.customPartName,
      partsPrice: Number(li.partsPrice),
      laborPrice: Number(li.laborPrice),
      lineTotal: Number(li.partsPrice) + Number(li.laborPrice),
    })),
    totalDamageCharge,
  };
}

function getSnapshotTrackConfigId(snapshot: object | null): string | null {
  const value = (snapshot as { track_config_id?: unknown } | null)?.track_config_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function resolveBookingTrackConfig(booking: Booking): Promise<CafeTrackConfig | null> {
  const trackConfigRepo = AppDataSource.getRepository(CafeTrackConfig);
  const trackConfigId = booking.trackConfigId ?? getSnapshotTrackConfigId(booking.snapshot);

  if (trackConfigId) {
    const trackConfig = await trackConfigRepo.findOne({
      where: { id: trackConfigId, cafeId: booking.cafeId, isActive: true },
    });
    if (trackConfig) return trackConfig;
  }

  return trackConfigRepo.findOne({
    where: { cafeId: booking.cafeId, trackTypeId: booking.trackTypeId, isActive: true },
  });
}

function formatSlotTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

const VN_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function getLocalDateStartUtcMs(value: Date): number {
  const local = new Date(value.getTime() + VN_TZ_OFFSET_MS);
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - VN_TZ_OFFSET_MS
  );
}

function getDayKeyForLocalStart(localStartUtcMs: number): string {
  const local = new Date(localStartUtcMs + VN_TZ_OFFSET_MS);
  return DAY_KEYS[local.getUTCDay()];
}

function parseOperatingTimeToMinutes(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return 24 * 60;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function buildOperatingWindow(
  operatingHours: CafeOperatingHours | null | undefined,
  localStartUtcMs: number,
): { openAt: Date; closeAt: Date } | null {
  const dayKey = getDayKeyForLocalStart(localStartUtcMs);
  const schedule = operatingHours?.[dayKey];
  if (!schedule || schedule.is_closed) return null;

  const openMinutes = parseOperatingTimeToMinutes(schedule.open);
  const closeMinutes = parseOperatingTimeToMinutes(schedule.close);
  if (openMinutes === null || closeMinutes === null) return null;

  let closeOffsetMinutes = closeMinutes;
  if (closeOffsetMinutes <= openMinutes) closeOffsetMinutes += 24 * 60;

  return {
    openAt: new Date(localStartUtcMs + openMinutes * 60000),
    closeAt: new Date(localStartUtcMs + closeOffsetMinutes * 60000),
  };
}

function resolveOperatingWindowForBooking(
  cafe: Cafe,
  booking: Booking,
): {
  openAt: Date;
  closeAt: Date;
} | null {
  const localStart = getLocalDateStartUtcMs(booking.slotStart);
  const candidates = [localStart, localStart - 24 * 60 * 60000];

  for (const candidate of candidates) {
    const window = buildOperatingWindow(cafe.operatingHours, candidate);
    if (
      window &&
      booking.slotStart.getTime() >= window.openAt.getTime() &&
      booking.slotStart.getTime() <= window.closeAt.getTime()
    ) {
      return window;
    }
  }

  return buildOperatingWindow(cafe.operatingHours, localStart);
}

function getExtensionBlockedReason(cafe: Cafe, booking: Booking, proposedEnd: Date): string | null {
  const operatingWindow = resolveOperatingWindowForBooking(cafe, booking);
  if (!operatingWindow) return null;
  if (proposedEnd.getTime() <= operatingWindow.closeAt.getTime()) return null;
  return `Vượt giờ đóng cửa (${formatSlotTime(operatingWindow.closeAt)})`;
}

async function getApprovedExtensionMinutes(sessionId: string): Promise<number> {
  const approvedExtensions = await AppDataSource.getRepository(ExtensionProposal).find({
    where: { sessionId, status: ExtensionProposalStatus.APPROVED },
  });
  return approvedExtensions.reduce((sum, ext) => sum + Number(ext.durationMinutes), 0);
}

async function getExtensionSlotRatePerMinute(booking: Booking, session: Session): Promise<number> {
  const slotComp = await AppDataSource.getRepository(PaymentComponent).findOne({
    where: { bookingId: booking.id, type: PaymentComponentType.SLOT_FEE },
  });
  const slotFee = slotComp ? Number(slotComp.amount) : 0;
  if (slotFee <= 0) return 0;

  const approvedExtensionMinutes = await getApprovedExtensionMinutes(session.id);
  const currentEndMs = Math.max(booking.slotEnd.getTime(), session.plannedEndAt.getTime());
  const currentDurationMinutes = (currentEndMs - booking.slotStart.getTime()) / 60000;
  const originalDurationMinutes = Math.max(currentDurationMinutes - approvedExtensionMinutes, 1);

  return slotFee / originalDurationMinutes;
}

function roundExtensionFee(ratePerMinute: number, extraMinutes: number): number {
  if (ratePerMinute <= 0 || extraMinutes <= 0) return 0;
  return Math.round((ratePerMinute * extraMinutes) / 1000) * 1000;
}

async function calculateExtensionFee(
  booking: Booking,
  session: Session,
  extraMinutes: number,
): Promise<number> {
  const ratePerMinute = await getExtensionSlotRatePerMinute(booking, session);
  return roundExtensionFee(ratePerMinute, extraMinutes);
}

async function buildExtensionPricingOptions(
  booking: Booking,
  session: Session,
  cafe: Cafe,
): Promise<
  Array<{
    extraMinutes: number;
    additionalFee: number;
    newPlannedEnd: string;
    available: boolean;
    blockedReason?: string;
  }>
> {
  const options = [15, 30, 60] as const;
  const ratePerMinute = await getExtensionSlotRatePerMinute(booking, session);
  return options.map((extraMinutes) => {
    const proposedEnd = new Date(session.plannedEndAt.getTime() + extraMinutes * 60000);
    const blockedReason = getExtensionBlockedReason(cafe, booking, proposedEnd);

    return {
      extraMinutes,
      additionalFee: roundExtensionFee(ratePerMinute, extraMinutes),
      newPlannedEnd: proposedEnd.toISOString(),
      available: !blockedReason,
      ...(blockedReason ? { blockedReason } : {}),
    };
  });
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

  const extraMinutes = Number(data.extraMinutes);
  const direct = Boolean(data.direct);
  if (!Number.isFinite(extraMinutes) || extraMinutes <= 0) {
    throw new AppError('Thời lượng gia hạn không hợp lệ', 400, 'INVALID_EXTENSION_DURATION');
  }
  if (session.status !== SessionStatus.ACTIVE) {
    throw new AppError('Chỉ có thể gia hạn phiên đang ACTIVE', 400, 'EXTENSION_NOT_ALLOWED');
  }

  const booking = await AppDataSource.getRepository(Booking)
    .createQueryBuilder('booking')
    .addSelect('booking.trackConfigId')
    .where('booking.id = :bookingId', { bookingId: session.bookingId })
    .getOne();
  if (!booking) {
    throw new AppError('Không tìm thấy đơn đặt lịch gốc của phiên này', 404, 'BOOKING_NOT_FOUND');
  }
  if (direct && booking.source !== BookingSource.STAFF_MANUAL) {
    throw new AppError(
      'Đơn đặt trước cần khách xác nhận gia hạn qua app',
      400,
      'DIRECT_EXTENSION_NOT_ALLOWED',
    );
  }

  const additionalFee = await calculateExtensionFee(booking, session, extraMinutes);
  const extensionStart = session.plannedEndAt;
  const proposedEnd = new Date(extensionStart.getTime() + extraMinutes * 60 * 1000);
  const activeStatuses = [BookingStatus.PENDING, BookingStatus.CONFIRMED];
  const cafe = await AppDataSource.getRepository(Cafe).findOne({ where: { id: booking.cafeId } });
  if (!cafe) {
    throw new AppError('Cafe không tồn tại', 404, 'CAFE_NOT_FOUND');
  }
  const operatingHoursBlockedReason = getExtensionBlockedReason(cafe, booking, proposedEnd);
  if (operatingHoursBlockedReason) {
    throw new AppError(
      `Không thể gia hạn thêm ${extraMinutes} phút vì ${operatingHoursBlockedReason.toLowerCase()}.`,
      409,
      'OPERATING_HOURS_EXCEEDED',
    );
  }
  const trackConfig = await resolveBookingTrackConfig(booking);

  const applyTrackScope = (query: SelectQueryBuilder<Booking>) => {
    if (trackConfig) {
      query.andWhere(
        '(b.track_config_id = :trackConfigId OR (b.track_config_id IS NULL AND b.track_type_id = :trackTypeId))',
        { trackConfigId: trackConfig.id, trackTypeId: booking.trackTypeId },
      );
    } else {
      query.andWhere('b.track_type_id = :trackTypeId', { trackTypeId: booking.trackTypeId });
    }
    return query;
  };

  const buildOverlapQuery = () =>
    applyTrackScope(
      AppDataSource.getRepository(Booking)
        .createQueryBuilder('b')
        .where('b.cafe_id = :cafeId', { cafeId: booking.cafeId })
        .andWhere('b.id != :bookingId', { bookingId: booking.id })
        .andWhere('b.play_mode = :playMode', { playMode: booking.playMode })
        .andWhere('b.status IN (:...statuses)', { statuses: activeStatuses })
        .andWhere('b.slot_start < :proposedEnd', { proposedEnd })
        .andWhere('b.slot_end > :extensionStart', { extensionStart }),
    );

  if (booking.playMode === BookingMode.RENTAL) {
    const sessionVehicleRows = await AppDataSource.getRepository(SessionVehicle).find({
      where: {
        sessionId,
        vehicleSource: VehicleSource.RENTAL,
        returnedAt: IsNull(),
      },
    });
    let currentVehicleIds = sessionVehicleRows
      .map((sv) => sv.vehicleId)
      .filter((vehicleId): vehicleId is string => Boolean(vehicleId));

    if (currentVehicleIds.length === 0) {
      const bookingVehicles = await AppDataSource.getRepository(BookingVehicle).find({
        where: { bookingId: booking.id },
      });
      currentVehicleIds = bookingVehicles.map((bv) => bv.vehicleId);
    }

    if (currentVehicleIds.length > 0) {
      const vehicleConflict = await AppDataSource.getRepository(BookingVehicle)
        .createQueryBuilder('bv')
        .innerJoin(Booking, 'b', 'b.id = bv.booking_id')
        .where('bv.vehicle_id IN (:...vehicleIds)', { vehicleIds: currentVehicleIds })
        .andWhere('b.cafe_id = :cafeId', { cafeId: booking.cafeId })
        .andWhere('b.id != :bookingId', { bookingId: booking.id })
        .andWhere('b.status IN (:...statuses)', { statuses: activeStatuses })
        .andWhere('b.slot_start < :proposedEnd', { proposedEnd })
        .andWhere('b.slot_end > :extensionStart', { extensionStart })
        .select('b.slot_start', 'slotStart')
        .orderBy('b.slot_start', 'ASC')
        .getRawOne<{ slotStart: Date }>();

      if (vehicleConflict) {
        throw new AppError(
          `Xe đang dùng đã có đơn đặt lịch lúc ${formatSlotTime(vehicleConflict.slotStart)}. Không thể gia hạn thêm ${extraMinutes} phút.`,
          409,
          'SLOT_CONFLICT',
        );
      }
    }

    const capacity = Number(trackConfig?.maxConcurrent ?? cafe.maxConcurrentBookings);
    const overlaps = await buildOverlapQuery()
      .select('b.id', 'bookingId')
      .addSelect('b.slot_start', 'slotStart')
      .orderBy('b.slot_start', 'ASC')
      .getRawMany<{ bookingId: string; slotStart: Date }>();

    if (overlaps.length + 1 > capacity) {
      const firstConflictTime = overlaps[0]?.slotStart ?? extensionStart;
      throw new AppError(
        `Slot tiếp theo đã hết chỗ (${formatSlotTime(firstConflictTime)}). Không thể gia hạn thêm ${extraMinutes} phút.`,
        409,
        'SLOT_CONFLICT',
      );
    }
  } else {
    const capacity = Number(trackConfig?.byocCapacity ?? cafe.byocCapacity);
    const overlapRows = await buildOverlapQuery()
      .leftJoin(BookingParticipant, 'bp', 'bp.booking_id = b.id')
      .select('b.id', 'bookingId')
      .addSelect('b.slot_start', 'slotStart')
      .addSelect('COUNT(bp.id)', 'participantCount')
      .groupBy('b.id')
      .addGroupBy('b.slot_start')
      .orderBy('b.slot_start', 'ASC')
      .getRawMany<{ bookingId: string; slotStart: Date; participantCount: string }>();

    const occupiedPlayers = overlapRows.reduce(
      (sum, row) => sum + Math.max(Number(row.participantCount) || 0, 1),
      0,
    );
    const currentPlayers = Math.max(
      await AppDataSource.getRepository(BookingParticipant).count({
        where: { bookingId: booking.id },
      }),
      1,
    );

    if (occupiedPlayers + currentPlayers > capacity) {
      const firstConflictTime = overlapRows[0]?.slotStart ?? extensionStart;
      throw new AppError(
        `Slot tiếp theo đã hết chỗ (${formatSlotTime(firstConflictTime)}). Không thể gia hạn thêm ${extraMinutes} phút.`,
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
      booking.slotEnd = session.plannedEndAt;
      await AppDataSource.getRepository(Booking).save(booking);

      if (booking.customerId) {
        await createNotification(
          booking.customerId,
          'SESSION_EXTENSION_PROPOSED' as any,
          'Ca chơi đã được gia hạn',
          `Ca chơi của bạn đã được gia hạn thêm ${extraMinutes} phút bởi nhân viên.`,
          {
            sessionId,
            proposalId: proposal.id,
            extraMinutes,
            additionalFee: Number(additionalFee),
            route: `/customer/extension/${sessionId}`,
          },
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
      {
        sessionId,
        proposalId: proposal.id,
        extraMinutes: proposal.durationMinutes,
        additionalFee: Number(proposal.feeAmount),
        expiresAt: expiresAt.toISOString(),
        route: `/customer/extension/${sessionId}`,
      },
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
        {
          sessionId: session.id,
          bookingId: booking.id,
          totalAmount: total,
          route: `/booking/${booking.id}`,
        },
      );

      wsService.pushToUser(booking.customerId, 'SESSION_FNB_ORDER_ADDED', {
        sessionId: session.id,
        bookingId: booking.id,
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
        {
          bookingId: booking.id,
          route: `/customer/review/${booking.id}`,
        },
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
      booking.slotEnd = session.plannedEndAt;
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

    if (inspection.damageNoted) {
      await handleVehicleCheckoutMaintenance(sessionId, inspection, session.checkedOutBy);
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
            {
              bookingId: booking.id,
              route: `/customer/review/${booking.id}`,
            },
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
        { sessionId, inspectionId, sessionStatus: session.status },
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
        {
          sessionId,
          inspectionId,
          inspectionType: inspection.type,
          disagreementNote,
        },
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
    booking.slotEnd = session.plannedEndAt;
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
      {
        sessionId,
        proposalId: latestProposal.id,
        extraMinutes: latestProposal.durationMinutes,
        sessionStatus: session.status,
      },
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

async function handleVehicleCheckoutMaintenance(
  sessionId: string,
  inspection: Inspection,
  staffUserId?: string | null,
): Promise<void> {
  if (!inspection.damageNoted) return;

  const lineItems = await AppDataSource.getRepository(DamageLineItem).find({
    where: { inspectionId: inspection.id },
  });
  const totalCost = lineItems.reduce(
    (sum, item) => sum + (Number(item.partsPrice) || 0) + (Number(item.laborPrice) || 0),
    0,
  );

  const svs = await AppDataSource.getRepository(SessionVehicle).find({ where: { sessionId } });
  for (const sv of svs) {
    if (sv.vehicleId) {
      await AppDataSource.getRepository(Vehicle).update(sv.vehicleId, {
        status: VehicleStatus.MAINTENANCE,
      });

      await AppDataSource.query<{ id: string }[]>(
        `INSERT INTO vehicle_maintenance_logs (vehicle_id, related_session_id, type, description, cost, status, performed_by, performed_at)
         VALUES ($1, $2, 'REPAIR', $3, $4, 'PENDING_REPAIR', $5, NOW())
         RETURNING id`,
        [
          sv.vehicleId,
          sessionId,
          inspection.damageDescription || 'Xe ghi nhận hư hỏng sau Check-out.',
          totalCost,
          staffUserId || null,
        ],
      );

      try {
        const [vehInfo] = await AppDataSource.query<
          {
            vehicleIdentifier: string;
            categoryName: string | null;
            cafeName: string;
            providerId: string;
            cafeId: string;
          }[]
        >(
          `SELECT v.identifier AS "vehicleIdentifier", vc.name AS "categoryName", c.name AS "cafeName", c.provider_id AS "providerId", c.id AS "cafeId"
           FROM vehicles v
           JOIN cafes c ON v.cafe_id = c.id
           LEFT JOIN vehicle_catalogs vc ON v.catalog_id = vc.id
           WHERE v.id = $1`,
          [sv.vehicleId],
        );

        if (vehInfo && vehInfo.providerId) {
          const vehName = vehInfo.categoryName
            ? `${vehInfo.categoryName} (${vehInfo.vehicleIdentifier})`
            : vehInfo.vehicleIdentifier;

          const notifTitle = 'Cảnh báo xe cần bảo trì';
          const notifMessage = `Xe ${vehName} thuộc cơ sở ${vehInfo.cafeName} vừa ghi nhận hư hỏng cần bảo trì từ Check-out.`;

          await createNotification(
            vehInfo.providerId,
            NotificationType.SYSTEM,
            notifTitle,
            notifMessage,
            {
              vehicleId: sv.vehicleId,
              vehicleName: vehName,
              cafeName: vehInfo.cafeName,
              status: 'PENDING_REPAIR',
              route: '/provider/cafe-vehicles',
            },
          );

          wsService.pushToUser(vehInfo.providerId, 'VEHICLE_MAINTENANCE_CREATED', {
            title: notifTitle,
            message: notifMessage,
            vehicleId: sv.vehicleId,
            vehicleName: vehName,
            cafeName: vehInfo.cafeName,
            route: '/provider/cafe-vehicles',
          });

          wsService.pushToUser(vehInfo.providerId, 'VEHICLE_STATUS_CHANGED', {
            vehicleId: sv.vehicleId,
            cafeId: vehInfo.cafeId,
            identifier: vehInfo.vehicleIdentifier,
            status: 'MAINTENANCE',
          });
        }
      } catch (err) {
        logger.error('Staff', 'Failed to create provider maintenance alert notification', err);
      }
    }
  }
}

// ── STAFF CONFIRM CHECKOUT ────────────────────────────────────────────────────

export async function staffConfirmCheckout(
  sessionId: string,
  inspectionId: string,
  staffUserId: string,
): Promise<any> {
  const sessionRepo = AppDataSource.getRepository(Session);
  const session = await sessionRepo.findOne({ where: { id: sessionId } });
  if (!session) throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');

  const inspRepo = AppDataSource.getRepository(Inspection);
  const inspection = await inspRepo.findOne({ where: { id: inspectionId, sessionId } });
  if (!inspection)
    throw new AppError('Biên bản kiểm xe không tồn tại', 404, 'INSPECTION_NOT_FOUND');
  if (inspection.type !== InspectionType.CHECK_OUT) {
    throw new AppError('Biên bản không phải loại CHECK_OUT', 400, 'INVALID_INSPECTION_TYPE');
  }

  // Customer confirmation can complete the checkout while this staff page is
  // still open. Treat a second confirmation as a successful no-op instead of
  // leaving the staff UI stuck on stale CHECKING_OUT data.
  if (session.status === SessionStatus.COMPLETED && inspection.customerConfirmed) {
    return {
      success: true,
      sessionId,
      sessionStatus: SessionStatus.COMPLETED,
      alreadyCompleted: true,
    };
  }

  if (session.status !== SessionStatus.CHECKING_OUT) {
    throw new AppError(
      'Phiên chạy không ở trạng thái chờ xác nhận trả xe',
      400,
      'INVALID_SESSION_STATE',
    );
  }

  // Staff confirms at counter after customer reviews breakdown
  inspection.customerConfirmed = true;
  inspection.customerConfirmedAt = new Date();
  await inspRepo.save(inspection);

  session.status = SessionStatus.COMPLETED;
  session.actualEndAt = new Date();
  await sessionRepo.save(session);

  const svs = await AppDataSource.getRepository(SessionVehicle).find({ where: { sessionId } });
  for (const sv of svs) {
    const newStatus = inspection.damageNoted ? VehicleStatus.MAINTENANCE : VehicleStatus.AVAILABLE;
    if (sv.vehicleId) {
      await AppDataSource.getRepository(Vehicle).update(sv.vehicleId, { status: newStatus });
    }
  }

  // Xử lý bảo trì, tạo log và phát WS chỉ khi đã bấm XÁC NHẬN checkout
  if (inspection.damageNoted) {
    await handleVehicleCheckoutMaintenance(sessionId, inspection, staffUserId);
  }

  await settleSessionCheckoutBilling(sessionId, inspection);

  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  const allSessions = await sessionRepo.find({ where: { bookingId: session.bookingId } });
  const allDone = allSessions.every((s) => s.status === SessionStatus.COMPLETED);
  if (allDone && booking) {
    const pendingCount = await AppDataSource.getRepository(PaymentComponent).count({
      where: { bookingId: session.bookingId, status: PaymentComponentStatus.PENDING },
    });
    await AppDataSource.getRepository(Booking).update(
      session.bookingId,
      pendingCount > 0
        ? { status: BookingStatus.AWAITING_PAYMENT }
        : { status: BookingStatus.COMPLETED, completedAt: new Date() },
    );
  }

  logger.info('Staff', 'staffConfirmCheckout', { sessionId, inspectionId, staffUserId });
  return { success: true, sessionId, sessionStatus: SessionStatus.COMPLETED };
}

// ── UPDATE DAMAGE LINE ITEMS (staff edits before confirming) ─────────────────

export async function updateDamageLineItems(
  sessionId: string,
  inspectionId: string,
  damageLineItems: {
    partType: DamagePartType;
    customPartName?: string;
    partsPrice: number;
    laborPrice?: number;
  }[],
): Promise<{ inspectionId: string; damageLineItems: any[]; totalDamageCharge: number }> {
  const inspRepo = AppDataSource.getRepository(Inspection);
  const inspection = await inspRepo.findOne({ where: { id: inspectionId, sessionId } });
  if (!inspection)
    throw new AppError('Biên bản kiểm xe không tồn tại', 404, 'INSPECTION_NOT_FOUND');

  const liRepo = AppDataSource.getRepository(DamageLineItem);
  const existing = await liRepo.find({ where: { inspectionId } });
  for (const item of existing) {
    await liRepo.softDelete(item.id);
  }

  const saved: DamageLineItem[] = [];
  for (const li of damageLineItems) {
    const item = liRepo.create({
      inspectionId,
      partType: li.partType,
      customPartName: li.customPartName ?? null,
      partsPrice: li.partsPrice,
      laborPrice: li.laborPrice ?? 0,
    });
    saved.push(await liRepo.save(item));
  }

  const totalDamageCharge = saved.reduce(
    (sum, li) => sum + Number(li.partsPrice) + Number(li.laborPrice),
    0,
  );

  inspection.damageNoted = saved.length > 0;
  await inspRepo.save(inspection);

  // Sync the DAMAGE_CHARGE PENDING component amount to match updated line items
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (session) {
    const compRepo = AppDataSource.getRepository(PaymentComponent);
    const damageComp = await compRepo.findOne({
      where: { bookingId: session.bookingId, type: PaymentComponentType.DAMAGE_CHARGE },
    });
    if (damageComp && damageComp.status === PaymentComponentStatus.PENDING) {
      damageComp.amount = totalDamageCharge;
      await compRepo.save(damageComp);
    } else if (!damageComp && totalDamageCharge > 0) {
      await compRepo.save(
        compRepo.create({
          bookingId: session.bookingId,
          type: PaymentComponentType.DAMAGE_CHARGE,
          amount: totalDamageCharge,
          status: PaymentComponentStatus.PENDING,
        }),
      );
    }
  }

  return {
    inspectionId,
    damageLineItems: saved.map((li) => ({
      id: li.id,
      partType: li.partType,
      customPartName: li.customPartName,
      partsPrice: Number(li.partsPrice),
      laborPrice: Number(li.laborPrice),
      lineTotal: Number(li.partsPrice) + Number(li.laborPrice),
    })),
    totalDamageCharge,
  };
}

// ── ESCALATE DISPUTE TO PROVIDER ──────────────────────────────────────────────

export async function escalateDisputeToProvider(
  sessionId: string,
  inspectionId: string,
  note: string,
  staffUserId: string,
): Promise<any> {
  const session = await AppDataSource.getRepository(Session).findOne({ where: { id: sessionId } });
  if (!session) throw new AppError('Phiên chạy không tồn tại', 404, 'SESSION_NOT_FOUND');

  const inspRepo = AppDataSource.getRepository(Inspection);
  const inspection = await inspRepo.findOne({ where: { id: inspectionId, sessionId } });
  if (!inspection)
    throw new AppError('Biên bản kiểm xe không tồn tại', 404, 'INSPECTION_NOT_FOUND');

  inspection.damageDescription =
    (inspection.damageDescription || '') +
    ` [Leo thang tranh chấp bởi NV ${staffUserId.substring(0, 8)}: ${note}]`;
  await inspRepo.save(inspection);

  const booking = await AppDataSource.getRepository(Booking).findOne({
    where: { id: session.bookingId },
  });
  if (booking) {
    const cafe = await AppDataSource.getRepository(Cafe).findOne({ where: { id: booking.cafeId } });
    if (cafe?.providerId) {
      await createNotification(
        cafe.providerId,
        NotificationType.CUSTOMER_INSPECTION_DISPUTED,
        'Tranh chấp biên bản hư hỏng xe cần xem xét',
        `Nhân viên báo cáo tranh chấp phiên chơi ${session.id.substring(0, 8)}: "${note}". Vui lòng xem xét và phán quyết.`,
      );
      wsService.pushToUser(cafe.providerId, 'CUSTOMER_INSPECTION_DISPUTED', {
        sessionId,
        inspectionId,
        note,
        staffUserId,
      });
    }
  }

  logger.info('Staff', 'escalateDisputeToProvider', { sessionId, inspectionId, staffUserId });
  return { success: true, sessionId, inspectionId };
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
    const lineItems = await AppDataSource.getRepository(DamageLineItem).find({
      where: { inspectionId: inspection.id },
    });
    if (lineItems.length > 0) {
      damageCharge = lineItems.reduce(
        (sum, li) => sum + Number(li.partsPrice) + Number(li.laborPrice),
        0,
      );
    } else {
      // Fallback for legacy records without line items
      const estimatedCost = Number(inspection.damageCostEstimate) || 0;
      damageCharge = estimatedCost * 1.5;
    }
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
    const existingExtensionComp = existingComponents.find(
      (c) => c.type === PaymentComponentType.EXTENSION_FEE,
    );
    if (existingExtensionComp) {
      existingExtensionComp.amount = totalExtensionFee;
      if (existingExtensionComp.status !== PaymentComponentStatus.DISBURSED) {
        existingExtensionComp.status = PaymentComponentStatus.PENDING;
      }
      await compRepo.save(existingExtensionComp);
    } else {
      newComponents.push({
        bookingId: booking.id,
        type: PaymentComponentType.EXTENSION_FEE,
        amount: totalExtensionFee,
        status: PaymentComponentStatus.PENDING,
      });
    }
  }

  if (totalOnsiteFnb > 0) {
    const existingOnsiteFnbComp = existingComponents.find(
      (c) =>
        c.type === PaymentComponentType.FB_PREORDER && c.status === PaymentComponentStatus.PENDING,
    );
    if (existingOnsiteFnbComp) {
      existingOnsiteFnbComp.amount = totalOnsiteFnb;
      await compRepo.save(existingOnsiteFnbComp);
    } else {
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

export async function settlePendingPayments(bookingId: string, staffUserId: string): Promise<any> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking) throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');

  const compRepo = AppDataSource.getRepository(PaymentComponent);
  const txRepo = AppDataSource.getRepository(PaymentTransaction);
  const sessionForNotification = await AppDataSource.getRepository(Session).findOne({
    where: { bookingId },
    order: { createdAt: 'DESC' },
  });

  if (sessionForNotification && sessionForNotification.status === SessionStatus.CHECKING_OUT) {
    const session = sessionForNotification;
    const inspection = await AppDataSource.getRepository(Inspection).findOne({
      where: { sessionId: session.id, type: InspectionType.CHECK_OUT },
    });

    if (inspection) {
      inspection.customerConfirmed = true;
      if (!inspection.customerConfirmedAt) {
        inspection.customerConfirmedAt = new Date();
      }
      await AppDataSource.getRepository(Inspection).save(inspection);

      session.status = SessionStatus.COMPLETED;
      session.actualEndAt = new Date();
      session.checkedOutBy = staffUserId;
      await AppDataSource.getRepository(Session).save(session);

      const svs = await AppDataSource.getRepository(SessionVehicle).find({
        where: { sessionId: session.id },
      });
      for (const sv of svs) {
        const newStatus = inspection.damageNoted
          ? VehicleStatus.MAINTENANCE
          : VehicleStatus.AVAILABLE;
        if (sv.vehicleId) {
          await AppDataSource.getRepository(Vehicle).update(sv.vehicleId, { status: newStatus });
        }
      }

      if (inspection.damageNoted) {
        const [existingLog] = await AppDataSource.query<{ id: string }[]>(
          `SELECT id FROM vehicle_maintenance_logs WHERE related_session_id = $1 LIMIT 1`,
          [session.id],
        );
        if (!existingLog) {
          await handleVehicleCheckoutMaintenance(session.id, inspection, staffUserId);
        }
      }

      await settleSessionCheckoutBilling(session.id, inspection);
    }
  }

  // ── FLOW 1: DEPOSIT REFUND ────────────────────────────────────────────────
  // Finalize the deposit component: Staff confirms they physically returned the
  // refund amount to the customer. Move from PENDING_REFUND → REFUNDED / PARTIALLY_REFUNDED.
  const depositComp = await compRepo.findOne({
    where: { bookingId, type: PaymentComponentType.SECURITY_DEPOSIT },
  });
  const pendingComponents = await compRepo.find({
    where: { bookingId, status: PaymentComponentStatus.PENDING },
  });
  const hasPendingRefund = depositComp?.status === PaymentComponentStatus.PENDING_REFUND;

  if (!hasPendingRefund && pendingComponents.length === 0) {
    throw new AppError(
      'Đơn này không còn khoản thanh toán hoặc hoàn tiền cần xử lý',
      409,
      'NO_PENDING_SETTLEMENT',
    );
  }

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
    const shortRef = booking.id.substring(0, 8).toUpperCase();
    if (booking.customerId) {
      await createNotification(
        booking.customerId,
        NotificationType.CUSTOMER_PAYMENT_CONFIRMED,
        'Thanh toán thành công',
        `Đơn đặt #${shortRef} đã được quyết toán hoàn tất tại quầy.`,
        {
          bookingId,
          totalCounterBill,
          depositRefundAmount,
          netCounterAmount,
          route: `/booking/${bookingId}`,
        },
      );
      wsService.pushToUser(booking.customerId, 'CUSTOMER_PAYMENT_CONFIRMED', {
        bookingId,
        totalCounterBill,
        depositRefundAmount,
        netCounterAmount,
      });
    }
    await createNotification(
      staffUserId,
      NotificationType.CUSTOMER_PAYMENT_CONFIRMED,
      'Quyết toán hoàn tất',
      `Đơn đặt #${shortRef} đã được quyết toán thành công.`,
      {
        bookingId,
        ...(sessionForNotification
          ? {
              sessionId: sessionForNotification.id,
              route: `/staff/session/${sessionForNotification.id}`,
            }
          : {}),
        totalCounterBill,
        depositRefundAmount,
        netCounterAmount,
      },
    );
    wsService.pushToUser(staffUserId, 'CUSTOMER_PAYMENT_CONFIRMED', {
      bookingId,
      ...(sessionForNotification ? { sessionId: sessionForNotification.id } : {}),
      totalCounterBill,
      depositRefundAmount,
      netCounterAmount,
    });
  } catch (err) {
    logger.error('SettlePendingNotification', 'Failed to notify', err);
  }

  const allSessions = await AppDataSource.getRepository(Session).find({
    where: { bookingId },
  });
  const allDone = allSessions.every((s) => s.status === SessionStatus.COMPLETED);

  if (allDone) {
    const pendingCount = await AppDataSource.getRepository(PaymentComponent).count({
      where: { bookingId, status: PaymentComponentStatus.PENDING },
    });

    if (pendingCount === 0) {
      if (booking.status === BookingStatus.AWAITING_PAYMENT) {
        await transition(bookingId, 'PAYMENT_SETTLED');
      } else if (booking.status === BookingStatus.CONFIRMED) {
        await transition(bookingId, 'COMPLETE');
      }

      await AppDataSource.getRepository(Booking).update(bookingId, {
        completedAt: new Date(),
      });

      if (booking.source !== BookingSource.STAFF_MANUAL && booking.customerId) {
        await createNotification(
          booking.customerId,
          NotificationType.BOOKING_REVIEW_REQUEST,
          'Đánh giá trải nghiệm của bạn',
          'Cảm ơn bạn đã sử dụng dịch vụ! Hãy dành 1 phút đánh giá trải nghiệm của bạn.',
          {
            bookingId,
            route: `/customer/review/${bookingId}`,
          },
        ).catch(() => {});
        wsService.pushToUser(booking.customerId, 'BOOKING_REVIEW_REQUEST', { bookingId });
      }
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

export async function createWalkInBooking(
  staffId: string,
  cafeId: string,
  body: any,
): Promise<any> {
  return createWalkInBookingService(staffId, cafeId, body);
}

const PART_TYPE_VIETNAMESE: Record<string, string> = {
  TIRE_WHEEL: 'Bánh xe / Lốp',
  SPOILER: 'Cánh gió',
  CHASSIS: 'Khung gầm',
  MOTOR: 'Motor / Động cơ',
  SHELL: 'Vỏ nhựa (Shell)',
  SERVO: 'Servo / Tay lái',
  REMOTE: 'Remote / Điều khiển',
  OTHER: 'Khác',
};

export interface StaffMaintenanceLogItem {
  logId: string;
  logCode: string;
  vehicleId: string;
  vehicleIdentifier: string;
  vehicleName: string;
  vehicleImageUrl?: string;
  cafeId: string;
  cafeName: string;
  categoryId: string;
  categoryName: string;
  categoryTier: string;
  issueDescription: string;
  staffNotes: string | null;
  cost: number;
  performedBy: string | null;
  status: 'SENT_TO_PROVIDER' | 'PENDING_REPAIR' | 'RECEIVED' | 'COMPLETED';
  createdAt: string;
  completedAt: string | null;
  inspectionPhotos?: { angle: string; url: string }[];
  damagedChecklist?: { itemKey: string; itemLabel: string; status: string; note: string }[];
}

export async function getMaintenanceLogs(
  cafeId: string,
  status?: string,
  search?: string,
): Promise<StaffMaintenanceLogItem[]> {
  await AppDataSource.query(
    `ALTER TABLE vehicle_maintenance_logs ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDING_REPAIR'`,
  );

  const params: any[] = [cafeId];
  let statusClause = '';
  let searchClause = '';

  if (status && status !== 'ALL') {
    params.push(status);
    statusClause = `AND (vml.status = $${params.length} OR v.status = $${params.length})`;
  }

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    const idx = params.length;
    searchClause = `AND (
      LOWER(v.identifier) LIKE $${idx} OR 
      LOWER(vc.name) LIKE $${idx} OR 
      LOWER(vml.description) LIKE $${idx} OR 
      LOWER(vml.id::text) LIKE $${idx}
    )`;
  }

  const rows = await AppDataSource.query<any[]>(
    `SELECT 
       COALESCE(vml.id::text, v.id::text) AS "logId",
       COALESCE(
         vml.status,
         CASE WHEN v.status = 'AVAILABLE' THEN 'COMPLETED' ELSE 'PENDING_REPAIR' END
       ) AS "status",
       COALESCE(vml.type, 'REPAIR') AS "type",
       COALESCE(vml.description, 'Xe ghi nhận hư hỏng cần bảo trì.') AS "issueDescription",
       COALESCE(vml.cost, 0) AS "cost",
       vml.performed_at AS "performedAt",
       COALESCE(vml.created_at, v.updated_at, NOW()) AS "createdAt",
       u_staff.full_name AS "performedBy",
       
       v.id AS "vehicleId",
       v.identifier AS "vehicleIdentifier",
       v.status AS "vehicleStatus",
       v.distinctive_image_url AS "vehicleImageUrl",
       
       c.id AS "cafeId",
       c.name AS "cafeName",
       
       vc.id AS "categoryId",
       vc.name AS "categoryName",
       vc.tier AS "categoryTier",

       (
         SELECT i.id
         FROM inspections i
         LEFT JOIN session_vehicles sv ON sv.session_id = i.session_id
         WHERE (i.session_id = vml.related_session_id OR sv.vehicle_id = v.id)
           AND i.type = 'CHECK_OUT'
         ORDER BY i.created_at DESC
         LIMIT 1
       ) AS "inspectionId"
     FROM vehicles v
     JOIN cafes c ON v.cafe_id = c.id
     LEFT JOIN vehicle_catalogs vc ON v.catalog_id = vc.id
     LEFT JOIN vehicle_maintenance_logs vml ON vml.vehicle_id = v.id
     LEFT JOIN users u_staff ON vml.performed_by = u_staff.id
     WHERE v.deleted_at IS NULL
       AND c.id = $1
       AND (vml.id IS NOT NULL OR v.status = 'MAINTENANCE')
       ${statusClause}
       ${searchClause}
     ORDER BY COALESCE(vml.created_at, v.updated_at) DESC`,
    params,
  );

  const result: StaffMaintenanceLogItem[] = [];

  for (const row of rows) {
    let photos: { angle: string; url: string }[] = [];
    let damagedChecklist: { itemKey: string; itemLabel: string; status: string; note: string }[] =
      [];
    let damageLineItems: {
      partType: string;
      customPartName?: string;
      partsPrice: number;
      laborPrice: number;
    }[] = [];
    let inspectionNote = '';

    if (row.inspectionId) {
      const photosRows = await AppDataSource.query<any[]>(
        `SELECT angle, url FROM inspection_photos WHERE inspection_id = $1`,
        [row.inspectionId],
      );
      photos = photosRows;

      const checklistRows = await AppDataSource.query<any[]>(
        `SELECT item_key AS "itemKey", item_label AS "itemLabel", status, note FROM inspection_checklists WHERE inspection_id = $1 AND status != 'OK'`,
        [row.inspectionId],
      );
      damagedChecklist = checklistRows.map((c) => ({
        ...c,
        itemLabel: PART_TYPE_VIETNAMESE[c.itemKey] || c.itemLabel || c.itemKey,
      }));

      const lineItemsRows = await AppDataSource.query<any[]>(
        `SELECT part_type AS "partType", custom_part_name AS "customPartName", parts_price AS "partsPrice", labor_price AS "laborPrice" FROM damage_line_items WHERE inspection_id = $1 AND deleted_at IS NULL`,
        [row.inspectionId],
      );
      damageLineItems = lineItemsRows;

      const [insp] = await AppDataSource.query<{ damage_description: string }[]>(
        `SELECT damage_description FROM inspections WHERE id = $1`,
        [row.inspectionId],
      );
      if (insp?.damage_description) {
        inspectionNote = insp.damage_description;
      }
    }

    let issueDescription = row.issueDescription;
    if (damagedChecklist.length > 0 || damageLineItems.length > 0 || inspectionNote) {
      const partsSummary = [
        ...damagedChecklist.map(
          (c) =>
            `${PART_TYPE_VIETNAMESE[c.itemKey] || c.itemLabel || c.itemKey} (${c.status === 'BROKEN' ? 'Hỏng nặng' : c.status === 'SCRATCHED' ? 'Trầy xước' : c.status}${c.note ? `: ${c.note}` : ''})`,
        ),
        ...damageLineItems.map(
          (l) => `${l.customPartName || PART_TYPE_VIETNAMESE[l.partType] || l.partType}`,
        ),
      ].join(', ');

      issueDescription = `[Ghi nhận hư hỏng từ Check-out của Staff] Linh kiện hư hại: ${partsSummary || inspectionNote || 'Ghi nhận hư hỏng sau phiên Check-out.'}`;
    }

    const mergedChecklist = [
      ...damagedChecklist,
      ...damageLineItems.map((l) => {
        const partsText =
          l.partsPrice > 0
            ? `Phạt đền bù linh kiện: ${Number(l.partsPrice).toLocaleString('vi-VN')} đ`
            : '';
        const laborText =
          l.laborPrice > 0 ? `Phí công sửa: ${Number(l.laborPrice).toLocaleString('vi-VN')} đ` : '';
        const noteText = [partsText, laborText].filter(Boolean).join(' | ');

        return {
          itemKey: l.partType,
          itemLabel: l.customPartName || PART_TYPE_VIETNAMESE[l.partType] || l.partType,
          status: 'BROKEN',
          note: noteText,
        };
      }),
    ];

    result.push({
      logId: row.logId,
      logCode: `MNT-${row.logId.substring(0, 4).toUpperCase()}`,
      vehicleId: row.vehicleId,
      vehicleIdentifier: row.vehicleIdentifier,
      vehicleName: row.categoryName
        ? `${row.categoryName} (${row.vehicleIdentifier})`
        : row.vehicleIdentifier,
      vehicleImageUrl: row.vehicleImageUrl,
      cafeId: row.cafeId,
      cafeName: row.cafeName,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryTier: row.categoryTier,
      issueDescription,
      staffNotes: inspectionNote || null,
      cost: Number(row.cost || 0),
      performedBy: row.performedBy,
      status: row.status as any,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      completedAt: row.status === 'COMPLETED' ? new Date().toISOString() : null,
      inspectionPhotos: photos,
      damagedChecklist: mergedChecklist,
    });
  }

  return result;
}

export async function createMaintenanceLog(
  staffId: string,
  cafeId: string,
  body: {
    vehicleId: string;
    issueDescription: string;
    cost?: number;
    performedBy?: string;
    staffNotes?: string;
  },
): Promise<any> {
  const { vehicleId, issueDescription, cost = 0, performedBy } = body;

  await AppDataSource.query(
    `ALTER TABLE vehicle_maintenance_logs ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'SENT_TO_PROVIDER'`,
  );

  const [vehicle] = await AppDataSource.query<{ id: string; cafe_id: string }[]>(
    `SELECT id, cafe_id FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
    [vehicleId],
  );

  if (!vehicle) {
    throw new AppError('Xe không tồn tại', 404, 'VEHICLE_NOT_FOUND');
  }

  const result = await AppDataSource.transaction(async (manager) => {
    await manager.query(
      `UPDATE vehicles SET status = 'MAINTENANCE', updated_at = NOW() WHERE id = $1`,
      [vehicleId],
    );

    const [log] = await manager.query<{ id: string; created_at: Date }[]>(
      `INSERT INTO vehicle_maintenance_logs (vehicle_id, type, description, cost, performed_by, status, performed_at)
       VALUES ($1, 'REPAIR', $2, $3, $4, 'PENDING_REPAIR', NOW())
       RETURNING id, created_at`,
      [vehicleId, issueDescription, cost, staffId],
    );

    return {
      logId: log.id,
      vehicleId,
      issueDescription,
      cost,
      performedBy: performedBy || 'Staff',
      status: 'PENDING_REPAIR',
      createdAt: log.created_at.toISOString(),
    };
  });

  try {
    wsService.pushToCafe(cafeId, 'VEHICLE_MAINTENANCE_CREATED', {
      logId: result.logId,
      vehicleId,
      issueDescription,
      route: '/staff/maintenance',
    });
  } catch (err) {
    logger.error('Staff', 'Failed to broadcast VEHICLE_MAINTENANCE_CREATED', err);
  }

  return result;
}

export async function updateMaintenanceStatus(
  staffId: string,
  logId: string,
  body: {
    status: 'SENT_TO_PROVIDER' | 'PENDING_REPAIR' | 'RECEIVED' | 'COMPLETED';
    cost?: number;
    staffNotes?: string;
  },
): Promise<any> {
  const { status, cost } = body;

  await AppDataSource.query(
    `ALTER TABLE vehicle_maintenance_logs ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'SENT_TO_PROVIDER'`,
  );

  const [log] = await AppDataSource.query<{ id: string; vehicle_id: string }[]>(
    `SELECT id, vehicle_id FROM vehicle_maintenance_logs WHERE id::text = $1 OR vehicle_id::text = $1`,
    [logId],
  );

  const targetVehicleId = log ? log.vehicle_id : logId;

  await AppDataSource.transaction(async (manager) => {
    if (log) {
      let costUpdate = '';
      const params: any[] = [status, staffId, log.id];
      if (cost !== undefined) {
        params.push(cost);
        costUpdate = `, cost = $${params.length}`;
      }
      await manager.query(
        `UPDATE vehicle_maintenance_logs SET status = $1, performed_by = $2 ${costUpdate} WHERE id = $3`,
        params,
      );
      await manager.query(
        `UPDATE vehicle_maintenance_logs SET status = $1, performed_by = $2 WHERE vehicle_id = $3 AND status != 'COMPLETED'`,
        [status, staffId, targetVehicleId],
      );
    } else {
      await manager.query(
        `INSERT INTO vehicle_maintenance_logs (vehicle_id, type, description, cost, performed_by, status, performed_at)
         VALUES ($1, 'REPAIR', 'Xe ghi nhận bảo trì từ hệ thống', $2, $3, $4, NOW())`,
        [targetVehicleId, cost || 0, staffId, status],
      );
    }

    if (status === 'COMPLETED') {
      await manager.query(
        `UPDATE vehicles SET status = 'AVAILABLE', last_maintenance_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [targetVehicleId],
      );

      const [vehInfo] = await manager.query<
        {
          vehicleIdentifier: string;
          categoryName: string | null;
          cafeName: string;
          providerId: string;
        }[]
      >(
        `SELECT v.identifier AS "vehicleIdentifier", vc.name AS "categoryName", c.name AS "cafeName", c.provider_id AS "providerId"
         FROM vehicles v
         JOIN cafes c ON v.cafe_id = c.id
         LEFT JOIN vehicle_catalogs vc ON v.catalog_id = vc.id
         WHERE v.id = $1`,
        [targetVehicleId],
      );

      if (vehInfo && vehInfo.providerId) {
        const vehicleName = vehInfo.categoryName
          ? `${vehInfo.categoryName} (${vehInfo.vehicleIdentifier})`
          : vehInfo.vehicleIdentifier;

        const notifTitle = 'Bảo trì xe thành công';
        const notifMessage = `Xe ${vehicleName} thuộc cơ sở ${vehInfo.cafeName} đã được bảo trì thành công.`;

        try {
          await createNotification(
            vehInfo.providerId,
            NotificationType.SYSTEM,
            notifTitle,
            notifMessage,
            {
              vehicleId: targetVehicleId,
              vehicleName,
              cafeName: vehInfo.cafeName,
              status: 'COMPLETED',
              route: '/provider/cafe-vehicles',
            },
          );

          wsService.pushToUser(vehInfo.providerId, 'MAINTENANCE_COMPLETED_NOTIFICATION', {
            title: notifTitle,
            message: notifMessage,
            vehicleName,
            cafeName: vehInfo.cafeName,
            vehicleId: targetVehicleId,
            route: '/provider/cafe-vehicles',
          });
          // Realtime cập nhật trạng thái xe về AVAILABLE cho provider
          wsService.pushToUser(vehInfo.providerId, 'VEHICLE_STATUS_CHANGED', {
            vehicleId: targetVehicleId,
            identifier: vehInfo.vehicleIdentifier,
            status: 'AVAILABLE',
          });
        } catch (err) {
          logger.error(
            'Staff',
            'Failed to create provider maintenance completion notification',
            err,
          );
        }
      }
    } else {
      await manager.query(
        `UPDATE vehicles SET status = 'MAINTENANCE', updated_at = NOW() WHERE id = $1`,
        [targetVehicleId],
      );

      if (status === 'RECEIVED') {
        const [vehInfo] = await manager.query<
          {
            vehicleIdentifier: string;
            categoryName: string | null;
            cafeName: string;
            providerId: string;
          }[]
        >(
          `SELECT v.identifier AS "vehicleIdentifier", vc.name AS "categoryName", c.name AS "cafeName", c.provider_id AS "providerId"
           FROM vehicles v
           JOIN cafes c ON v.cafe_id = c.id
           LEFT JOIN vehicle_catalogs vc ON v.catalog_id = vc.id
           WHERE v.id = $1`,
          [targetVehicleId],
        );

        if (vehInfo && vehInfo.providerId) {
          const vehicleName = vehInfo.categoryName
            ? `${vehInfo.categoryName} (${vehInfo.vehicleIdentifier})`
            : vehInfo.vehicleIdentifier;

          const notifTitle = 'Đã nhận xe bảo trì';
          const notifMessage = `Xe ${vehicleName} thuộc cơ sở ${vehInfo.cafeName} đã được nhận để tiến hành sửa chữa.`;

          try {
            await createNotification(
              vehInfo.providerId,
              NotificationType.SYSTEM,
              notifTitle,
              notifMessage,
              {
                vehicleId: targetVehicleId,
                vehicleName,
                cafeName: vehInfo.cafeName,
                status: 'RECEIVED',
                route: '/provider/cafe-vehicles',
              },
            );

            wsService.pushToUser(vehInfo.providerId, 'MAINTENANCE_LOG_UPDATED', {
              title: notifTitle,
              message: notifMessage,
              vehicleName,
              cafeName: vehInfo.cafeName,
              vehicleId: targetVehicleId,
              route: '/provider/cafe-vehicles',
            });
          } catch (err) {
            logger.error(
              'Staff',
              'Failed to create provider maintenance received notification',
              err,
            );
          }
        }
      }
    }
  });

  try {
    const [veh] = await AppDataSource.query<{ cafe_id: string }[]>(
      `SELECT cafe_id FROM vehicles WHERE id = $1`,
      [targetVehicleId],
    );
    if (veh?.cafe_id) {
      wsService.pushToCafe(veh.cafe_id, 'MAINTENANCE_LOG_UPDATED', {
        logId,
        status,
        route: '/staff/maintenance',
      });
    }
  } catch (err) {
    logger.error('Staff', 'Failed to broadcast MAINTENANCE_LOG_UPDATED', err);
  }

  return { success: true, logId, status };
}

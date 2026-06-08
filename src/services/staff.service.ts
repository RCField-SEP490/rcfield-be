import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { AppError, AuthProvider, UserRole } from '../types';
import { User } from '../models/user.entity';
import { StaffInviteToken } from '../models/staff-invite-token.entity';
import { emailService } from './email.service';
import { authService } from './auth.service';
import { env } from '../config/env';

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
  status: string;
  mode: string;
  vehicleName: string | null;
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

export async function getTodayBookings(cafeId: string): Promise<TodayBookingItem[]> {
  const rows = await AppDataSource.query<
    {
      id: string;
      customer_name: string;
      customer_phone: string | null;
      slot_start: Date;
      slot_end: Date;
      status: string;
      mode: string;
      vehicle_name: string | null;
    }[]
  >(
    `SELECT
       b.id,
       u.full_name  AS customer_name,
       u.phone      AS customer_phone,
       b.slot_start,
       b.slot_end,
       b.status,
       b.mode,
       v.name       AS vehicle_name
     FROM bookings b
     JOIN users u ON u.id = b.customer_id
     LEFT JOIN vehicles v ON v.id = b.vehicle_id
     WHERE b.cafe_id = $1
       AND b.slot_start::date = (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
       AND b.status IN ('CONFIRMED', 'ACTIVE', 'EXTENDING', 'CHECKING_OUT')
     ORDER BY b.slot_start ASC`,
    [cafeId],
  );

  return rows.map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    startTime: row.slot_start.toISOString(),
    endTime: row.slot_end.toISOString(),
    status: row.status,
    mode: row.mode,
    vehicleName: row.vehicle_name,
  }));
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

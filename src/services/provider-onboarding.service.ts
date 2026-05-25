import * as bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database';
import { User } from '../models/user.entity';
import { ProviderProfile } from '../models/provider-profile.entity';
import { AppError, AuthProvider, NotificationType, ProviderStatus, UserRole } from '../types';
import { createNotification } from './notification.service';
import { createTrial } from './subscription.service';

interface RegisterBody {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  business_name: string;
  business_description?: string;
}

const PROVIDER_STATUS_TRANSITIONS: Record<ProviderStatus, ProviderStatus[]> = {
  [ProviderStatus.PENDING]: [ProviderStatus.ACTIVE, ProviderStatus.REJECTED],
  [ProviderStatus.ACTIVE]: [ProviderStatus.SUSPENDED],
  [ProviderStatus.SUSPENDED]: [ProviderStatus.ACTIVE],
  [ProviderStatus.REJECTED]: [],
};

async function getProfileOrThrow(providerId: string): Promise<ProviderProfile> {
  const profile = await AppDataSource.getRepository(ProviderProfile).findOne({
    where: { userId: providerId },
  });
  if (!profile) throw new AppError('Provider không tồn tại', 404, 'NOT_FOUND');
  return profile;
}

function assertTransition(profile: ProviderProfile, to: ProviderStatus): void {
  const allowed = PROVIDER_STATUS_TRANSITIONS[profile.registrationStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      `Không thể chuyển trạng thái từ ${profile.registrationStatus} sang ${to}`,
      400,
      'INVALID_STATUS_TRANSITION',
    );
  }
}

export async function register(body: RegisterBody): Promise<User> {
  const userRepo = AppDataSource.getRepository(User);

  const existing = await userRepo.findOne({ where: { email: body.email } });
  if (existing) throw new AppError('Email đã được sử dụng', 409, 'EMAIL_EXISTS');

  return AppDataSource.transaction(async (manager) => {
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await manager.save(
      manager.create(User, {
        email: body.email,
        full_name: body.full_name,
        phone: body.phone ?? null,
        password_hash: passwordHash,
        auth_provider: AuthProvider.LOCAL,
        role: UserRole.PROVIDER,
      }),
    );
    await manager.save(
      manager.create(ProviderProfile, {
        userId: user.id,
        businessName: body.business_name,
        businessDescription: body.business_description ?? null,
        registrationStatus: ProviderStatus.PENDING,
      }),
    );
    return user;
  });
}

export async function approve(providerId: string, _adminId: string): Promise<void> {
  const profile = await getProfileOrThrow(providerId);
  assertTransition(profile, ProviderStatus.ACTIVE);

  await AppDataSource.transaction(async (manager) => {
    profile.registrationStatus = ProviderStatus.ACTIVE;
    await manager.save(profile);
    await createTrial(providerId);
  });

  await createNotification(
    providerId,
    NotificationType.ACCOUNT_APPROVED,
    'Tài khoản đã được duyệt',
    'Chào mừng bạn đến với RCField! Gói dùng thử 30 ngày đã được kích hoạt.',
  );
}

export async function reject(providerId: string, _adminId: string, reason: string): Promise<void> {
  const profile = await getProfileOrThrow(providerId);
  assertTransition(profile, ProviderStatus.REJECTED);

  profile.registrationStatus = ProviderStatus.REJECTED;
  profile.rejectionReason = reason;
  await AppDataSource.getRepository(ProviderProfile).save(profile);

  await createNotification(
    providerId,
    NotificationType.ACCOUNT_REJECTED,
    'Đăng ký tài khoản bị từ chối',
    `Lý do: ${reason}`,
  );
}

export async function suspend(providerId: string, _adminId: string, reason: string): Promise<void> {
  const profile = await getProfileOrThrow(providerId);
  assertTransition(profile, ProviderStatus.SUSPENDED);

  profile.registrationStatus = ProviderStatus.SUSPENDED;
  profile.suspendedAt = new Date();
  profile.suspendedReason = reason;
  await AppDataSource.getRepository(ProviderProfile).save(profile);

  await createNotification(
    providerId,
    NotificationType.ACCOUNT_SUSPENDED,
    'Tài khoản bị tạm khóa',
    `Lý do: ${reason}. Vui lòng liên hệ admin để được hỗ trợ.`,
  );
}

export async function unsuspend(providerId: string, _adminId: string): Promise<void> {
  const profile = await getProfileOrThrow(providerId);
  assertTransition(profile, ProviderStatus.ACTIVE);

  profile.registrationStatus = ProviderStatus.ACTIVE;
  profile.suspendedAt = null;
  profile.suspendedReason = null;
  await AppDataSource.getRepository(ProviderProfile).save(profile);

  await createNotification(
    providerId,
    NotificationType.ACCOUNT_UNSUSPENDED,
    'Tài khoản đã được mở khóa',
    'Tài khoản của bạn đã được khôi phục. Chào mừng trở lại!',
  );
}

export async function listProviders(options: {
  status?: ProviderStatus;
  page: number;
  limit: number;
}): Promise<{ data: unknown[]; total: number }> {
  const { status, page, limit } = options;

  let query = `
    SELECT
      u.id, u.email, u.full_name, u.created_at,
      pp.business_name, pp.registration_status,
      sp_name.name as plan_name,
      ps.status as subscription_status,
      ps.expires_at
    FROM users u
    JOIN provider_profiles pp ON pp.user_id = u.id
    LEFT JOIN provider_subscriptions ps ON ps.provider_id = u.id
      AND ps.deleted_at IS NULL
      AND ps.status != 'EXPIRED'
    LEFT JOIN subscription_plans sp_name ON sp_name.id = ps.plan_id
    WHERE u.role = 'PROVIDER'
      AND u.deleted_at IS NULL
      AND pp.deleted_at IS NULL
  `;
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    query += ` AND pp.registration_status = $${params.length}`;
  }

  const countResult = await AppDataSource.query<[{ count: string }]>(
    `SELECT COUNT(*) as count FROM (${query}) t`,
    params,
  );
  const total = parseInt(countResult[0]?.count ?? '0', 10);

  params.push(limit, (page - 1) * limit);
  query += ` ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const data = await AppDataSource.query(query, params);
  return { data, total };
}

export async function getProviderDetail(providerId: string): Promise<unknown> {
  const rows = await AppDataSource.query(
    `SELECT
      u.id, u.email, u.full_name, u.phone, u.created_at,
      pp.business_name, pp.business_description, pp.registration_status,
      pp.rejection_reason, pp.suspended_at, pp.suspended_reason,
      sp_name.name as plan_name,
      ps.status as subscription_status,
      ps.started_at, ps.expires_at, ps.grace_ends_at, ps.ai_messages_used,
      sp_name.ai_quota_per_month, sp_name.branch_limit, sp_name.channel_limit
    FROM users u
    JOIN provider_profiles pp ON pp.user_id = u.id
    LEFT JOIN provider_subscriptions ps ON ps.provider_id = u.id
      AND ps.deleted_at IS NULL AND ps.status != 'EXPIRED'
    LEFT JOIN subscription_plans sp_name ON sp_name.id = ps.plan_id
    WHERE u.id = $1`,
    [providerId],
  );
  if (!rows.length) throw new AppError('Provider không tồn tại', 404, 'NOT_FOUND');
  return rows[0];
}

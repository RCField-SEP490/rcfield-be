import { AppDataSource } from '../config/database';
import { ProviderSubscription } from '../models/provider-subscription.entity';
import { SubscriptionPlan } from '../models/subscription-plan.entity';
import { AppError, NotificationType, PlanName, SubscriptionStatus } from '../types';
import { createNotification } from './notification.service';
import { logger } from '../config/logger';

const GRACE_PERIOD_DAYS = 7;

const VALID_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  [SubscriptionStatus.TRIAL]: [SubscriptionStatus.GRACE_PERIOD, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.ACTIVE]: [SubscriptionStatus.GRACE_PERIOD],
  [SubscriptionStatus.GRACE_PERIOD]: [SubscriptionStatus.EXPIRED, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.EXPIRED]: [SubscriptionStatus.ACTIVE],
};

const TRANSITION_NOTIFICATION: Partial<Record<SubscriptionStatus, NotificationType>> = {
  [SubscriptionStatus.GRACE_PERIOD]: NotificationType.GRACE_PERIOD_STARTED,
  [SubscriptionStatus.EXPIRED]: NotificationType.SUBSCRIPTION_EXPIRED,
  [SubscriptionStatus.ACTIVE]: NotificationType.SUBSCRIPTION_ACTIVATED,
};

export async function getActive(
  providerId: string,
): Promise<(ProviderSubscription & { plan: SubscriptionPlan }) | null> {
  const repo = AppDataSource.getRepository(ProviderSubscription);
  const sub = await repo
    .createQueryBuilder('ps')
    .innerJoinAndMapOne('ps.plan', SubscriptionPlan, 'sp', 'sp.id = ps.plan_id')
    .where('ps.provider_id = :providerId', { providerId })
    .andWhere('ps.status != :expired', { expired: SubscriptionStatus.EXPIRED })
    .andWhere('ps.deleted_at IS NULL')
    .orderBy('ps.created_at', 'DESC')
    .getOne();

  return sub as (ProviderSubscription & { plan: SubscriptionPlan }) | null;
}

export async function createTrial(providerId: string): Promise<ProviderSubscription> {
  const repo = AppDataSource.getRepository(ProviderSubscription);
  const planRepo = AppDataSource.getRepository(SubscriptionPlan);

  const trialPlan = await planRepo.findOne({ where: { name: PlanName.TRIAL } });
  if (!trialPlan) throw new AppError('Trial plan not found', 500, 'TRIAL_PLAN_MISSING');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const sub = repo.create({
    providerId,
    planId: trialPlan.id,
    status: SubscriptionStatus.TRIAL,
    startedAt: now,
    expiresAt,
    aiQuotaResetAt: nextMonth,
  });

  return repo.save(sub);
}

export async function transition(
  subscriptionId: string,
  toStatus: SubscriptionStatus,
): Promise<ProviderSubscription> {
  const repo = AppDataSource.getRepository(ProviderSubscription);
  const sub = await repo.findOne({ where: { id: subscriptionId } });
  if (!sub) throw new AppError('Subscription not found', 404, 'NOT_FOUND');

  const allowed = VALID_TRANSITIONS[sub.status] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new AppError(
      `Invalid transition: ${sub.status} → ${toStatus}`,
      400,
      'INVALID_SUBSCRIPTION_STATE',
    );
  }

  sub.status = toStatus;
  if (toStatus === SubscriptionStatus.GRACE_PERIOD) {
    const graceEnd = new Date(sub.expiresAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    sub.graceEndsAt = graceEnd;
  }

  await repo.save(sub);

  const notifType = TRANSITION_NOTIFICATION[toStatus];
  if (notifType) {
    const messages: Record<NotificationType, [string, string]> = {
      [NotificationType.GRACE_PERIOD_STARTED]: [
        'Thời gian dùng thử đã hết',
        `Bạn có ${GRACE_PERIOD_DAYS} ngày để đăng ký gói để tiếp tục sử dụng.`,
      ],
      [NotificationType.SUBSCRIPTION_EXPIRED]: [
        'Gói đăng ký đã hết hạn',
        'Chi nhánh của bạn đã bị tạm ẩn. Vui lòng gia hạn để khôi phục.',
      ],
      [NotificationType.SUBSCRIPTION_ACTIVATED]: [
        'Gói đăng ký đã được kích hoạt',
        'Tài khoản của bạn đã được kích hoạt thành công.',
      ],
      [NotificationType.ACCOUNT_APPROVED]: ['', ''],
      [NotificationType.ACCOUNT_REJECTED]: ['', ''],
      [NotificationType.ACCOUNT_SUSPENDED]: ['', ''],
      [NotificationType.ACCOUNT_UNSUSPENDED]: ['', ''],
      [NotificationType.TRIAL_EXPIRING_SOON]: ['', ''],
      [NotificationType.PAYMENT_REQUEST_CONFIRMED]: ['', ''],
      [NotificationType.PAYMENT_REQUEST_REJECTED]: ['', ''],
      [NotificationType.SESSION_CHECKIN_INSPECTION]: ['', ''],
      [NotificationType.SESSION_CHECKOUT_INSPECTION]: ['', ''],
      [NotificationType.SESSION_EXTENSION_PROPOSED]: ['', ''],
      [NotificationType.SESSION_FNB_ORDER_ADDED]: ['', ''],
      [NotificationType.CUSTOMER_CHECKIN_CONFIRMED]: ['', ''],
      [NotificationType.CUSTOMER_CHECKOUT_CONFIRMED]: ['', ''],
      [NotificationType.CUSTOMER_INSPECTION_DISPUTED]: ['', ''],
      [NotificationType.CUSTOMER_EXTENSION_APPROVED]: ['', ''],
      [NotificationType.CUSTOMER_EXTENSION_REJECTED]: ['', ''],
      [NotificationType.CUSTOMER_PAYMENT_CONFIRMED]: ['', ''],
    };
    const [title, message] = messages[notifType];
    if (title) await createNotification(sub.providerId, notifType, title, message);
  }

  return sub;
}

export async function activateFromPayment(
  providerId: string,
  planId: string,
): Promise<ProviderSubscription> {
  const repo = AppDataSource.getRepository(ProviderSubscription);

  const existing = await repo
    .createQueryBuilder('ps')
    .where('ps.provider_id = :providerId', { providerId })
    .andWhere('ps.deleted_at IS NULL')
    .orderBy('ps.created_at', 'DESC')
    .getOne();

  const now = new Date();
  const baseDate = existing && existing.expiresAt > now ? existing.expiresAt : now;
  const newExpiresAt = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  if (existing && existing.status !== SubscriptionStatus.EXPIRED) {
    existing.planId = planId;
    existing.expiresAt = newExpiresAt;
    existing.aiMessagesUsed = 0;
    existing.aiQuotaResetAt = nextMonth;
    existing.graceEndsAt = null;
    await repo.save(existing);
    if (existing.status !== SubscriptionStatus.ACTIVE) {
      await transition(existing.id, SubscriptionStatus.ACTIVE);
    }
    return existing;
  }

  const sub = repo.create({
    providerId,
    planId,
    status: SubscriptionStatus.ACTIVE,
    startedAt: now,
    expiresAt: newExpiresAt,
    aiQuotaResetAt: nextMonth,
  });
  return repo.save(sub);
}

export async function checkBranchQuota(providerId: string): Promise<void> {
  const sub = await getActive(providerId);
  if (!sub)
    throw new AppError('Không có gói đăng ký đang hoạt động', 403, 'NO_ACTIVE_SUBSCRIPTION');

  const plan = sub.plan as SubscriptionPlan;
  if (plan.branchLimit === -1) return;

  const branchCount = await AppDataSource.query<[{ count: string }]>(
    `SELECT COUNT(*) as count FROM cafes WHERE provider_id = $1 AND deleted_at IS NULL`,
    [providerId],
  );
  const count = parseInt(branchCount[0]?.count ?? '0', 10);
  if (count >= plan.branchLimit) {
    throw new AppError(
      `Gói ${plan.name} chỉ cho phép tối đa ${plan.branchLimit} chi nhánh`,
      403,
      'PLAN_LIMIT_EXCEEDED',
    );
  }
}

export async function checkChannelQuota(providerId: string): Promise<void> {
  const sub = await getActive(providerId);
  if (!sub)
    throw new AppError('Không có gói đăng ký đang hoạt động', 403, 'NO_ACTIVE_SUBSCRIPTION');

  const plan = sub.plan as SubscriptionPlan;
  if (plan.channelLimit === -1) return;

  const channelCount = await AppDataSource.query<[{ count: string }]>(
    `SELECT COUNT(*) as count
     FROM cafe_channels cc
     JOIN cafes c ON c.id = cc.cafe_id
     WHERE c.provider_id = $1 AND cc.status = 'CONNECTED' AND cc.deleted_at IS NULL`,
    [providerId],
  );
  const count = parseInt(channelCount[0]?.count ?? '0', 10);
  if (count >= plan.channelLimit) {
    throw new AppError(
      `Gói ${plan.name} chỉ cho phép tối đa ${plan.channelLimit} kênh kết nối`,
      403,
      'PLAN_LIMIT_EXCEEDED',
    );
  }
}

export async function incrementAIQuota(providerId: string): Promise<void> {
  const before = await AppDataSource.query<{ used: number; quota: number; status: string }[]>(
    `SELECT ps.ai_messages_used as used, sp.ai_quota_per_month as quota, ps.status
     FROM provider_subscriptions ps
     JOIN subscription_plans sp ON sp.id = ps.plan_id
     WHERE ps.provider_id = $1 AND ps.deleted_at IS NULL
       AND ps.status IN ('TRIAL', 'ACTIVE', 'GRACE_PERIOD')`,
    [providerId],
  );
  logger.info('AIQuota', 'before increment', {
    providerId,
    used: before[0]?.used ?? 'no_sub',
    quota: before[0]?.quota ?? 'no_sub',
    status: before[0]?.status ?? 'no_sub',
  });

  // TypeORM returns [rows[], rowCount] for UPDATE queries — use result[0] to get actual rows
  const raw = await AppDataSource.query(
    `UPDATE provider_subscriptions
     SET ai_messages_used = ai_messages_used + 1, updated_at = NOW()
     WHERE provider_id = $1
       AND deleted_at IS NULL
       AND status IN ('TRIAL', 'ACTIVE', 'GRACE_PERIOD')
       AND (
         (SELECT ai_quota_per_month FROM subscription_plans WHERE id = plan_id) = -1
         OR ai_messages_used < (SELECT ai_quota_per_month FROM subscription_plans WHERE id = plan_id)
       )
     RETURNING id`,
    [providerId],
  );
  const returnedRows: { id: string }[] = Array.isArray(raw[0]) ? raw[0] : raw;

  if (!returnedRows.length) {
    logger.warn('AIQuota', 'AI_QUOTA_EXCEEDED', { providerId });
    throw new AppError('AI quota đã đạt giới hạn tháng này', 429, 'AI_QUOTA_EXCEEDED');
  }
  logger.info('AIQuota', 'increment ok', {
    providerId,
    used: (before[0]?.used ?? 0) + 1,
    quota: before[0]?.quota,
  });
}

import cron from 'node-cron';
import { AppDataSource } from '../config/database';
import { ProviderSubscription } from '../models/provider-subscription.entity';
import { NotificationType, SubscriptionStatus } from '../types';
import { transition } from '../services/subscription.service';
import { createNotification } from '../services/notification.service';
import { logger } from '../config/logger';

async function processExpiredSubscriptions(): Promise<void> {
  const repo = AppDataSource.getRepository(ProviderSubscription);
  const expired = await repo
    .createQueryBuilder('ps')
    .where('ps.expires_at <= NOW()')
    .andWhere('ps.status IN (:...statuses)', {
      statuses: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE],
    })
    .andWhere('ps.deleted_at IS NULL')
    .getMany();

  for (const sub of expired) {
    try {
      await transition(sub.id, SubscriptionStatus.GRACE_PERIOD);
      logger.info('SubscriptionLifecycle', `→ GRACE_PERIOD sub=${sub.id}`);
    } catch (err) {
      logger.error('SubscriptionLifecycle', `transition failed sub=${sub.id}`, err);
    }
  }
}

async function processExpiredGracePeriods(): Promise<void> {
  const repo = AppDataSource.getRepository(ProviderSubscription);
  const graceExpired = await repo
    .createQueryBuilder('ps')
    .where('ps.grace_ends_at <= NOW()')
    .andWhere('ps.status = :status', { status: SubscriptionStatus.GRACE_PERIOD })
    .andWhere('ps.deleted_at IS NULL')
    .getMany();

  for (const sub of graceExpired) {
    try {
      await transition(sub.id, SubscriptionStatus.EXPIRED);
      await AppDataSource.query(
        `UPDATE cafes SET deleted_at = NOW(), updated_at = NOW()
         WHERE provider_id = $1 AND deleted_at IS NULL`,
        [sub.providerId],
      );
      logger.info(
        'SubscriptionLifecycle',
        `→ EXPIRED, cafes soft-deleted provId=${sub.providerId}`,
      );
    } catch (err) {
      logger.error('SubscriptionLifecycle', `grace expiry failed sub=${sub.id}`, err);
    }
  }
}

async function sendExpiryWarnings(): Promise<void> {
  const subs = await AppDataSource.query<ProviderSubscription[]>(
    `SELECT ps.id, ps.provider_id, ps.expires_at
     FROM provider_subscriptions ps
     WHERE ps.status = 'TRIAL'
       AND ps.deleted_at IS NULL
       AND ps.expires_at <= NOW() + INTERVAL '3 days'
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id = ps.provider_id
           AND n.type = $1
           AND n.created_at > NOW() - INTERVAL '7 days'
       )`,
    [NotificationType.TRIAL_EXPIRING_SOON],
  );

  for (const sub of subs) {
    try {
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (new Date((sub as unknown as { expires_at: string }).expires_at).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      await createNotification(
        (sub as unknown as { provider_id: string }).provider_id,
        NotificationType.TRIAL_EXPIRING_SOON,
        'Gói dùng thử sắp hết hạn',
        `Gói dùng thử của bạn sẽ hết hạn sau ${daysLeft} ngày. Hãy đăng ký gói để tiếp tục sử dụng.`,
      );
      logger.info(
        'SubscriptionLifecycle',
        `expiry warning sent provId=${(sub as unknown as { provider_id: string }).provider_id}`,
      );
    } catch (err) {
      logger.error('SubscriptionLifecycle', 'expiry warning failed', err);
    }
  }
}

async function resetMonthlyAIQuotas(): Promise<void> {
  const result = await AppDataSource.query<{ count: string }[]>(
    `UPDATE provider_subscriptions
     SET ai_messages_used = 0,
         ai_quota_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
         updated_at = NOW()
     WHERE status IN ('TRIAL', 'ACTIVE', 'GRACE_PERIOD')
       AND deleted_at IS NULL
       AND ai_quota_reset_at <= NOW()
     RETURNING id`,
  );
  if (result.length) {
    logger.info('SubscriptionLifecycle', `AI quota reset for ${result.length} subscription(s)`);
  }
}

export function startSubscriptionLifecycleJobs(): void {
  cron.schedule('5 0 * * *', async () => {
    logger.info('SubscriptionLifecycle', 'Running daily lifecycle check');
    await processExpiredSubscriptions();
    await processExpiredGracePeriods();
    await sendExpiryWarnings();
    await resetMonthlyAIQuotas();
  });

  logger.info('SubscriptionLifecycle', 'Cron scheduled — Runs daily at 00:05');
}

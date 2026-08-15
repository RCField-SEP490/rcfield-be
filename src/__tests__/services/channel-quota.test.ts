import { AppDataSource } from '../../config/database';
import { checkChannelQuota } from '../../services/subscription.service';
import { ChannelStatus, ChannelType, SubscriptionStatus, UserRole } from '../../types';
import { createTestCafe, createTestUser } from '../helpers';

/**
 * Trên production, gọi lại Facebook OAuth chết ở đây:
 *
 *   operator does not exist: uuid = character varying
 *
 * `cafe_channels.cafe_id` được tạo ra là `varchar` trong khi `cafes.id` là
 * `uuid`, nên câu JOIN đếm hạn mức kênh không chạy nổi. Test này gọi thẳng
 * `checkChannelQuota` với dữ liệu thật để lỗi đó lộ ra ở CI thay vì ở người
 * dùng.
 */
async function seedProviderOnPlan(planName: string) {
  const provider = await createTestUser({ role: UserRole.PROVIDER });

  const [plan] = await AppDataSource.query<{ id: string; channel_limit: number }[]>(
    `SELECT id, channel_limit FROM subscription_plans WHERE name = $1`,
    [planName],
  );

  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await AppDataSource.query(
    `INSERT INTO provider_subscriptions
       (provider_id, plan_id, status, started_at, expires_at, ai_quota_reset_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [provider.id, plan.id, SubscriptionStatus.ACTIVE, now, expires],
  );

  return { provider, plan };
}

let pageCounter = 0;

async function connectChannel(
  cafeId: string,
  options: { status?: ChannelStatus; softDeleted?: boolean } = {},
) {
  const { status = ChannelStatus.CONNECTED, softDeleted = false } = options;
  pageCounter += 1;

  await AppDataSource.query(
    `INSERT INTO cafe_channels
       (cafe_id, channel_type, status, page_id, page_name, encrypted_page_token,
        connected_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, 'enc-token', now(), $6)`,
    [
      cafeId,
      ChannelType.FACEBOOK_MESSENGER,
      status,
      `page-${pageCounter}`,
      `Trang ${pageCounter}`,
      softDeleted ? new Date() : null,
    ],
  );
}

describe('checkChannelQuota', () => {
  it('đếm được kênh đã kết nối mà không vỡ vì lệch kiểu cột', async () => {
    const { provider } = await seedProviderOnPlan('GROWTH');
    const cafe = await createTestCafe({ provider_id: provider.id });
    await connectChannel(cafe.id);

    // GROWTH cho 3 kênh, mới nối 1 — phải qua được, và quan trọng hơn là câu
    // JOIN phải chạy được.
    await expect(checkChannelQuota(provider.id)).resolves.toBeUndefined();
  });

  it('chặn khi đã dùng hết số kênh của gói', async () => {
    const { provider } = await seedProviderOnPlan('STARTER');
    const cafe = await createTestCafe({ provider_id: provider.id });
    await connectChannel(cafe.id);

    await expect(checkChannelQuota(provider.id)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_EXCEEDED',
      statusCode: 403,
    });
  });

  it('kênh đã ngắt hoặc đã xoá mềm không tính vào hạn mức', async () => {
    const { provider } = await seedProviderOnPlan('STARTER');
    const cafe = await createTestCafe({ provider_id: provider.id });
    await connectChannel(cafe.id, { status: ChannelStatus.DISCONNECTED });
    await connectChannel(cafe.id, { softDeleted: true });

    // Hai dòng trên đều không còn hiệu lực, chỗ trống của gói STARTER vẫn còn.
    await expect(checkChannelQuota(provider.id)).resolves.toBeUndefined();
  });
});

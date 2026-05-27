import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { CafeStatus, ProviderStatus, SubscriptionStatus, UserRole } from '../../types';
import { createTestCafe, createTestUser, generateToken } from '../helpers';

async function activateProvider(providerId: string): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO provider_profiles
       (user_id, business_name, registration_status)
     VALUES ($1, $2, $3)`,
    [providerId, 'Test RC Business', ProviderStatus.ACTIVE],
  );

  const [plan] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM subscription_plans WHERE name = 'TRIAL' LIMIT 1`,
  );

  await AppDataSource.query(
    `INSERT INTO provider_subscriptions
       (provider_id, plan_id, status, started_at, expires_at, ai_quota_reset_at)
     VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '30 days', NOW() + INTERVAL '1 month')`,
    [providerId, plan.id, SubscriptionStatus.TRIAL],
  );
}

function cafeBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'RC Test Track',
    description: 'Indoor RC track',
    phone: '0901234567',
    address: '123 Nguyen Van Linh',
    district: 'Quan 7',
    city: 'Ho Chi Minh',
    operating_hours: {
      mon: { open: '09:00', close: '22:00', is_closed: false },
    },
    track_types: ['DRIFT', 'OBSTACLE'],
    slot_duration_minutes: 60,
    slot_fee_rate: 150000,
    max_concurrent_bookings: 10,
    byoc_capacity: 5,
    ...overrides,
  };
}

describe('Cafe routes', () => {
  it('provider đã đăng ký ACTIVE tạo cafe được, status mặc định PENDING', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);

    const res = await request(app)
      .post('/api/v1/cafes')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send(cafeBody());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.providerId).toBe(provider.id);
    expect(res.body.data.status).toBe(CafeStatus.PENDING);
  });

  it('provider chưa được duyệt không CRUD được cafe', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });

    await AppDataSource.query(
      `INSERT INTO provider_profiles
         (user_id, business_name, registration_status)
       VALUES ($1, $2, $3)`,
      [provider.id, 'Pending RC Business', ProviderStatus.PENDING],
    );

    const res = await request(app)
      .post('/api/v1/cafes')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send(cafeBody());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('provider chỉ update được cafe thuộc sở hữu của mình', async () => {
    const owner = await createTestUser({ role: UserRole.PROVIDER });
    const other = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(owner.id);
    await activateProvider(other.id);
    const cafe = await createTestCafe({ provider_id: owner.id });

    const denied = await request(app)
      .patch(`/api/v1/cafes/${cafe.id}`)
      .set('Authorization', `Bearer ${generateToken(other)}`)
      .send({ name: 'Other Update' });

    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .patch(`/api/v1/cafes/${cafe.id}`)
      .set('Authorization', `Bearer ${generateToken(owner)}`)
      .send({ name: 'Owner Update' });

    expect(allowed.status).toBe(200);
    expect(allowed.body.data.name).toBe('Owner Update');
  });

  it('public list chỉ trả ACTIVE và có pagination meta', async () => {
    await createTestCafe({ status: CafeStatus.ACTIVE });
    await createTestCafe({ status: CafeStatus.PENDING });

    const res = await request(app).get('/api/v1/cafes?page=1&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 1, page: 1, limit: 10 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe(CafeStatus.ACTIVE);
  });

  it('owner xem được draft detail, public không xem được', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    const cafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.PENDING });

    const hidden = await request(app).get(`/api/v1/cafes/${cafe.id}`);
    expect(hidden.status).toBe(404);

    const visible = await request(app)
      .get(`/api/v1/cafes/${cafe.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);

    expect(visible.status).toBe(200);
    expect(visible.body.data.address).toBeDefined();
    expect(visible.body.data.operatingHours).toBeDefined();
    expect(visible.body.data.trackTypes).toEqual(expect.arrayContaining(['DRIFT']));
    expect(visible.body.data.status).toBe(CafeStatus.PENDING);
  });

  it('admin cập nhật status cafe được', async () => {
    const admin = await createTestUser({ role: UserRole.ADMIN });
    const cafe = await createTestCafe({ status: CafeStatus.PENDING });

    const res = await request(app)
      .patch(`/api/v1/cafes/${cafe.id}/status`)
      .set('Authorization', `Bearer ${generateToken(admin)}`)
      .send({ status: CafeStatus.ACTIVE });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(CafeStatus.ACTIVE);
  });
});

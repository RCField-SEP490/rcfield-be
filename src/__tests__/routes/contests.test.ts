import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import {
  CafeStatus,
  ContestStatus,
  ProviderStatus,
  SubscriptionStatus,
  UserRole,
} from '../../types';
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

let driftId: string;

beforeAll(async () => {
  const [trackType] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM track_types WHERE code = 'DRIFT' LIMIT 1`,
  );
  driftId = trackType.id;
});

function contestBody(cafeIds: string[], overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    name: 'RCField Spec Cup',
    description: 'Spec race for community drivers',
    track_type_id: driftId,
    vehicle_rule: { allowed_sources: ['RENTAL', 'BYOC'] },
    starts_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(now + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
    registration_opens_at: new Date(now - 60 * 60 * 1000).toISOString(),
    registration_closes_at: new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 24,
    entry_fee: 0,
    banner_image_url: 'https://cdn.rcfield.test/contest.jpg',
    config: { format: 'TIME_ATTACK' },
    participating_cafe_ids: cafeIds,
    ...overrides,
  };
}

async function createProviderContest(status: ContestStatus, cafeIds: string[]) {
  const provider = await createTestUser({ role: UserRole.PROVIDER });
  await activateProvider(provider.id);
  const cafe = cafeIds.length > 0 ? null : await createTestCafe({ provider_id: provider.id });
  const ids = cafeIds.length > 0 ? cafeIds : [cafe!.id];

  const createRes = await request(app)
    .post('/api/v1/contests')
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send(contestBody(ids));
  expect(createRes.status).toBe(201);

  if (status === ContestStatus.OPEN) {
    const openRes = await request(app)
      .post(`/api/v1/contests/${createRes.body.data.id}/open`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(openRes.status).toBe(200);
    return { provider, contest: openRes.body.data };
  }

  return { provider, contest: createRes.body.data };
}

describe('Contest management routes', () => {
  it('provider ACTIVE tạo contest DRAFT với nhiều chi nhánh của mình', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const firstCafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.ACTIVE });
    const secondCafe = await createTestCafe({
      provider_id: provider.id,
      status: CafeStatus.ACTIVE,
    });

    const res = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send(contestBody([firstCafe.id, secondCafe.id]));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.provider_id).toBe(provider.id);
    expect(res.body.data.status).toBe(ContestStatus.DRAFT);
    expect(res.body.data.participating_cafes).toHaveLength(2);
  });

  it('staff không tạo được contest', async () => {
    const staff = await createTestUser({ role: UserRole.STAFF });
    const cafe = await createTestCafe({ status: CafeStatus.ACTIVE });

    const res = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(staff)}`)
      .send(contestBody([cafe.id]));

    expect(res.status).toBe(403);
  });

  it('customer không tạo được contest', async () => {
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const cafe = await createTestCafe({ status: CafeStatus.ACTIVE });

    const res = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(customer)}`)
      .send(contestBody([cafe.id]));

    expect(res.status).toBe(403);
  });

  it('provider không được dùng chi nhánh của provider khác', async () => {
    const owner = await createTestUser({ role: UserRole.PROVIDER });
    const other = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(owner.id);
    await activateProvider(other.id);
    const otherCafe = await createTestCafe({ provider_id: other.id, status: CafeStatus.ACTIVE });

    const res = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(owner)}`)
      .send(contestBody([otherCafe.id]));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONTEST_CAFE_INVALID');
  });

  it('open thất bại nếu contest không có chi nhánh tham gia', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const now = Date.now();
    const [contest] = await AppDataSource.query<{ id: string }[]>(
      `INSERT INTO contests
         (provider_id, name, description, track_type_id, vehicle_rule, starts_at, ends_at,
          registration_opens_at, registration_closes_at, capacity, entry_fee, status,
          banner_image_url, config, created_by)
       VALUES ($1, 'No Cafe Contest', NULL, $2, '{}',
          $3, $4, $5, $6, 10, 0, 'DRAFT', NULL, '{}', $1)
       RETURNING id`,
      [
        provider.id,
        driftId,
        new Date(now + 7 * 24 * 60 * 60 * 1000),
        new Date(now + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        new Date(now - 60 * 60 * 1000),
        new Date(now + 6 * 24 * 60 * 60 * 1000),
      ],
    );

    const res = await request(app)
      .post(`/api/v1/contests/${contest.id}/open`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTEST_CAFE_REQUIRED');
  });

  it('public list chỉ thấy contest public, không thấy DRAFT', async () => {
    await createProviderContest(ContestStatus.DRAFT, []);
    const { contest: openContest } = await createProviderContest(ContestStatus.OPEN, []);

    const res = await request(app).get('/api/v1/contests?page=1&limit=20');

    expect(res.status).toBe(200);
    expect(res.body.data.map((item: { id: string }) => item.id)).toEqual([openContest.id]);
    expect(res.body.data[0].status).toBe(ContestStatus.OPEN);
  });

  it('cafe contest list lọc bằng contest_cafes', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const includedCafe = await createTestCafe({
      provider_id: provider.id,
      status: CafeStatus.ACTIVE,
    });
    const excludedCafe = await createTestCafe({
      provider_id: provider.id,
      status: CafeStatus.ACTIVE,
    });

    const createRes = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send(contestBody([includedCafe.id]));
    expect(createRes.status).toBe(201);

    const openRes = await request(app)
      .post(`/api/v1/contests/${createRes.body.data.id}/open`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(openRes.status).toBe(200);

    const included = await request(app).get(`/api/v1/cafes/${includedCafe.id}/contests`);
    const excluded = await request(app).get(`/api/v1/cafes/${excludedCafe.id}/contests`);

    expect(included.status).toBe(200);
    expect(included.body.data.map((item: { id: string }) => item.id)).toContain(
      openRes.body.data.id,
    );
    expect(excluded.status).toBe(200);
    expect(excluded.body.data).toHaveLength(0);
  });
});

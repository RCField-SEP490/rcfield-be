import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { ProviderStatus, SubscriptionStatus, UserRole } from '../../types';
import { createTestCafe, createTestUser, generateToken } from '../helpers';

async function activateProvider(providerId: string): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO provider_profiles
       (user_id, business_name, registration_status)
     VALUES ($1, $2, $3)`,
    [providerId, 'Provider Menu Test', ProviderStatus.ACTIVE],
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

async function createMenuItem(
  cafeId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const body = {
    name: 'Cold Brew Nitro',
    description: 'Ca phe lanh nitro',
    price: 55000,
    category: 'Do uong',
    image_url: null,
    is_available: true,
    ...overrides,
  };

  const [item] = await AppDataSource.query(
    `INSERT INTO menu_items
       (cafe_id, name, description, price, category, image_url, is_available)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, name`,
    [
      cafeId,
      body.name,
      body.description,
      body.price,
      body.category,
      body.image_url,
      body.is_available,
    ],
  );
  return item;
}

describe('Menu routes', () => {
  it('provider list menu của cafe mình sở hữu với meta phân trang', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    await createMenuItem(cafe.id, { name: 'Bac xiu', is_available: true });
    await createMenuItem(cafe.id, {
      name: 'Snack bo cay',
      category: 'An vat',
      is_available: false,
    });

    const res = await request(app)
      .get(`/api/v1/cafes/${cafe.id}/menu?page=1&limit=10`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 2, page: 1, limit: 10 });
    expect(res.body.data.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining(['Bac xiu', 'Snack bo cay']),
    );
  });

  it('provider create item hợp lệ', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });

    const res = await request(app)
      .post(`/api/v1/cafes/${cafe.id}/menu`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        name: 'Matcha Latte',
        description: 'Matcha sua tuoi',
        price: 49000,
        category: 'Do uong',
        image_url: 'https://cdn.rcfield.vn/menu/matcha.jpg',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cafeId).toBe(cafe.id);
    expect(res.body.data.isAvailable).toBe(true);
    expect(res.body.data.price).toBe('49000.00');
  });

  it('provider update partial và toggle is_available', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const item = await createMenuItem(cafe.id);

    const res = await request(app)
      .patch(`/api/v1/cafes/${cafe.id}/menu/${item.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ price: 60000, is_available: false });

    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe('60000.00');
    expect(res.body.data.isAvailable).toBe(false);
  });

  it('provider soft-delete item và list không còn thấy item đó', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const item = await createMenuItem(cafe.id);

    const deleted = await request(app)
      .delete(`/api/v1/cafes/${cafe.id}/menu/${item.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);

    expect(deleted.status).toBe(204);

    const listed = await request(app)
      .get(`/api/v1/cafes/${cafe.id}/menu`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);

    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(0);
  });

  it('provider không CRUD cafe hoặc item của người khác', async () => {
    const owner = await createTestUser({ role: UserRole.PROVIDER });
    const other = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(owner.id);
    await activateProvider(other.id);
    const cafe = await createTestCafe({ provider_id: owner.id });
    const item = await createMenuItem(cafe.id);

    const listDenied = await request(app)
      .get(`/api/v1/cafes/${cafe.id}/menu`)
      .set('Authorization', `Bearer ${generateToken(other)}`);
    const createDenied = await request(app)
      .post(`/api/v1/cafes/${cafe.id}/menu`)
      .set('Authorization', `Bearer ${generateToken(other)}`)
      .send({ name: 'Other item', price: 10000 });
    const updateDenied = await request(app)
      .patch(`/api/v1/cafes/${cafe.id}/menu/${item.id}`)
      .set('Authorization', `Bearer ${generateToken(other)}`)
      .send({ name: 'Hacked' });
    const deleteDenied = await request(app)
      .delete(`/api/v1/cafes/${cafe.id}/menu/${item.id}`)
      .set('Authorization', `Bearer ${generateToken(other)}`);

    expect(listDenied.status).toBe(403);
    expect(createDenied.status).toBe(403);
    expect(updateDenied.status).toBe(403);
    expect(deleteDenied.status).toBe(403);
  });

  it('validate body và params cho menu CRUD', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const item = await createMenuItem(cafe.id);

    const invalidPrice = await request(app)
      .post(`/api/v1/cafes/${cafe.id}/menu`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ name: 'A', price: -1 });
    expect(invalidPrice.status).toBe(400);
    expect(invalidPrice.body.code).toBe('VALIDATION_ERROR');

    const invalidUrl = await request(app)
      .patch(`/api/v1/cafes/${cafe.id}/menu/${item.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ image_url: 'not-a-url' });
    expect(invalidUrl.status).toBe(400);
    expect(invalidUrl.body.code).toBe('VALIDATION_ERROR');

    const invalidUuid = await request(app)
      .get('/api/v1/cafes/not-a-uuid/menu')
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(invalidUuid.status).toBe(400);
    expect(invalidUuid.body.code).toBe('VALIDATION_ERROR');
  });
});

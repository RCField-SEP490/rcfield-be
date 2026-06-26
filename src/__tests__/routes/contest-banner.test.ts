jest.mock('../../services/cloudinary.service', () => ({
  uploadImage: jest.fn().mockResolvedValue({
    publicId: 'rcfield/contests/test/banner/banner-1',
    url: 'https://res.cloudinary.com/demo/image/upload/v1/contest-banner.png',
  }),
  deleteImage: jest.fn().mockResolvedValue(undefined),
  extractPublicIdFromUrl: jest.fn().mockReturnValue('rcfield/contests/test/banner/old-banner'),
}));

import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { CafeStatus, ProviderStatus, SubscriptionStatus, UserRole } from '../../types';
import { createTestCafe, createTestUser, generateToken } from '../helpers';

const { uploadImage, deleteImage } = jest.requireMock('../../services/cloudinary.service') as {
  uploadImage: jest.Mock;
  deleteImage: jest.Mock;
};

async function activateProvider(providerId: string): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO provider_profiles (user_id, business_name, registration_status)
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

describe('Contest banner upload', () => {
  let driftId: string;

  beforeAll(async () => {
    const [trackType] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM track_types WHERE code = 'DRIFT' LIMIT 1`,
    );
    driftId = trackType.id;
  });

  async function createDraftContest(
    providerId: string,
    cafeId: string,
    bannerImageUrl?: string | null,
  ) {
    const body = {
      name: 'Contest Banner Test',
      description: 'Upload banner flow',
      track_type_id: driftId,
      vehicle_rule: { vehicle_policy: 'MIXED' },
      starts_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      registration_opens_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      registration_closes_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      capacity: 16,
      entry_fee: 0,
      banner_image_url: bannerImageUrl ?? null,
      participating_cafe_ids: [cafeId],
      config: { format: 'KNOCKOUT' },
    };

    const res = await request(app)
      .post('/api/v1/contests')
      .set(
        'Authorization',
        `Bearer ${generateToken({ id: providerId, email: 'provider@test.com', role: UserRole.PROVIDER })}`,
      )
      .send(body);

    expect(res.status).toBe(201);
    return res.body.data;
  }

  it('provider owner uploads contest banner successfully', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.ACTIVE });
    const contest = await createDraftContest(provider.id, cafe.id);

    const res = await request(app)
      .post(`/api/v1/contests/${contest.id}/banner`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .attach('file', Buffer.from('fake-banner'), {
        filename: 'contest-banner.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(res.body.data.banner_image_url).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1/contest-banner.png',
    );

    const [saved] = await AppDataSource.query<{ banner_image_url: string | null }[]>(
      `SELECT banner_image_url FROM contests WHERE id = $1`,
      [contest.id],
    );
    expect(saved.banner_image_url).toBe(res.body.data.banner_image_url);
  });

  it('provider not owning contest cannot upload banner', async () => {
    const owner = await createTestUser({ role: UserRole.PROVIDER });
    const other = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(owner.id);
    await activateProvider(other.id);
    const cafe = await createTestCafe({ provider_id: owner.id, status: CafeStatus.ACTIVE });
    const contest = await createDraftContest(owner.id, cafe.id);

    const res = await request(app)
      .post(`/api/v1/contests/${contest.id}/banner`)
      .set('Authorization', `Bearer ${generateToken(other)}`)
      .attach('file', Buffer.from('fake-banner'), {
        filename: 'contest-banner.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONTEST_FORBIDDEN');
  });

  it('rejects unsupported banner format', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.ACTIVE });
    const contest = await createDraftContest(
      provider.id,
      cafe.id,
      'https://res.cloudinary.com/demo/image/upload/v1/old-banner.png',
    );

    const res = await request(app)
      .post(`/api/v1/contests/${contest.id}/banner`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .attach('file', Buffer.from('plain-text'), {
        filename: 'contest-banner.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNSUPPORTED_FORMAT');
    expect(deleteImage).not.toHaveBeenCalled();
  });
});

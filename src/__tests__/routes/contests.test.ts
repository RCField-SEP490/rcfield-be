import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import {
  CafeStatus,
  ContestRegistrationStatus,
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

async function assignStaffToCafe(
  staffId: string,
  cafeId: string,
  assignedBy: string,
): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO staff_cafe_assignments (staff_id, cafe_id, assigned_by)
     VALUES ($1, $2, $3)`,
    [staffId, cafeId, assignedBy],
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
    vehicle_rule: { vehicle_policy: 'MIXED' },
    starts_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(now + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
    registration_opens_at: new Date(now - 60 * 60 * 1000).toISOString(),
    registration_closes_at: new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString(),
    capacity: 24,
    entry_fee: 0,
    banner_image_url: 'https://cdn.rcfield.test/contest.jpg',
    config: { format: 'KNOCKOUT', drivers_per_match: 2 },
    participating_cafe_ids: cafeIds,
    ...overrides,
  };
}

async function createOpenContest() {
  const provider = await createTestUser({ role: UserRole.PROVIDER });
  await activateProvider(provider.id);
  const cafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.ACTIVE });
  const createRes = await request(app)
    .post('/api/v1/contests')
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send(contestBody([cafe.id]));
  expect(createRes.status).toBe(201);
  const openRes = await request(app)
    .post(`/api/v1/contests/${createRes.body.data.id}/open`)
    .set('Authorization', `Bearer ${generateToken(provider)}`);
  expect(openRes.status).toBe(200);
  return { provider, cafe, contest: openRes.body.data };
}

async function createCustomerVehicle(customer: { id: string; email: string; role: UserRole }) {
  const res = await request(app)
    .post('/api/v1/me/customer-vehicles')
    .set('Authorization', `Bearer ${generateToken(customer)}`)
    .send({
      name: 'Mini-Z Drift Spec',
      scale: '1/10',
      chassis_type: 'Drift AWD',
      frequency: '2.4GHz',
      notes: 'Contest BYOC test car',
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function registerContest(
  contestId: string,
  reviewer?: { id: string; email: string; role: UserRole },
) {
  const customer = await createTestUser({ role: UserRole.CUSTOMER });
  const customerVehicle = await createCustomerVehicle(customer);
  const res = await request(app)
    .post(`/api/v1/contests/${contestId}/register`)
    .set('Authorization', `Bearer ${generateToken(customer)}`)
    .send({ vehicle_source: 'BYOC', customer_vehicle_id: customerVehicle.id });
  expect(res.status).toBe(201);
  if (!reviewer) return { customer, customerVehicle, registration: res.body.data };

  const approve = await request(app)
    .post(`/api/v1/contest-registrations/${res.body.data.id}/approve`)
    .set('Authorization', `Bearer ${generateToken(reviewer)}`)
    .send({});
  expect(approve.status).toBe(200);
  return { customer, customerVehicle, registration: approve.body.data };
}
async function checkedInRegistrations(
  contestId: string,
  cafeId: string,
  provider: { id: string; email: string; role: UserRole },
  count: number,
) {
  const registrations = [];
  for (let index = 0; index < count; index += 1) {
    const { registration } = await registerContest(contestId, provider);
    const checkIn = await request(app)
      .post(`/api/v1/contest-registrations/${registration.id}/check-in`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ cafe_id: cafeId });
    expect(checkIn.status).toBe(200);
    registrations.push(checkIn.body.data);
  }
  return registrations;
}

async function closeContest(
  contestId: string,
  provider: { id: string; email: string; role: UserRole },
) {
  const res = await request(app)
    .post(`/api/v1/contests/${contestId}/close`)
    .set('Authorization', `Bearer ${generateToken(provider)}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('Compact contest routes', () => {
  it('provider creates DRAFT contest, public cannot see it, then opens it', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.ACTIVE });

    const createRes = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send(contestBody([cafe.id]));

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe(ContestStatus.DRAFT);

    const publicDetail = await request(app).get(`/api/v1/contests/${createRes.body.data.id}`);
    expect(publicDetail.status).toBe(404);

    const openRes = await request(app)
      .post(`/api/v1/contests/${createRes.body.data.id}/open`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(openRes.status).toBe(200);
    expect(openRes.body.data.status).toBe(ContestStatus.OPEN);
  });

  it('blocks registration after provider closes contest', async () => {
    const { provider, contest } = await createOpenContest();
    const first = await registerContest(contest.id, provider);
    expect(first.registration.status).toBe(ContestRegistrationStatus.CONFIRMED);

    const closed = await closeContest(contest.id, provider);
    expect(closed.status).toBe(ContestStatus.CLOSED);

    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const blocked = await request(app)
      .post(`/api/v1/contests/${contest.id}/register`)
      .set('Authorization', `Bearer ${generateToken(customer)}`)
      .send({ vehicle_source: 'BYOC' });
    expect(blocked.status).toBe(409);
  });

  it('keeps BYOC registration pending until provider approves the contest vehicle entry', async () => {
    const { provider, contest } = await createOpenContest();
    const { registration, customerVehicle } = await registerContest(contest.id);
    expect(customerVehicle.scale).toBe('1/10');
    expect(registration.status).toBe(ContestRegistrationStatus.PENDING);
    expect(registration.customer_vehicle_id).toBe(customerVehicle.id);

    const approve = await request(app)
      .post(`/api/v1/contest-registrations/${registration.id}/approve`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({});

    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe(ContestRegistrationStatus.CONFIRMED);
  });
  it('staff check-in is allowed only at participating assigned cafe', async () => {
    const { provider, cafe, contest } = await createOpenContest();
    const staff = await createTestUser({ role: UserRole.STAFF });
    await assignStaffToCafe(staff.id, cafe.id, provider.id);
    const { registration } = await registerContest(contest.id, provider);

    const res = await request(app)
      .post(`/api/v1/contest-registrations/${registration.id}/check-in`)
      .set('Authorization', `Bearer ${generateToken(staff)}`)
      .send({ cafe_id: cafe.id });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(ContestRegistrationStatus.CHECKED_IN);
  });

  it('generates 1v1 knockout bracket, submits winners, advances and publishes leaderboard', async () => {
    const { provider, cafe, contest } = await createOpenContest();
    const registrations = await checkedInRegistrations(contest.id, cafe.id, provider, 4);
    await closeContest(contest.id, provider);

    const generate = await request(app)
      .post(`/api/v1/contests/${contest.id}/matches/generate`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        format: 'KNOCKOUT',
        drivers_per_match: 2,
        seeding_mode: 'MANUAL',
        registration_ids: registrations.map((registration) => registration.id),
      });

    expect(generate.status).toBe(201);
    expect(generate.body.data).toHaveLength(3);
    const firstRound = generate.body.data.filter(
      (match: { round_no: number }) => match.round_no === 1,
    );
    const final = generate.body.data.find((match: { round_no: number }) => match.round_no === 2);
    expect(firstRound).toHaveLength(2);
    expect(final).toBeTruthy();

    const firstResult = await request(app)
      .post(`/api/v1/contest-matches/${firstRound[0].id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        results: [
          {
            registration_id: firstRound[0].participants[0].registration_id,
            finish_position: 1,
            score: 10,
            is_winner: true,
          },
          {
            registration_id: firstRound[0].participants[1].registration_id,
            finish_position: 2,
            score: 6,
          },
        ],
        reason: 'Manual staff entry',
      });
    expect(firstResult.status).toBe(200);

    const advance = await request(app)
      .post(`/api/v1/contest-matches/${firstRound[0].id}/advance`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ next_match_id: final.id, top_n: 1 });
    expect(advance.status).toBe(200);
    expect(advance.body.data.participants).toHaveLength(1);

    const secondResult = await request(app)
      .post(`/api/v1/contest-matches/${firstRound[1].id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        results: [
          {
            registration_id: firstRound[1].participants[0].registration_id,
            finish_position: 1,
            score: 10,
            is_winner: true,
          },
          {
            registration_id: firstRound[1].participants[1].registration_id,
            finish_position: 2,
            score: 6,
          },
        ],
      });
    expect(secondResult.status).toBe(200);
    const secondAdvance = await request(app)
      .post(`/api/v1/contest-matches/${firstRound[1].id}/advance`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ next_match_id: final.id, top_n: 1 });
    expect(secondAdvance.status).toBe(200);

    const finalMatch = secondAdvance.body.data;
    const finalResult = await request(app)
      .post(`/api/v1/contest-matches/${finalMatch.id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        results: [
          {
            registration_id: finalMatch.participants[0].registration_id,
            finish_position: 1,
            score: 20,
            best_lap_ms: 18234,
            is_winner: true,
          },
          {
            registration_id: finalMatch.participants[1].registration_id,
            finish_position: 2,
            score: 12,
            best_lap_ms: 19000,
          },
        ],
      });
    expect(finalResult.status).toBe(200);

    const publish = await request(app)
      .post(`/api/v1/contests/${contest.id}/leaderboard/publish`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ reason: 'Final verified manually' });
    expect(publish.status).toBe(200);
    expect(publish.body.data.standings[0].rank).toBe(1);
    expect(publish.body.data.standings[0].score).toBe(20);
  });

  it('generates multi-driver heat schedule and supports drag/drop participant reorder', async () => {
    const { provider, cafe, contest } = await createOpenContest();
    const registrations = await checkedInRegistrations(contest.id, cafe.id, provider, 4);
    await closeContest(contest.id, provider);

    const generate = await request(app)
      .post(`/api/v1/contests/${contest.id}/matches/generate`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        format: 'MULTI_DRIVER_HEAT',
        drivers_per_match: 4,
        seeding_mode: 'MANUAL',
        registration_ids: registrations.map((registration) => registration.id),
      });
    expect(generate.status).toBe(201);
    expect(generate.body.data).toHaveLength(1);
    expect(generate.body.data[0].participants).toHaveLength(4);

    const reversed = [...generate.body.data[0].participants]
      .reverse()
      .map((participant: { registration_id: string }, index) => ({
        registration_id: participant.registration_id,
        slot_no: index + 1,
        lane: String.fromCharCode(65 + index),
        grid_position: index + 1,
      }));
    const reorder = await request(app)
      .patch(`/api/v1/contest-matches/${generate.body.data[0].id}/participants`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ participants: reversed });
    expect(reorder.status).toBe(200);
    expect(reorder.body.data.participants[0].registration_id).toBe(reversed[0].registration_id);
  });

  it('rejects schedule generation when selected registration is cancelled', async () => {
    const { provider, contest } = await createOpenContest();
    const { registration } = await registerContest(contest.id, provider);
    const cancel = await request(app)
      .post(`/api/v1/contest-registrations/${registration.id}/cancel`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ reason: 'Invalid entry' });
    expect(cancel.status).toBe(200);
    await closeContest(contest.id, provider);

    const generate = await request(app)
      .post(`/api/v1/contests/${contest.id}/matches/generate`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        format: 'KNOCKOUT',
        drivers_per_match: 2,
        registration_ids: [registration.id],
        seeding_mode: 'MANUAL',
      });
    expect(generate.status).toBe(409);
  });

  it('writes audit logs for business mutations', async () => {
    const { provider, contest } = await createOpenContest();
    const { registration } = await registerContest(contest.id, provider);
    await closeContest(contest.id, provider);

    const rows = await AppDataSource.query<{ event_type: string }[]>(
      `SELECT event_type FROM contest_audit_logs WHERE contest_id = $1 ORDER BY created_at ASC`,
      [contest.id],
    );
    expect(rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        'contest.created',
        'contest.opened',
        'registration.created',
        'contest.closed',
      ]),
    );
    expect(registration.status).toBe(ContestRegistrationStatus.CONFIRMED);
  });

  it('legacy advanced contest endpoints are no longer mounted', async () => {
    const { provider, contest } = await createOpenContest();
    const res = await request(app)
      .post(`/api/v1/contests/${contest.id}/classes`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ code: 'OLD', name: 'Old Class' });
    expect(res.status).toBe(404);

    const rewardClaims = await request(app)
      .get('/api/v1/me/contest-reward-claims')
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(rewardClaims.status).toBe(404);
  });
});

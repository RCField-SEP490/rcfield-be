import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import {
  CafeStatus,
  ContestRegistrationStatus,
  ContestResultStatus,
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

async function setupOperationalContest() {
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

  const customer = await createTestUser({ role: UserRole.CUSTOMER });
  const registration = await registerContest(openRes.body.data.id, customer);
  expect(registration.status).toBe(201);

  const checkIn = await request(app)
    .post(`/api/v1/contest-registrations/${registration.body.data.id}/check-in`)
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send({ cafe_id: cafe.id });
  expect(checkIn.status).toBe(200);

  return { provider, cafe, customer, contest: openRes.body.data, registration: checkIn.body.data };
}

async function addCheckedInParticipant(
  contestId: string,
  cafeId: string,
  provider: { id: string; email: string; role: UserRole },
) {
  const customer = await createTestUser({ role: UserRole.CUSTOMER });
  const registration = await registerContest(contestId, customer);
  expect(registration.status).toBe(201);
  const checkIn = await request(app)
    .post(`/api/v1/contest-registrations/${registration.body.data.id}/check-in`)
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send({ cafe_id: cafeId });
  expect(checkIn.status).toBe(200);
  return { customer, registration: checkIn.body.data };
}

async function createCompetitionResult(verified: boolean) {
  const { provider, customer, contest, registration } = await setupOperationalContest();
  const contestClass = await request(app)
    .post(`/api/v1/contests/${contest.id}/classes`)
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send({ code: 'LB', name: 'Leaderboard Class' });
  expect(contestClass.status).toBe(201);
  const round = await request(app)
    .post(`/api/v1/contests/${contest.id}/rounds`)
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send({
      contest_class_id: contestClass.body.data.id,
      round_type: 'QUALIFYING',
      round_no: 1,
    });
  expect(round.status).toBe(201);
  const heat = await request(app)
    .post(`/api/v1/contest-rounds/${round.body.data.id}/heats`)
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send({ heat_no: 1 });
  expect(heat.status).toBe(201);
  const entry = await request(app)
    .post(`/api/v1/contest-heats/${heat.body.data.id}/entries`)
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send({ registration_id: registration.id, contest_class_id: contestClass.body.data.id });
  expect(entry.status).toBe(201);
  const submit = await request(app)
    .post(`/api/v1/contest-heats/${heat.body.data.id}/results`)
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send({
      result_type: 'TIME_ATTACK',
      results: [{ heat_entry_id: entry.body.data.id, best_lap_ms: 17000 }],
    });
  expect(submit.status).toBe(201);
  if (verified) {
    const verify = await request(app)
      .post(`/api/v1/contest-results/${submit.body.data[0].id}/verify`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({});
    expect(verify.status).toBe(200);
  }
  return { provider, customer, contest, result: submit.body.data[0] };
}

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

async function registerContest(
  contestId: string,
  user: { id: string; email: string; role: UserRole },
) {
  return request(app)
    .post(`/api/v1/contests/${contestId}/register`)
    .set('Authorization', `Bearer ${generateToken(user)}`)
    .send({ vehicle_source: 'BYOC' });
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

describe('Contest registration and check-in routes', () => {
  it('customer đăng ký contest thành công', async () => {
    const { contest } = await createProviderContest(ContestStatus.OPEN, []);
    const customer = await createTestUser({ role: UserRole.CUSTOMER });

    const res = await registerContest(contest.id, customer);

    expect(res.status).toBe(201);
    expect(res.body.data.user_id).toBe(customer.id);
    expect(res.body.data.status).toBe(ContestRegistrationStatus.CONFIRMED);
  });

  it('duplicate registration bị chặn', async () => {
    const { contest } = await createProviderContest(ContestStatus.OPEN, []);
    const customer = await createTestUser({ role: UserRole.CUSTOMER });

    const first = await registerContest(contest.id, customer);
    const duplicate = await registerContest(contest.id, customer);

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('CONTEST_REGISTRATION_EXISTS');
  });

  it('capacity lock không cho overbook', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.ACTIVE });
    const createRes = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send(contestBody([cafe.id], { capacity: 1 }));
    expect(createRes.status).toBe(201);
    const openRes = await request(app)
      .post(`/api/v1/contests/${createRes.body.data.id}/open`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(openRes.status).toBe(200);

    const firstCustomer = await createTestUser({ role: UserRole.CUSTOMER });
    const secondCustomer = await createTestUser({ role: UserRole.CUSTOMER });
    const first = await registerContest(openRes.body.data.id, firstCustomer);
    const second = await registerContest(openRes.body.data.id, secondCustomer);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('CONTEST_CAPACITY_FULL');
  });

  it('provider self-register bị chặn nhưng provider khác đăng ký được', async () => {
    const { provider, contest } = await createProviderContest(ContestStatus.OPEN, []);
    const otherProvider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(otherProvider.id);

    const self = await registerContest(contest.id, provider);
    const other = await registerContest(contest.id, otherProvider);

    expect(self.status).toBe(403);
    expect(self.body.code).toBe('CONTEST_SELF_REGISTRATION_FORBIDDEN');
    expect(other.status).toBe(201);
    expect(other.body.data.participant_role_snapshot).toBe(UserRole.PROVIDER);
  });

  it('staff check-in sai cafe thất bại, đúng cafe thành công', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const includedCafe = await createTestCafe({
      provider_id: provider.id,
      status: CafeStatus.ACTIVE,
    });
    const wrongCafe = await createTestCafe({ provider_id: provider.id, status: CafeStatus.ACTIVE });
    const staff = await createTestUser({ role: UserRole.STAFF });
    await assignStaffToCafe(staff.id, wrongCafe.id, provider.id);

    const createRes = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send(contestBody([includedCafe.id]));
    expect(createRes.status).toBe(201);
    const openRes = await request(app)
      .post(`/api/v1/contests/${createRes.body.data.id}/open`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(openRes.status).toBe(200);

    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const registration = await registerContest(openRes.body.data.id, customer);
    expect(registration.status).toBe(201);

    const wrong = await request(app)
      .post(`/api/v1/contest-registrations/${registration.body.data.id}/check-in`)
      .set('Authorization', `Bearer ${generateToken(staff)}`)
      .send({ cafe_id: wrongCafe.id });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('CONTEST_CHECK_IN_CAFE_INVALID');

    await AppDataSource.query(`DELETE FROM staff_cafe_assignments WHERE staff_id = $1`, [staff.id]);
    await assignStaffToCafe(staff.id, includedCafe.id, provider.id);
    const correct = await request(app)
      .post(`/api/v1/contest-registrations/${registration.body.data.id}/check-in`)
      .set('Authorization', `Bearer ${generateToken(staff)}`)
      .send({ cafe_id: includedCafe.id });

    expect(correct.status).toBe(200);
    expect(correct.body.data.status).toBe(ContestRegistrationStatus.CHECKED_IN);
    expect(correct.body.data.checked_in_cafe_id).toBe(includedCafe.id);
  });

  it('participant hủy registration thành công', async () => {
    const { contest } = await createProviderContest(ContestStatus.OPEN, []);
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const registration = await registerContest(contest.id, customer);
    expect(registration.status).toBe(201);

    const res = await request(app)
      .post(`/api/v1/contest-registrations/${registration.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${generateToken(customer)}`)
      .send({ reason: 'Busy' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(ContestRegistrationStatus.CANCELLED);
    expect(res.body.data.cancellation_reason).toBe('Busy');
  });

  it('provider hủy contest thì active registrations cũng bị hủy', async () => {
    const { provider, contest } = await createProviderContest(ContestStatus.OPEN, []);
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const registration = await registerContest(contest.id, customer);
    expect(registration.status).toBe(201);

    const cancelContest = await request(app)
      .post(`/api/v1/contests/${contest.id}/cancel`)
      .set('Authorization', `Bearer ${generateToken(provider)}`);
    expect(cancelContest.status).toBe(200);
    expect(cancelContest.body.data.status).toBe(ContestStatus.CANCELLED);

    const rows = await AppDataSource.query<{ status: ContestRegistrationStatus }[]>(
      `SELECT status FROM contest_registrations WHERE id = $1`,
      [registration.body.data.id],
    );
    expect(rows[0].status).toBe(ContestRegistrationStatus.CANCELLED);
  });
});

describe('Contest competition core routes', () => {
  it('tạo class, round, heat và add checked-in heat entry', async () => {
    const { provider, contest, registration } = await setupOperationalContest();

    const contestClass = await request(app)
      .post(`/api/v1/contests/${contest.id}/classes`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ code: 'RENTAL_SPEC', name: 'Rental Spec' });
    expect(contestClass.status).toBe(201);

    const round = await request(app)
      .post(`/api/v1/contests/${contest.id}/rounds`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        contest_class_id: contestClass.body.data.id,
        round_type: 'QUALIFYING',
        round_no: 1,
      });
    expect(round.status).toBe(201);

    const heat = await request(app)
      .post(`/api/v1/contest-rounds/${round.body.data.id}/heats`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ heat_no: 1 });
    expect(heat.status).toBe(201);

    const entry = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/entries`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        registration_id: registration.id,
        contest_class_id: contestClass.body.data.id,
        grid_position: 1,
      });
    expect(entry.status).toBe(201);
    expect(entry.body.data.registrationId).toBe(registration.id);
  });

  it('submit TIME_ATTACK và RACE_FINAL result hợp lệ', async () => {
    const { provider, contest, registration } = await setupOperationalContest();
    const contestClass = await request(app)
      .post(`/api/v1/contests/${contest.id}/classes`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ code: 'OPEN', name: 'Open Class' });
    const round = await request(app)
      .post(`/api/v1/contests/${contest.id}/rounds`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        contest_class_id: contestClass.body.data.id,
        round_type: 'QUALIFYING',
        round_no: 1,
      });
    const heat = await request(app)
      .post(`/api/v1/contest-rounds/${round.body.data.id}/heats`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ heat_no: 1 });
    const entry = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/entries`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ registration_id: registration.id });

    const timeAttack = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        result_type: 'TIME_ATTACK',
        results: [{ heat_entry_id: entry.body.data.id, best_lap_ms: 18234 }],
      });
    expect(timeAttack.status).toBe(201);
    expect(timeAttack.body.data[0].resultType).toBe('TIME_ATTACK');

    const raceFinal = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        result_type: 'RACE_FINAL',
        results: [{ heat_entry_id: entry.body.data.id, finish_position: 1, total_time_ms: 120000 }],
      });
    expect(raceFinal.status).toBe(201);
    expect(raceFinal.body.data[0].resultType).toBe('RACE_FINAL');
  });

  it('invalid result fields fail', async () => {
    const { provider, contest, registration } = await setupOperationalContest();
    const contestClass = await request(app)
      .post(`/api/v1/contests/${contest.id}/classes`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ code: 'BEGINNER', name: 'Beginner' });
    const round = await request(app)
      .post(`/api/v1/contests/${contest.id}/rounds`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        contest_class_id: contestClass.body.data.id,
        round_type: 'QUALIFYING',
        round_no: 1,
      });
    const heat = await request(app)
      .post(`/api/v1/contest-rounds/${round.body.data.id}/heats`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ heat_no: 1 });
    const entry = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/entries`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ registration_id: registration.id });

    const invalid = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        result_type: 'TIME_ATTACK',
        results: [{ heat_entry_id: entry.body.data.id, finish_position: 1 }],
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });

  it('verify result và chặn sửa result đã verify', async () => {
    const { provider, contest, registration } = await setupOperationalContest();
    const contestClass = await request(app)
      .post(`/api/v1/contests/${contest.id}/classes`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ code: 'FINAL', name: 'Final Class' });
    const round = await request(app)
      .post(`/api/v1/contests/${contest.id}/rounds`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        contest_class_id: contestClass.body.data.id,
        round_type: 'FINAL',
        round_no: 1,
      });
    const heat = await request(app)
      .post(`/api/v1/contest-rounds/${round.body.data.id}/heats`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ heat_no: 1 });
    const entry = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/entries`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ registration_id: registration.id });
    const submit = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        result_type: 'TIME_ATTACK',
        results: [{ heat_entry_id: entry.body.data.id, best_lap_ms: 19000 }],
      });
    expect(submit.status).toBe(201);

    const verify = await request(app)
      .post(`/api/v1/contest-results/${submit.body.data[0].id}/verify`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({});
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe(ContestResultStatus.VERIFIED);

    const editVerified = await request(app)
      .post(`/api/v1/contest-heats/${heat.body.data.id}/results`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        result_type: 'TIME_ATTACK',
        results: [{ heat_entry_id: entry.body.data.id, best_lap_ms: 18000 }],
      });

    expect(editVerified.status).toBe(409);
    expect(editVerified.body.code).toBe('CONTEST_RESULT_ALREADY_VERIFIED');
  });

  it('bracket match đánh dấu thắng/thua và tự đẩy winner sang vòng sau', async () => {
    const {
      provider,
      cafe,
      contest,
      registration: firstRegistration,
    } = await setupOperationalContest();
    const second = await addCheckedInParticipant(contest.id, cafe.id, provider);
    const third = await addCheckedInParticipant(contest.id, cafe.id, provider);

    const contestClass = await request(app)
      .post(`/api/v1/contests/${contest.id}/classes`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ code: 'KO', name: 'Knockout' });
    expect(contestClass.status).toBe(201);

    const semiRound = await request(app)
      .post(`/api/v1/contests/${contest.id}/rounds`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        contest_class_id: contestClass.body.data.id,
        round_type: 'QUALIFYING',
        round_no: 1,
        name: 'Semi Final',
      });
    expect(semiRound.status).toBe(201);

    const finalRound = await request(app)
      .post(`/api/v1/contests/${contest.id}/rounds`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        contest_class_id: contestClass.body.data.id,
        round_type: 'FINAL',
        round_no: 1,
        name: 'Final',
      });
    expect(finalRound.status).toBe(201);

    const finalMatch = await request(app)
      .post(`/api/v1/contest-rounds/${finalRound.body.data.id}/bracket-matches`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        match_no: 1,
        competitor_a_registration_id: third.registration.id,
      });
    expect(finalMatch.status).toBe(201);

    const semiMatch = await request(app)
      .post(`/api/v1/contest-rounds/${semiRound.body.data.id}/bracket-matches`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        match_no: 1,
        competitor_a_registration_id: firstRegistration.id,
        competitor_b_registration_id: second.registration.id,
        next_match_id: finalMatch.body.data.id,
        next_slot: 'B',
      });
    expect(semiMatch.status).toBe(201);

    const decide = await request(app)
      .post(`/api/v1/contest-bracket-matches/${semiMatch.body.data.id}/decide`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ winner_registration_id: second.registration.id, metadata: { score: '2-1' } });

    expect(decide.status).toBe(200);
    expect(decide.body.data.status).toBe('COMPLETED');
    expect(decide.body.data.winnerRegistrationId).toBe(second.registration.id);
    expect(decide.body.data.loserRegistrationId).toBe(firstRegistration.id);

    const [nextMatch] = await AppDataSource.query<{ competitor_b_registration_id: string }[]>(
      `SELECT competitor_b_registration_id FROM contest_bracket_matches WHERE id = $1`,
      [finalMatch.body.data.id],
    );
    expect(nextMatch.competitor_b_registration_id).toBe(second.registration.id);
  });
});

describe('Contest leaderboard and rewards routes', () => {
  it('leaderboard không bao gồm result chưa verify', async () => {
    const { contest } = await createCompetitionResult(false);

    const res = await request(app).get(`/api/v1/contests/${contest.id}/leaderboard`);

    expect(res.status).toBe(200);
    expect(res.body.data.standings).toHaveLength(0);
  });

  it('publish snapshot và get public leaderboard từ verified result', async () => {
    const { provider, contest } = await createCompetitionResult(true);

    const publish = await request(app)
      .post(`/api/v1/contests/${contest.id}/leaderboard/publish`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({});
    expect(publish.status).toBe(201);
    expect(publish.body.data.standings).toHaveLength(1);

    const leaderboard = await request(app).get(`/api/v1/contests/${contest.id}/leaderboard`);
    expect(leaderboard.status).toBe(200);
    expect(leaderboard.body.data.standings[0].rank).toBe(1);
  });

  it('tạo reward, issue claim và chặn issue trùng', async () => {
    const { provider, customer, contest } = await createCompetitionResult(true);

    const reward = await request(app)
      .post(`/api/v1/contests/${contest.id}/rewards`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        title: 'Champion Trophy',
        reward_type: 'TROPHY',
        position: 1,
      });
    expect(reward.status).toBe(201);

    const rewards = await request(app).get(`/api/v1/contests/${contest.id}/rewards`);
    expect(rewards.status).toBe(200);
    expect(rewards.body.data).toHaveLength(1);

    const issue = await request(app)
      .post(`/api/v1/contests/${contest.id}/rewards/issue`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({});
    expect(issue.status).toBe(201);
    expect(issue.body.data).toHaveLength(1);

    const duplicate = await request(app)
      .post(`/api/v1/contests/${contest.id}/rewards/issue`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({});
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('CONTEST_REWARD_ALREADY_ISSUED');

    const myClaims = await request(app)
      .get('/api/v1/me/contest-reward-claims')
      .set('Authorization', `Bearer ${generateToken(customer)}`);
    expect(myClaims.status).toBe(200);
    expect(myClaims.body.data).toHaveLength(1);
  });
});

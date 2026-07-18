import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { processContestReminders } from '../../jobs/contest-reminder.job';
import {
  NotificationType,
  ProviderStatus,
  SubscriptionStatus,
  UserRole,
  VehicleSource,
} from '../../types';
import { createTestCafe, createTestUser, createTestVehicle, generateToken } from '../helpers';

async function activateProvider(providerId: string): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO provider_profiles (user_id, business_name, registration_status)
     VALUES ($1, $2, $3)`,
    [providerId, 'Contest Provider', ProviderStatus.ACTIVE],
  );

  const [plan] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM subscription_plans WHERE is_trial = true LIMIT 1`,
  );

  await AppDataSource.query(
    `INSERT INTO provider_subscriptions
       (provider_id, plan_id, status, started_at, expires_at, ai_quota_reset_at)
     VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '14 days', NOW() + INTERVAL '30 days')`,
    [providerId, plan.id, SubscriptionStatus.TRIAL],
  );
}

async function createContestFixture(
  providerId: string,
  cafeId: string,
  formatCode: 'TIME_TRIAL' | 'KNOCKOUT',
  overrides?: Partial<{ entryFee: number; vehiclePolicy: 'RENTAL_ONLY' | 'BYOC_ONLY' | 'MIXED' }>,
) {
  const [trackType] = await AppDataSource.query<{ id: string; code: string }[]>(
    `SELECT id, code FROM track_types ORDER BY created_at ASC LIMIT 1`,
  );
  const [contestType] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_types WHERE code = 'PROVIDER_STANDARD' LIMIT 1`,
  );
  const [contestFormat] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_formats WHERE code = $1 LIMIT 1`,
    [formatCode],
  );
  const [contestTemplate] = await AppDataSource.query<
    { id: string; default_config: Record<string, unknown> }[]
  >(`SELECT id, default_config FROM contest_templates WHERE contest_format_id = $1 LIMIT 1`, [
    contestFormat.id,
  ]);

  const [contest] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contests
       (cafe_id, provider_id, name, description, track_type, track_type_id, contest_type_id,
        contest_format_id, contest_template_id, registration_opens_at, registration_closes_at,
        banner_image_url, vehicle_rule, config, starts_at, ends_at, capacity, entry_fee, status, created_by)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7,
        $8, $9, NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 day',
        NULL, $10, $11, NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 day', 32, $12, 'OPEN', $2)
     RETURNING id`,
    [
      cafeId,
      providerId,
      `Contest ${formatCode}`,
      `Contest test cho ${formatCode}`,
      trackType.code,
      trackType.id,
      contestType.id,
      contestFormat.id,
      contestTemplate.id,
      JSON.stringify({
        vehicle_policy: overrides?.vehiclePolicy ?? 'RENTAL_ONLY',
        assignment_policy: 'AT_CHECK_IN',
      }),
      JSON.stringify(contestTemplate.default_config ?? { format: formatCode }),
      overrides?.entryFee ?? 0,
    ],
  );

  await AppDataSource.query(
    `INSERT INTO contest_cafes (contest_id, cafe_id, role, display_order, check_in_enabled)
     VALUES ($1, $2, 'HOST', 0, TRUE)`,
    [contest.id, cafeId],
  );

  return { contestId: contest.id, trackTypeId: trackType.id };
}

async function createContestPayload(
  cafeId: string,
  formatCode: 'TIME_TRIAL' | 'KNOCKOUT',
  overrides?: Partial<{
    starts_at: string;
    ends_at: string;
    registration_opens_at: string;
    registration_closes_at: string;
    config: Record<string, unknown>;
  }>,
) {
  const [trackType] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM track_types ORDER BY created_at ASC LIMIT 1`,
  );
  const [contestType] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_types WHERE code = 'PROVIDER_STANDARD' LIMIT 1`,
  );
  const [contestFormat] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_formats WHERE code = $1 LIMIT 1`,
    [formatCode],
  );
  const [contestTemplate] = await AppDataSource.query<
    { id: string; default_config: Record<string, unknown> }[]
  >(`SELECT id, default_config FROM contest_templates WHERE contest_format_id = $1 LIMIT 1`, [
    contestFormat.id,
  ]);

  const startsAt = overrides?.starts_at ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const endsAt = overrides?.ends_at ?? new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();

  return {
    name: `Contest ${formatCode}`,
    description: `Contest test cho ${formatCode}`,
    contest_type_id: contestType.id,
    contest_format_id: contestFormat.id,
    contest_template_id: contestTemplate.id,
    track_type_id: trackType.id,
    participating_cafe_ids: [cafeId],
    starts_at: startsAt,
    ends_at: endsAt,
    registration_opens_at:
      overrides?.registration_opens_at ?? new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    registration_closes_at:
      overrides?.registration_closes_at ?? new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    capacity: 32,
    entry_fee: 0,
    banner_image_url: null,
    vehicle_rule: { vehicle_policy: 'RENTAL_ONLY', assignment_policy: 'AT_CHECK_IN' },
    config: {
      ...(contestTemplate.default_config ?? {}),
      ...(overrides?.config ?? {}),
    },
  };
}

async function createRegistrationFixture(
  contestId: string,
  status: 'CONFIRMED' | 'CHECKED_IN' = 'CHECKED_IN',
) {
  const customer = await createTestUser({ role: UserRole.CUSTOMER });
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const checkedInAt = status === 'CHECKED_IN' ? new Date() : null;
  const [registration] = await AppDataSource.query<{ id: string; user_id: string }[]>(
    `INSERT INTO contest_registrations
       (contest_id, user_id, participant_role_snapshot, vehicle_source, status, check_in_code,
        payment_status, metadata, checked_in_at)
     VALUES
       ($1, $2, 'CUSTOMER', $3, $4, $5, 'MARKED_PAID', '{}'::jsonb, $6)
     RETURNING id, user_id`,
    [contestId, customer.id, VehicleSource.RENTAL, status, code, checkedInAt],
  );
  return registration;
}

describe('Contest runtime routes', () => {
  it('time trial flow: generate matches, submit results, publish leaderboard, read metrics and audit logs', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL');
    const registrationA = await createRegistrationFixture(contestId, 'CHECKED_IN');
    const registrationB = await createRegistrationFixture(contestId, 'CHECKED_IN');

    const generateRes = await request(app)
      .post(`/api/v1/contests/${contestId}/matches/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cafe_id: cafe.id,
        registration_ids: [registrationA.id, registrationB.id],
      })
      .expect(201);

    expect(generateRes.body.success).toBe(true);
    expect(generateRes.body.data).toHaveLength(2);
    expect(generateRes.body.data[0].participants).toHaveLength(1);

    const matchesRes = await request(app)
      .get(`/api/v1/contests/${contestId}/matches`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [firstMatch, secondMatch] = matchesRes.body.data;

    await request(app)
      .post(`/api/v1/contest-matches/${firstMatch.id}/results`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reason: 'Finish time trial lane 1',
        results: [
          {
            registration_id: firstMatch.participants[0].registration_id,
            finish_position: 1,
            best_lap_seconds: 35.21,
            total_time_seconds: 35.21,
          },
        ],
      })
      .expect(200);

    await request(app)
      .post(`/api/v1/contest-matches/${secondMatch.id}/results`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reason: 'Finish time trial lane 2',
        results: [
          {
            registration_id: secondMatch.participants[0].registration_id,
            finish_position: 1,
            best_lap_seconds: 33.1,
            total_time_seconds: 33.1,
          },
        ],
      })
      .expect(200);

    const leaderboardRes = await request(app)
      .post(`/api/v1/contests/${contestId}/leaderboard/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    expect(leaderboardRes.body.data.mode).toBe('BEST_LAP');
    expect(leaderboardRes.body.data.entries).toHaveLength(2);
    expect(leaderboardRes.body.data.entries[0]).toMatchObject({
      registration_id: registrationB.id,
      rank: 1,
      best_lap_seconds: 33.1,
    });

    const metricsRes = await request(app)
      .get(`/api/v1/contests/${contestId}/metrics`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(metricsRes.body.data.match_counts.completed).toBe(2);
    expect(metricsRes.body.data.leaderboard.published).toBe(true);

    const auditRes = await request(app)
      .get(`/api/v1/contests/${contestId}/audit-logs`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(auditRes.body.data.map((item: { eventType: string }) => item.eventType)).toEqual(
      expect.arrayContaining([
        'contest.matches_generated',
        'match.results_submitted',
        'contest.leaderboard_published',
      ]),
    );
  });

  it('knockout flow: advance winners and require force correction when downstream already linked', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'KNOCKOUT');
    const registrationA = await createRegistrationFixture(contestId, 'CHECKED_IN');
    const registrationB = await createRegistrationFixture(contestId, 'CHECKED_IN');
    const registrationC = await createRegistrationFixture(contestId, 'CHECKED_IN');
    const registrationD = await createRegistrationFixture(contestId, 'CHECKED_IN');

    const generateRes = await request(app)
      .post(`/api/v1/contests/${contestId}/matches/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cafe_id: cafe.id,
        registration_ids: [registrationA.id, registrationB.id, registrationC.id, registrationD.id],
        drivers_per_match: 2,
      })
      .expect(201);

    const roundOneMatches = generateRes.body.data.filter(
      (match: { round_no: number }) => match.round_no === 1,
    );
    const semifinal = roundOneMatches[0];
    const semifinalWinner = semifinal.participants[0].registration_id;
    const semifinalLoser = semifinal.participants[1].registration_id;

    await request(app)
      .post(`/api/v1/contest-matches/${semifinal.id}/results`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reason: 'Semifinal done',
        results: [
          {
            registration_id: semifinalWinner,
            finish_position: 1,
            is_winner: true,
          },
          {
            registration_id: semifinalLoser,
            finish_position: 2,
          },
        ],
      })
      .expect(200);

    const advanceRes = await request(app)
      .post(`/api/v1/contest-matches/${semifinal.id}/advance`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    const finalMatch = advanceRes.body.data.find(
      (match: { round_no: number }) => match.round_no === 2,
    );
    expect(finalMatch.participants).toHaveLength(1);
    expect(finalMatch.participants[0].registration_id).toBe(semifinalWinner);

    const blockedCorrectionRes = await request(app)
      .post(`/api/v1/contest-matches/${semifinal.id}/results/correct`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reason: 'Swap semifinal result',
        results: [
          {
            registration_id: semifinalWinner,
            finish_position: 2,
          },
          {
            registration_id: semifinalLoser,
            finish_position: 1,
            is_winner: true,
          },
        ],
      })
      .expect(409);

    expect(blockedCorrectionRes.body.code).toBe('MATCH_CORRECTION_REQUIRES_FORCE');

    const forcedCorrectionRes = await request(app)
      .post(`/api/v1/contest-matches/${semifinal.id}/results/correct`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        reason: 'Force swap semifinal result',
        force_cascade: true,
        results: [
          {
            registration_id: semifinalWinner,
            finish_position: 2,
          },
          {
            registration_id: semifinalLoser,
            finish_position: 1,
            is_winner: true,
          },
        ],
      })
      .expect(200);

    const resetFinal = forcedCorrectionRes.body.data.find(
      (match: { round_no: number }) => match.round_no === 2,
    );
    expect(resetFinal.participants).toHaveLength(0);

    const reAdvanceRes = await request(app)
      .post(`/api/v1/contest-matches/${semifinal.id}/advance`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    const updatedFinal = reAdvanceRes.body.data.find(
      (match: { round_no: number }) => match.round_no === 2,
    );
    expect(updatedFinal.participants).toHaveLength(1);
    expect(updatedFinal.participants[0].registration_id).toBe(semifinalLoser);
  });

  it('không cho tạo runtime từ registration chưa check-in', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL');
    const registration = await createRegistrationFixture(contestId, 'CONFIRMED');

    const res = await request(app)
      .post(`/api/v1/contests/${contestId}/matches/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cafe_id: cafe.id,
        registration_ids: [registration.id],
      })
      .expect(400);

    expect(res.body.code).toBe('REGISTRATION_NOT_RUNTIME_READY');
  });

  it('chặn tạo contest khi trùng booking đã có', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const token = generateToken(provider);
    const payload = await createContestPayload(cafe.id, 'KNOCKOUT');

    await AppDataSource.query(
      `INSERT INTO bookings
         (customer_id, cafe_id, track_type_id, play_mode, source, status, slot_start, slot_end, slot_count, payment_expires_at, discount_amount)
       VALUES
         ($1, $2, $3, 'RENTAL', 'APP', 'CONFIRMED', $4, $5, 1, NOW() + INTERVAL '30 minutes', 0)`,
      [customer.id, cafe.id, payload.track_type_id, payload.starts_at, payload.ends_at],
    );

    const res = await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(409);

    expect(res.body.code).toBe('CONTEST_BOOKING_CONFLICT');
  });

  it('availability báo hết chỗ khi khung giờ đã bị contest giữ', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const payload = await createContestPayload(cafe.id, 'TIME_TRIAL');

    await request(app)
      .post('/api/v1/contests')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/cafes/${cafe.id}/availability`)
      .query({
        slot_start: payload.starts_at,
        slot_end: payload.ends_at,
        play_mode: 'RENTAL',
      })
      .expect(200);

    expect(res.body.data.available).toBe(false);
    expect(res.body.data.vehicles).toHaveLength(0);
  });

  it('assigned staff có thể check-in, vận hành runtime và xem metrics của contest được bàn giao', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const staff = await createTestUser({ role: UserRole.STAFF });
    const cafe = await createTestCafe({ provider_id: provider.id });
    const providerToken = generateToken(provider);
    const staffToken = generateToken(staff);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL');
    const registration = await createRegistrationFixture(contestId, 'CONFIRMED');

    await request(app)
      .post(`/api/v1/contests/${contestId}/staff-assignments`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ staff_id: staff.id })
      .expect(200);

    // Staff must also be assigned to the cafe to operate there.
    await AppDataSource.query(
      `INSERT INTO staff_cafe_assignments (staff_id, cafe_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [staff.id, cafe.id, provider.id],
    );

    // Check-in requires the contest to be CLOSED or RUNNING and within the race window.
    await AppDataSource.query(
      `UPDATE contests
       SET starts_at = NOW() - INTERVAL '1 hour', ends_at = NOW() + INTERVAL '1 hour'
       WHERE id = $1`,
      [contestId],
    );

    await request(app)
      .post(`/api/v1/contests/${contestId}/close`)
      .set('Authorization', `Bearer ${providerToken}`)
      .expect(200);

    await request(app)
      .post(`/api/v1/contest-registrations/${registration.id}/check-in`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ checked_in_cafe_id: cafe.id })
      .expect(200);

    const generateRes = await request(app)
      .post(`/api/v1/contests/${contestId}/matches/generate`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ cafe_id: cafe.id, registration_ids: [registration.id] })
      .expect(201);

    const matchId = generateRes.body.data[0].id;
    await request(app)
      .post(`/api/v1/contest-matches/${matchId}/results`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        reason: 'Staff run time trial',
        results: [
          {
            registration_id: registration.id,
            finish_position: 1,
            best_lap_seconds: 32.45,
            total_time_seconds: 32.45,
          },
        ],
      })
      .expect(200);

    const metricsRes = await request(app)
      .get(`/api/v1/contests/${contestId}/metrics`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    expect(metricsRes.body.data.match_counts.completed).toBe(1);
    expect(metricsRes.body.data.registration_counts.checked_in).toBe(1);
  });

  it('staff thuộc cafe nhưng chưa được phân công trực tiếp vào contest thì không có quyền vận hành', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const staff = await createTestUser({ role: UserRole.STAFF });
    const cafe = await createTestCafe({ provider_id: provider.id });
    const staffToken = generateToken(staff);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL');

    await AppDataSource.query(
      `INSERT INTO staff_cafe_assignments (staff_id, cafe_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [staff.id, cafe.id, provider.id],
    );

    const res = await request(app)
      .get(`/api/v1/contests/${contestId}/metrics`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('customer có thể đăng ký BYOC contest khi contest cho phép và provider duyệt thủ công', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const providerToken = generateToken(provider);
    const customerToken = generateToken(customer);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL', {
      vehiclePolicy: 'MIXED',
    });

    const registerRes = await request(app)
      .post(`/api/v1/contests/${contestId}/register`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        vehicle_source: 'BYOC',
        byoc_vehicle_name: 'MST RMX 2.5',
        byoc_vehicle_brand: 'MST',
        byoc_vehicle_class: 'Drift',
      })
      .expect(201);

    expect(registerRes.body.data.vehicle_source).toBe('BYOC');
    expect(registerRes.body.data.metadata.byoc_declaration.vehicle_name).toBe('MST RMX 2.5');

    const approvedRes = await request(app)
      .post(`/api/v1/contest-registrations/${registerRes.body.data.id}/approve`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ reason: 'BYOC declaration accepted' })
      .expect(200);

    expect(approvedRes.body.data.status).toBe('CONFIRMED');
  });

  it('ban contest sẽ chặn customer đăng ký mới', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const providerToken = generateToken(provider);
    const customerToken = generateToken(customer);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL', {
      vehiclePolicy: 'MIXED',
    });

    await request(app)
      .post(`/api/v1/contests/${contestId}/bans`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        user_id: customer.id,
        scope_type: 'CONTEST',
        reason: 'Intentional sabotage',
      })
      .expect(201);

    const res = await request(app)
      .post(`/api/v1/contests/${contestId}/register`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        vehicle_source: 'BYOC',
        byoc_vehicle_name: 'Yokomo YD-2',
      })
      .expect(403);

    expect(res.body.code).toBe('CONTEST_PARTICIPANT_BANNED');
  });

  it('customer có thể tạo payment URL cho contest entry fee', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const customerToken = generateToken(customer);
    const { contestId, trackTypeId } = await createContestFixture(
      provider.id,
      cafe.id,
      'TIME_TRIAL',
      {
        entryFee: 150000,
      },
    );
    const vehicle = await createTestVehicle({
      cafe_id: cafe.id,
      compatible_track_types: [trackTypeId],
    });

    const [booking] = await AppDataSource.query<{ id: string }[]>(
      `INSERT INTO bookings
         (customer_id, cafe_id, track_type_id, play_mode, source, status, slot_start, slot_end, slot_count, payment_expires_at, discount_amount)
       VALUES
         ($1, $2, $3, 'RENTAL', 'APP', 'CONFIRMED', NOW() + INTERVAL '25 hours', NOW() + INTERVAL '26 hours', 1, NOW() + INTERVAL '30 minutes', 0)
       RETURNING id`,
      [customer.id, cafe.id, trackTypeId],
    );

    await AppDataSource.query(
      `INSERT INTO booking_vehicles
         (booking_id, vehicle_id, hourly_rate_snapshot, security_deposit_snapshot, damage_multiplier_snapshot)
       VALUES ($1, $2, 50000, 0, 1.0)`,
      [booking.id, vehicle.id],
    );

    const registerRes = await request(app)
      .post(`/api/v1/contests/${contestId}/register`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        booking_id: booking.id,
        vehicle_id: vehicle.id,
        vehicle_source: 'RENTAL',
      })
      .expect(201);

    const paymentRes = await request(app)
      .post(`/api/v1/contest-registrations/${registerRes.body.data.id}/create-entry-fee-payment`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({})
      .expect(201);

    expect(paymentRes.body.data.payment_url).toContain('vnp');
    expect(paymentRes.body.data.txn_ref).toContain('contest_');
  });

  it('tao notification khi customer dang ky contest thanh cong', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const customerToken = generateToken(customer);
    const { contestId, trackTypeId } = await createContestFixture(
      provider.id,
      cafe.id,
      'TIME_TRIAL',
    );
    const vehicle = await createTestVehicle({
      cafe_id: cafe.id,
      compatible_track_types: [trackTypeId],
    });

    const [booking] = await AppDataSource.query<{ id: string }[]>(
      `INSERT INTO bookings
         (customer_id, cafe_id, track_type_id, play_mode, source, status, slot_start, slot_end, slot_count, payment_expires_at, discount_amount)
       VALUES
         ($1, $2, $3, 'RENTAL', 'APP', 'CONFIRMED', NOW() + INTERVAL '25 hours', NOW() + INTERVAL '26 hours', 1, NOW() + INTERVAL '30 minutes', 0)
       RETURNING id`,
      [customer.id, cafe.id, trackTypeId],
    );

    await AppDataSource.query(
      `INSERT INTO booking_vehicles
         (booking_id, vehicle_id, hourly_rate_snapshot, security_deposit_snapshot, damage_multiplier_snapshot)
       VALUES ($1, $2, 50000, 0, 1.0)`,
      [booking.id, vehicle.id],
    );

    const registerRes = await request(app)
      .post(`/api/v1/contests/${contestId}/register`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        booking_id: booking.id,
        vehicle_id: vehicle.id,
        vehicle_source: 'RENTAL',
      })
      .expect(201);

    expect(registerRes.body.success).toBe(true);

    const notifications = await AppDataSource.query<{ type: string; title: string }[]>(
      `SELECT type, title FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
      [customer.id],
    );

    expect(notifications[0]).toMatchObject({
      type: NotificationType.CONTEST_REGISTRATION_CREATED,
    });
  });

  it('admin co the tao featured popup va public lay popup active uu tien cao nhat', async () => {
    const admin = await createTestUser({ role: UserRole.ADMIN });
    const adminToken = generateToken(admin);

    const inactive = await request(app)
      .post('/api/v1/admin/featured-popups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Popup het han',
        subtitle: 'Khong nen hien ra',
        image_url: 'https://example.com/popup-old.jpg',
        cta_label: 'Xem ngay',
        cta_url: 'https://example.com/old',
        starts_at: '2026-07-10T00:00:00.000Z',
        ends_at: '2026-07-12T00:00:00.000Z',
        is_active: true,
        priority: 10,
      })
      .expect(201);

    expect(inactive.body.data.id).toBeTruthy();

    const active = await request(app)
      .post('/api/v1/admin/featured-popups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Giai dang hot',
        subtitle: 'Popup dang active',
        image_url: 'https://example.com/popup-hot.jpg',
        cta_label: 'Dang ky ngay',
        cta_url: 'https://example.com/hot',
        starts_at: '2026-07-16T00:00:00.000Z',
        ends_at: '2026-07-20T00:00:00.000Z',
        is_active: true,
        priority: 200,
      })
      .expect(201);

    expect(active.body.data.title).toBe('Giai dang hot');

    const publicRes = await request(app).get('/api/v1/explore/featured-popup').expect(200);

    expect(publicRes.body.data).toMatchObject({
      title: 'Giai dang hot',
      priority: 200,
    });
  });

  it('contest reminder chi gui mot lan cho moi moc nhac', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const customer = await createTestUser({ role: UserRole.CUSTOMER });

    const [trackType] = await AppDataSource.query<{ id: string; code: string }[]>(
      `SELECT id, code FROM track_types ORDER BY created_at ASC LIMIT 1`,
    );
    const [contestType] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM contest_types WHERE code = 'PROVIDER_STANDARD' LIMIT 1`,
    );
    const [contestFormat] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM contest_formats WHERE code = 'TIME_TRIAL' LIMIT 1`,
    );
    const [contestTemplate] = await AppDataSource.query<
      { id: string; default_config: Record<string, unknown> }[]
    >(`SELECT id, default_config FROM contest_templates WHERE contest_format_id = $1 LIMIT 1`, [
      contestFormat.id,
    ]);

    const [contest] = await AppDataSource.query<{ id: string }[]>(
      `INSERT INTO contests
         (cafe_id, provider_id, name, description, track_type, track_type_id, contest_type_id,
          contest_format_id, contest_template_id, registration_opens_at, registration_closes_at,
          banner_image_url, vehicle_rule, config, starts_at, ends_at, capacity, entry_fee, status, created_by)
       VALUES
         ($1, $2, 'Reminder Contest', 'Contest sap dien ra', $3, $4, $5,
          $6, $7, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 minutes',
          NULL, '{"vehicle_policy":"MIXED","assignment_policy":"AT_CHECK_IN"}'::jsonb, $8, NOW() + INTERVAL '90 minutes', NOW() + INTERVAL '3 hours', 16, 0, 'OPEN', $2)
       RETURNING id`,
      [
        cafe.id,
        provider.id,
        trackType.code,
        trackType.id,
        contestType.id,
        contestFormat.id,
        contestTemplate.id,
        JSON.stringify(contestTemplate.default_config ?? {}),
      ],
    );

    await AppDataSource.query(
      `INSERT INTO contest_cafes (contest_id, cafe_id, role, display_order, check_in_enabled)
       VALUES ($1, $2, 'HOST', 0, TRUE)`,
      [contest.id, cafe.id],
    );

    await AppDataSource.query(
      `INSERT INTO contest_registrations
         (contest_id, user_id, participant_role_snapshot, vehicle_source, status, check_in_code, payment_status, metadata)
       VALUES
         ($1, $2, 'CUSTOMER', 'BYOC', 'CONFIRMED', 'ABC12345', 'PENDING_REVIEW', '{}'::jsonb)`,
      [contest.id, customer.id],
    );

    await processContestReminders();
    await processContestReminders();

    const reminderNotifications = await AppDataSource.query<{ total: string }[]>(
      `SELECT COUNT(*)::text AS total
         FROM notifications
        WHERE user_id = $1
          AND type = $2`,
      [customer.id, NotificationType.CONTEST_REMINDER],
    );

    expect(Number(reminderNotifications[0].total)).toBe(1);
  });
});

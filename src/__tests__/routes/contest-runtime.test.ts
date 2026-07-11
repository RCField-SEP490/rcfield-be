import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { ProviderStatus, SubscriptionStatus, UserRole, VehicleSource } from '../../types';
import { createTestCafe, createTestUser, generateToken } from '../helpers';

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
        NULL, $10, $11, NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 day', 32, 0, 'OPEN', $2)
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
      JSON.stringify({ vehicle_policy: 'RENTAL_ONLY', assignment_policy: 'AT_CHECK_IN' }),
      JSON.stringify(contestTemplate.default_config ?? { format: formatCode }),
    ],
  );

  await AppDataSource.query(
    `INSERT INTO contest_cafes (contest_id, cafe_id, role, display_order, check_in_enabled)
     VALUES ($1, $2, 'HOST', 0, TRUE)`,
    [contest.id, cafeId],
  );

  return { contestId: contest.id, trackTypeId: trackType.id };
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
            best_lap_ms: 35210,
            total_time_ms: 35210,
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
            best_lap_ms: 33100,
            total_time_ms: 33100,
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
      best_lap_ms: 33100,
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
});

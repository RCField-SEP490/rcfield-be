import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { processContestAutoRunning } from '../../jobs/contest-reminder.job';
import { confirmContestEntryRefund, getContestDetail } from '../../services/contest.service';
import { processConfirmationResult } from '../../services/payment.service';
import { syncContestRaceRecords } from '../../services/racing-network.service';
import {
  ContestMatchStatus,
  ContestStatus,
  NotificationType,
  ProviderStatus,
  SubscriptionStatus,
  UserRole,
  VehicleSource,
} from '../../types';
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
  overrides?: Partial<{
    status: ContestStatus;
    entryFee: number;
    startsAt: Date;
    endsAt: Date;
    registrationClosesAt: Date;
  }>,
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

  const startsAt = overrides?.startsAt ?? new Date(Date.now() + 60 * 60 * 1000);
  const endsAt = overrides?.endsAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000);
  const registrationClosesAt =
    overrides?.registrationClosesAt ?? new Date(Date.now() + 30 * 60 * 1000);

  const [contest] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contests
       (cafe_id, provider_id, name, description, track_type, track_type_id, contest_type_id,
        contest_format_id, contest_template_id, registration_opens_at, registration_closes_at,
        banner_image_url, vehicle_rule, config, starts_at, ends_at, capacity, entry_fee, status, created_by)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7,
        $8, $9, NOW() - INTERVAL '1 day', $10,
        NULL, $11, $12, $13, $14, 32, $15, $16, $2)
     RETURNING id`,
    [
      cafeId,
      providerId,
      `Contest ${formatCode}`,
      `Hardening test ${formatCode}`,
      trackType.code,
      trackType.id,
      contestType.id,
      contestFormat.id,
      contestTemplate.id,
      registrationClosesAt,
      JSON.stringify({
        vehicle_policy: 'BYOC_ONLY',
        assignment_policy: 'AT_CHECK_IN',
      }),
      JSON.stringify(contestTemplate.default_config ?? { format: formatCode }),
      startsAt,
      endsAt,
      overrides?.entryFee ?? 50000,
      overrides?.status ?? ContestStatus.OPEN,
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
  status: 'CONFIRMED' | 'CHECKED_IN' | 'PENDING' = 'CHECKED_IN',
  paymentStatus: 'PENDING_PAYMENT' | 'PENDING_REVIEW' | 'MARKED_PAID' = 'MARKED_PAID',
) {
  const customer = await createTestUser({ role: UserRole.CUSTOMER });
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const checkedInAt = status === 'CHECKED_IN' ? new Date() : null;
  const [registration] = await AppDataSource.query<{ id: string; user_id: string }[]>(
    `INSERT INTO contest_registrations
       (contest_id, user_id, participant_role_snapshot, vehicle_source, status, check_in_code,
        payment_status, metadata, checked_in_at)
     VALUES
       ($1, $2, 'CUSTOMER', $3, $4, $5, $6, '{}'::jsonb, $7)
     RETURNING id, user_id`,
    [contestId, customer.id, VehicleSource.BYOC, status, code, paymentStatus, checkedInAt],
  );
  return { ...registration, customer };
}

async function createMatchFixture(
  contestId: string,
  cafeId: string,
  trackConfigId: string | null,
  createdBy: string,
) {
  const [match] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contest_matches
       (contest_id, cafe_id, track_config_id, round_no, match_no, name, match_type, status, created_by)
     VALUES ($1, $2, $3, 1, 1, 'Heat 1', 'TIME_ATTACK', $4, $5)
     RETURNING id`,
    [contestId, cafeId, trackConfigId, ContestMatchStatus.COMPLETED, createdBy],
  );
  return match;
}

async function createPaymentTransactionForRegistration(registrationId: string, amount: number) {
  const txnRef = `contest_${registrationId.replace(/-/g, '').slice(0, 18)}_${Date.now().toString(36).slice(-6)}`;
  await AppDataSource.query(
    `INSERT INTO payment_transactions
       (contest_registration_id, subject_type, type, gateway, txn_ref, amount, status, raw_request, raw_response)
     VALUES ($1, 'CONTEST_ENTRY', 'PAYMENT', 'mock', $2, $3, 'SUCCESS', '{}'::jsonb, '{}'::jsonb)`,
    [registrationId, txnRef, amount],
  );
}

async function createParticipantFixture(
  matchId: string,
  registrationId: string,
  results: { best_lap_seconds: number; total_time_seconds: number; finish_position: number },
  slotNo = 1,
) {
  await AppDataSource.query(
    `INSERT INTO contest_match_participants
       (match_id, registration_id, slot_no, lane, status, best_lap_seconds, total_time_seconds,
        finish_position, is_winner, created_at)
     VALUES ($1, $2, $3, 'L1', 'FINISHED', $4, $5, $6, TRUE, NOW())`,
    [
      matchId,
      registrationId,
      slotNo,
      results.best_lap_seconds,
      results.total_time_seconds,
      results.finish_position,
    ],
  );
}

type AuditLogRow = {
  id: string;
  event_type: string;
  after_json: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  registration_id: string | null;
};

async function getAuditLogs(contestId: string) {
  return AppDataSource.query<AuditLogRow[]>(
    `SELECT id, event_type, after_json, metadata, registration_id
       FROM contest_audit_logs
      WHERE contest_id = $1
      ORDER BY created_at DESC`,
    [contestId],
  );
}

describe('Contest hardening fixes', () => {
  it('cancelling a contest creates a pending refund and provider can confirm it', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL', {
      entryFee: 100000,
      status: ContestStatus.OPEN,
    });
    const registration = await createRegistrationFixture(contestId, 'CONFIRMED', 'MARKED_PAID');
    await createPaymentTransactionForRegistration(registration.id, 100000);

    await request(app)
      .post(`/api/v1/contests/${contestId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Test refund' })
      .expect(200);

    const [registrationRow] = await AppDataSource.query<
      { status: string; payment_status: string; metadata: Record<string, unknown> }[]
    >(
      `SELECT status, payment_status, metadata
         FROM contest_registrations
        WHERE id = $1`,
      [registration.id],
    );
    expect(registrationRow.status).toBe('CANCELLED');
    expect(registrationRow.metadata.refund_needed).toBe(true);
    expect(typeof registrationRow.metadata.refund_txn_id).toBe('string');

    const refundTxnId = registrationRow.metadata.refund_txn_id as string;

    await request(app)
      .post(`/api/v1/contest-registrations/${registration.id}/refunds/${refundTxnId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [updatedTxn] = await AppDataSource.query<{ status: string }[]>(
      `SELECT status FROM payment_transactions WHERE id = $1`,
      [refundTxnId],
    );
    expect(updatedTxn.status).toBe('SUCCESS');
  });

  it('published leaderboard masks opted-out participants for public viewer', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const { contestId, trackTypeId } = await createContestFixture(
      provider.id,
      cafe.id,
      'TIME_TRIAL',
      {
        status: ContestStatus.RUNNING,
      },
    );

    const regA = await createRegistrationFixture(contestId, 'CHECKED_IN', 'MARKED_PAID');
    const regB = await createRegistrationFixture(contestId, 'CHECKED_IN', 'MARKED_PAID');

    await AppDataSource.query(`UPDATE users SET racing_profile = $1::jsonb WHERE id = $2`, [
      JSON.stringify({
        public_profile_enabled: true,
        leaderboard_opt_in: true,
        driver_handle: 'openDriver',
      }),
      regA.user_id,
    ]);
    await AppDataSource.query(`UPDATE users SET racing_profile = $1::jsonb WHERE id = $2`, [
      JSON.stringify({
        public_profile_enabled: false,
        leaderboard_opt_in: true,
        driver_handle: 'hiddenDriver',
      }),
      regB.user_id,
    ]);

    const match = await createMatchFixture(contestId, cafe.id, null, provider.id);
    await createParticipantFixture(
      match.id,
      regA.id,
      { best_lap_seconds: 30, total_time_seconds: 30, finish_position: 1 },
      1,
    );
    await createParticipantFixture(
      match.id,
      regB.id,
      { best_lap_seconds: 31, total_time_seconds: 31, finish_position: 2 },
      2,
    );

    await request(app)
      .post(`/api/v1/contests/${contestId}/leaderboard/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const publicRes = await request(app).get(`/api/v1/contests/${contestId}`).expect(200);
    const entries = publicRes.body.data.published_leaderboard.entries;
    const publicEntryA = entries.find((e: { user_id: string }) => e.user_id === regA.user_id);
    const publicEntryB = entries.find((e: { user_id: string }) => e.user_id === regB.user_id);
    expect(publicEntryA.display_name).not.toBe('VĐV ẩn danh');
    expect(publicEntryB.display_name).toBe('VĐV ẩn danh');
    expect(publicEntryB.driver_handle).toBeNull();
    expect(publicEntryB.driver_title_label).toBe('');

    const operatorRes = await request(app)
      .get(`/api/v1/contests/${contestId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const operatorEntries = operatorRes.body.data.published_leaderboard.entries;
    const operatorEntryB = operatorEntries.find(
      (e: { user_id: string }) => e.user_id === regB.user_id,
    );
    expect(operatorEntryB.display_name).not.toBe('VĐV ẩn danh');
  });

  it('race record sync writes audit with per-record ids', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const { contestId, trackTypeId } = await createContestFixture(
      provider.id,
      cafe.id,
      'TIME_TRIAL',
      {
        status: ContestStatus.RUNNING,
      },
    );

    const reg = await createRegistrationFixture(contestId, 'CHECKED_IN', 'MARKED_PAID');
    const match = await createMatchFixture(contestId, cafe.id, null, provider.id);
    await createParticipantFixture(match.id, reg.id, {
      best_lap_seconds: 29.5,
      total_time_seconds: 29.5,
      finish_position: 1,
    });

    await request(app)
      .post(`/api/v1/contests/${contestId}/leaderboard/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app)
      .post(`/api/v1/contests/${contestId}/sync-race-records`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const logs = await getAuditLogs(contestId);
    const syncLog = logs.find((log) => log.event_type === 'race_records.synced');
    expect(syncLog).toBeDefined();
    expect(Array.isArray(syncLog!.metadata!.synced_record_ids)).toBe(true);
    expect((syncLog!.metadata!.synced_record_ids as string[]).length).toBeGreaterThan(0);
    expect((syncLog!.metadata!.synced_record_ids as string[])[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('auto-running transitions CLOSED contest to RUNNING when matches exist and start time passed', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const token = generateToken(provider);
    const { contestId, trackTypeId } = await createContestFixture(
      provider.id,
      cafe.id,
      'TIME_TRIAL',
      {
        status: ContestStatus.CLOSED,
        startsAt: new Date(Date.now() - 5 * 60 * 1000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
        registrationClosesAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    );

    const reg = await createRegistrationFixture(contestId, 'CHECKED_IN', 'MARKED_PAID');
    await request(app)
      .post(`/api/v1/contests/${contestId}/matches/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cafe_id: cafe.id, registration_ids: [reg.id] })
      .expect(201);

    await processContestAutoRunning();

    const [contestRow] = await AppDataSource.query<{ status: string }[]>(
      `SELECT status FROM contests WHERE id = $1`,
      [contestId],
    );
    expect(contestRow.status).toBe('RUNNING');

    const logs = await getAuditLogs(contestId);
    expect(logs.some((log) => log.event_type === 'contest.auto_running')).toBe(true);
  });

  it('failed contest entry payment writes audit log', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const providerToken = generateToken(provider);
    const { contestId } = await createContestFixture(provider.id, cafe.id, 'TIME_TRIAL', {
      entryFee: 100000,
      status: ContestStatus.OPEN,
    });

    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    const customerToken = generateToken(customer);

    const registerRes = await request(app)
      .post(`/api/v1/contests/${contestId}/register`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicle_source: 'BYOC', byoc_vehicle_name: 'Yokomo' })
      .expect(201);

    const registrationId = registerRes.body.data.id;

    const paymentRes = await request(app)
      .post(`/api/v1/contest-registrations/${registrationId}/create-entry-fee-payment`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    const txnRef = paymentRes.body.data.txn_ref;

    const logsBefore = await getAuditLogs(contestId);
    expect(
      logsBefore.some((log) => log.event_type === 'registration.entry_fee_payment_initiated'),
    ).toBe(true);

    await processConfirmationResult({
      txnRef,
      isSuccess: false,
      isValid: true,
      responseCode: '99',
      raw: { test: true },
      amount: 100000,
    });

    const logsAfter = await getAuditLogs(contestId);
    const failedLog = logsAfter.find(
      (log) => log.event_type === 'registration.entry_fee_payment_failed',
    );
    expect(failedLog).toBeDefined();
    expect(failedLog!.after_json).toMatchObject({ response_code: '99' });
  });
});

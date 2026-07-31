import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Demo seed for tonight — 3 contests (knockout / time trial / qualifying-final)
// plus 1 "tonight" contest with open registration until 20:00 + check-in.
// 15 seeded racers are fully paid; 1 test slot is left empty for the user.
// ─────────────────────────────────────────────────────────────────────────────

const BANNER_URL =
  'https://images.unsplash.com/photo-1568605117036-5fecc6207a71?auto=format&fit=crop&w=1600&q=80';

const TEST_RACER = {
  email: 'tonight.test.racer@gmail.com',
  full_name: 'Nguyễn Văn Test',
  password: '123456',
};

const SEEDED_RACERS = [
  { email: 'tonight.racer.01@gmail.com', full_name: 'Nguyễn Hoàng Phúc' },
  { email: 'tonight.racer.02@gmail.com', full_name: 'Trần Gia Bảo' },
  { email: 'tonight.racer.03@gmail.com', full_name: 'Lê Minh Quân' },
  { email: 'tonight.racer.04@gmail.com', full_name: 'Phạm Nhật Nam' },
  { email: 'tonight.racer.05@gmail.com', full_name: 'Đỗ Khánh Linh' },
  { email: 'tonight.racer.06@gmail.com', full_name: 'Võ Quốc Hưng' },
  { email: 'tonight.racer.07@gmail.com', full_name: 'Bùi Thành Đạt' },
  { email: 'tonight.racer.08@gmail.com', full_name: 'Ngô Tuệ An' },
  { email: 'tonight.racer.09@gmail.com', full_name: 'Hồ Hải Long' },
  { email: 'tonight.racer.10@gmail.com', full_name: 'Dương Minh Khoa' },
  { email: 'tonight.racer.11@gmail.com', full_name: 'Lý Quang Huy' },
  { email: 'tonight.racer.12@gmail.com', full_name: 'Trịnh Công Chính' },
  { email: 'tonight.racer.13@gmail.com', full_name: 'Mai Thanh Tùng' },
  { email: 'tonight.racer.14@gmail.com', full_name: 'Vũ Hoàng Nam' },
  { email: 'tonight.racer.15@gmail.com', full_name: 'Phan Đức Thịnh' },
];

const CONTEST_NAMES = {
  knockout: 'RC Field Knockout Championship 2026 — Đối kháng loại trực tiếp',
  timeTrial: 'RC Field Time Attack Sprint 2026 — Đua tính giờ cá nhân',
  grandPrix: 'RC Field Grand Prix 2026 — Vòng loại & Chung kết',
  tonight: 'RC Field Đêm thi đấu 31/07 — Đăng ký mở đến 20h',
};

type SeedUser = { id: string; email: string };

type SeedCatalog = {
  contestTypeId: string;
  grandPrixTypeId: string;
  knockoutFormatId: string;
  timeTrialFormatId: string;
  qualifyingFinalFormatId: string;
  knockoutTemplateId: string;
  timeTrialTemplateId: string;
  grandPrixTemplateId: string;
  driftTrackTypeId: string;
};

async function ensureUser(email: string, fullName: string): Promise<SeedUser> {
  const [existing] = await AppDataSource.query<(SeedUser & { full_name: string })[]>(
    `SELECT id, email, full_name FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
    [email],
  );

  if (existing) {
    if (existing.full_name !== fullName) {
      await AppDataSource.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [
        existing.id,
        fullName,
      ]);
    }
    return { id: existing.id, email: existing.email };
  }

  const passwordHash = await bcrypt.hash('123456', 10);
  const [created] = await AppDataSource.query<SeedUser[]>(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'CUSTOMER', TRUE)
     RETURNING id, email`,
    [email, fullName, passwordHash],
  );
  logger.info('SeedTonight', `Created customer ${email}`);
  return created;
}

async function loadProviderContext(): Promise<{
  providerId: string;
  staffId: string | null;
  cafe: { id: string; name: string; slug: string };
  catalog: SeedCatalog;
}> {
  const [provider] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'provider@gmail.com' AND deleted_at IS NULL LIMIT 1`,
  );
  if (!provider) throw new Error('provider@gmail.com not found. Run seed-users.ts first.');

  const [staff] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'staff@gmail.com' AND deleted_at IS NULL LIMIT 1`,
  );

  const [cafe] = await AppDataSource.query<{ id: string; name: string; slug: string }[]>(
    `SELECT id, name, slug FROM cafes WHERE slug = 'rc-arena-ha-noi' AND deleted_at IS NULL LIMIT 1`,
  );
  if (!cafe) throw new Error('RC Arena Hà Nội not found. Run seed-cafes.ts first.');

  const [standardType] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_types WHERE code = 'PROVIDER_STANDARD' LIMIT 1`,
  );
  const [grandPrixType] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_types WHERE code = 'GRAND_PRIX' LIMIT 1`,
  );
  const [knockoutFormat] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_formats WHERE code = 'KNOCKOUT' LIMIT 1`,
  );
  const [timeTrialFormat] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_formats WHERE code = 'TIME_TRIAL' LIMIT 1`,
  );
  const [qualifyingFinalFormat] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_formats WHERE code = 'QUALIFYING_FINAL' LIMIT 1`,
  );
  const [knockoutTemplate] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_templates WHERE code = 'provider_standard_knockout' LIMIT 1`,
  );
  const [timeTrialTemplate] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_templates WHERE code = 'provider_standard_time_trial' LIMIT 1`,
  );
  const [grandPrixTemplate] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_templates WHERE code = 'grand_prix_qualifying_final' LIMIT 1`,
  );
  const [driftTrack] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM track_types WHERE code = 'DRIFT' LIMIT 1`,
  );

  if (
    !standardType ||
    !grandPrixType ||
    !knockoutFormat ||
    !timeTrialFormat ||
    !qualifyingFinalFormat ||
    !knockoutTemplate ||
    !timeTrialTemplate ||
    !grandPrixTemplate ||
    !driftTrack
  ) {
    throw new Error('Contest catalog or DRIFT track type missing. Run migrations first.');
  }

  return {
    providerId: provider.id,
    staffId: staff?.id ?? null,
    cafe,
    catalog: {
      contestTypeId: standardType.id,
      grandPrixTypeId: grandPrixType.id,
      knockoutFormatId: knockoutFormat.id,
      timeTrialFormatId: timeTrialFormat.id,
      qualifyingFinalFormatId: qualifyingFinalFormat.id,
      knockoutTemplateId: knockoutTemplate.id,
      timeTrialTemplateId: timeTrialTemplate.id,
      grandPrixTemplateId: grandPrixTemplate.id,
      driftTrackTypeId: driftTrack.id,
    },
  };
}

async function cleanupSeedContests(): Promise<void> {
  const contests = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contests WHERE name = ANY($1::text[])`,
    [Object.values(CONTEST_NAMES)],
  );
  if (contests.length === 0) return;

  const ids = contests.map((c) => c.id);
  await AppDataSource.query(
    `DELETE FROM payment_transactions
     WHERE contest_registration_id IN (SELECT id FROM contest_registrations WHERE contest_id = ANY($1::uuid[]))`,
    [ids],
  );
  await AppDataSource.query(
    `DELETE FROM contest_staff_assignments WHERE contest_id = ANY($1::uuid[])`,
    [ids],
  );
  await AppDataSource.query(`DELETE FROM contest_bans WHERE contest_id = ANY($1::uuid[])`, [ids]);
  await AppDataSource.query(`DELETE FROM contest_audit_logs WHERE contest_id = ANY($1::uuid[])`, [
    ids,
  ]);
  await AppDataSource.query(
    `DELETE FROM contest_match_participants
     WHERE match_id IN (SELECT id FROM contest_matches WHERE contest_id = ANY($1::uuid[]))`,
    [ids],
  );
  await AppDataSource.query(`DELETE FROM contest_matches WHERE contest_id = ANY($1::uuid[])`, [
    ids,
  ]);
  await AppDataSource.query(
    `DELETE FROM contest_registrations WHERE contest_id = ANY($1::uuid[])`,
    [ids],
  );
  await AppDataSource.query(`DELETE FROM contest_cafes WHERE contest_id = ANY($1::uuid[])`, [ids]);
  await AppDataSource.query(`DELETE FROM contests WHERE id = ANY($1::uuid[])`, [ids]);
  logger.info('SeedTonight', `Cleaned ${contests.length} existing seed contest(s)`);
}

async function insertContest(params: {
  cafeId: string;
  providerId: string;
  name: string;
  description: string;
  status: string;
  trackTypeId: string;
  contestTypeId: string;
  contestFormatId: string;
  contestTemplateId: string;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  entryFee: number;
  vehicleRule: Record<string, unknown>;
  config: Record<string, unknown>;
  bannerImageUrl?: string | null;
}): Promise<string> {
  const [contest] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contests
       (cafe_id, provider_id, name, description, track_type, track_type_id, contest_type_id,
        contest_format_id, contest_template_id, registration_opens_at, registration_closes_at,
        banner_image_url, vehicle_rule, config, starts_at, ends_at, capacity, entry_fee, status, created_by)
     VALUES
       ($1, $2, $3, $4, 'DRIFT', $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $2)
     RETURNING id`,
    [
      params.cafeId,
      params.providerId,
      params.name,
      params.description,
      params.trackTypeId,
      params.contestTypeId,
      params.contestFormatId,
      params.contestTemplateId,
      params.registrationOpensAt,
      params.registrationClosesAt,
      params.bannerImageUrl ?? null,
      JSON.stringify(params.vehicleRule),
      JSON.stringify(params.config),
      params.startsAt,
      params.endsAt,
      params.capacity,
      params.entryFee,
      params.status,
    ],
  );
  return contest.id;
}

async function addContestCafe(
  contestId: string,
  cafeId: string,
  role: 'HOST' | 'PARTICIPATING',
  displayOrder: number,
): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO contest_cafes (contest_id, cafe_id, role, display_order, check_in_enabled)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [contestId, cafeId, role, displayOrder],
  );
}

async function addContestStaffAssignment(
  contestId: string,
  staffId: string,
  assignedBy: string,
): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO contest_staff_assignments (contest_id, staff_id, assigned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (contest_id, staff_id) DO NOTHING`,
    [contestId, staffId, assignedBy],
  );
}

async function insertRegistration(params: {
  contestId: string;
  userId: string;
  vehicleSource?: 'RENTAL' | 'BYOC';
  vehicleId: string | null;
  status: string;
  paymentStatus: string;
  entryFeeAmount: number;
  checkInCode: string;
  checkedInCafeId?: string | null;
  checkedInBy?: string | null;
  checkedInAt?: Date | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const [registration] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contest_registrations
       (contest_id, user_id, participant_role_snapshot, vehicle_source, vehicle_id, customer_vehicle_id, booking_id,
        status, check_in_code, checked_in_cafe_id, checked_in_by, checked_in_at,
        payment_status, entry_fee_amount, entry_fee_due_at, cancelled_by, cancelled_at,
        cancellation_reason, metadata)
     VALUES
       ($1, $2, 'CUSTOMER', $3, $4, NULL, NULL,
        $5, $6, $7, $8, $9,
        $10, $11, NOW() + INTERVAL '3 days', NULL, NULL,
        NULL, $12)
     RETURNING id`,
    [
      params.contestId,
      params.userId,
      params.vehicleSource ?? 'RENTAL',
      params.vehicleId,
      params.status,
      params.checkInCode,
      params.checkedInCafeId ?? null,
      params.checkedInBy ?? null,
      params.checkedInAt ?? null,
      params.paymentStatus,
      params.entryFeeAmount,
      JSON.stringify({ seeded: true, ...(params.metadata ?? {}) }),
    ],
  );
  return registration.id;
}

async function insertContestEntryPayment(params: {
  registrationId: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  txnRef: string;
}): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO payment_transactions
       (booking_id, contest_registration_id, subject_type, type, gateway, txn_ref,
        amount, status, raw_request, raw_response)
     VALUES
       (NULL, $1, 'CONTEST_ENTRY', 'PAYMENT', 'VNPAY', $2,
        $3, $4, $5, $6)`,
    [
      params.registrationId,
      params.txnRef,
      params.amount,
      params.status,
      JSON.stringify({ registrationId: params.registrationId }),
      JSON.stringify({ vnp_ResponseCode: '00', vnp_TransactionStatus: '00' }),
    ],
  );
}

async function writeAudit(params: {
  contestId: string;
  actorId: string | null;
  actorRole: string | null;
  eventType: string;
  registrationId?: string;
  afterJson?: Record<string, unknown> | null;
  reason?: string | null;
}): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO contest_audit_logs
       (contest_id, registration_id, match_id, actor_id, actor_role, event_type, after_json, reason, metadata)
     VALUES
       ($1, $2, NULL, $3, $4, $5, $6, $7, $8)`,
    [
      params.contestId,
      params.registrationId ?? null,
      params.actorId,
      params.actorRole,
      params.eventType,
      JSON.stringify(params.afterJson ?? {}),
      params.reason ?? null,
      JSON.stringify({ seeded: true }),
    ],
  );
}

async function pickAvailableVehicles(cafeId: string, count: number): Promise<string[]> {
  const vehicles = await AppDataSource.query<{ id: string }[]>(
    `SELECT id
     FROM vehicles
     WHERE cafe_id = $1 AND status = 'AVAILABLE' AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT $2`,
    [cafeId, count],
  );
  if (vehicles.length < count) {
    throw new Error(`Need at least ${count} available vehicles for cafe ${cafeId}`);
  }
  return vehicles.map((v) => v.id);
}

async function createContest(params: {
  context: Awaited<ReturnType<typeof loadProviderContext>>;
  name: string;
  description: string;
  status: string;
  contestTypeId: string;
  contestFormatId: string;
  contestTemplateId: string;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
  entryFee: number;
  vehiclePolicy: 'RENTAL_ONLY' | 'MIXED' | 'BYOC_ONLY';
  runtimeFormat: string;
  driversPerMatch: number;
  leaderboardMode?: string;
  finalists?: number;
  prizes: Array<{ rank: number; title: string; description: string }>;
}): Promise<string> {
  const { context } = params;
  const config: Record<string, unknown> = {
    format: params.runtimeFormat,
    runtime_format: params.runtimeFormat,
    drivers_per_match: params.driversPerMatch,
    seeding_mode: 'CHECK_IN_ORDER',
    auto_bye: true,
    leaderboard_mode: params.leaderboardMode ?? 'KNOCKOUT_WINS',
    resource_locks: [{ cafe_id: context.cafe.id, scope: 'FULL_BRANCH', track_config_ids: [] }],
    prizes: params.prizes,
  };
  if (params.finalists) {
    config.finalists = params.finalists;
  }

  const contestId = await insertContest({
    cafeId: context.cafe.id,
    providerId: context.providerId,
    name: params.name,
    description: params.description,
    status: params.status,
    trackTypeId: context.catalog.driftTrackTypeId,
    contestTypeId: params.contestTypeId,
    contestFormatId: params.contestFormatId,
    contestTemplateId: params.contestTemplateId,
    registrationOpensAt: params.registrationOpensAt,
    registrationClosesAt: params.registrationClosesAt,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    capacity: 16,
    entryFee: params.entryFee,
    vehicleRule: { vehicle_policy: params.vehiclePolicy, assignment_policy: 'AT_CHECK_IN' },
    config,
    bannerImageUrl: BANNER_URL,
  });

  await addContestCafe(contestId, context.cafe.id, 'HOST', 0);
  if (context.staffId) {
    await addContestStaffAssignment(contestId, context.staffId, context.providerId);
  }

  await writeAudit({
    contestId,
    actorId: context.providerId,
    actorRole: 'PROVIDER',
    eventType: 'contest.created',
    afterJson: { status: params.status },
  });

  return contestId;
}

async function seedPaidRegistrations(params: {
  contestId: string;
  racerIds: string[];
  vehicleIds: string[];
  providerId: string;
  entryFee: number;
  prefix: string;
}): Promise<void> {
  const { contestId, racerIds, vehicleIds, providerId, entryFee, prefix } = params;

  for (let i = 0; i < racerIds.length; i += 1) {
    const regId = await insertRegistration({
      contestId,
      userId: racerIds[i],
      vehicleSource: 'RENTAL',
      vehicleId: vehicleIds[i % vehicleIds.length],
      status: 'CONFIRMED',
      paymentStatus: 'MARKED_PAID',
      entryFeeAmount: entryFee,
      checkInCode: `${prefix}${String(i + 1).padStart(3, '0')}`,
    });

    await insertContestEntryPayment({
      registrationId: regId,
      amount: entryFee,
      status: 'SUCCESS',
      txnRef: `${prefix.toLowerCase()}_paid_${i + 1}`,
    });

    await writeAudit({
      contestId,
      actorId: providerId,
      actorRole: 'PROVIDER',
      eventType: 'registration.approved',
      registrationId: regId,
      afterJson: { status: 'CONFIRMED', paymentStatus: 'MARKED_PAID' },
    });
  }
}

function buildVnTonightDates(): {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
} {
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnDateStr = new Date(now.getTime() + vnOffset).toISOString().slice(0, 10);

  return {
    registrationOpensAt: now,
    registrationClosesAt: new Date(`${vnDateStr}T20:00:00+07:00`),
    startsAt: new Date(`${vnDateStr}T20:30:00+07:00`),
    endsAt: new Date(`${vnDateStr}T23:00:00+07:00`),
  };
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  logger.database('Connected');

  const context = await loadProviderContext();
  const testUserId = await ensureUser(TEST_RACER.email, TEST_RACER.full_name);
  const racerIds = await Promise.all(SEEDED_RACERS.map((r) => ensureUser(r.email, r.full_name)));
  logger.info('SeedTonight', `Ensured test user ${TEST_RACER.email} (${testUserId.id})`);

  await cleanupSeedContests();

  const vehicleIds = await pickAvailableVehicles(context.cafe.id, 8);
  const now = new Date();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  // ─── 1. Knockout contest — 15 paid + 1 empty slot for the user ───
  const knockoutContestId = await createContest({
    context,
    name: CONTEST_NAMES.knockout,
    description:
      'Giải đấu đối kháng loại trực tiếp 1v1. 15 tay đua đã sẵn sàng, còn 1 slot cuối dành cho bạn. ' +
      'Cho phép thuê xe tại chỗ hoặc mang xe cá nhân (BYOC).',
    status: 'OPEN',
    contestTypeId: context.catalog.contestTypeId,
    contestFormatId: context.catalog.knockoutFormatId,
    contestTemplateId: context.catalog.knockoutTemplateId,
    registrationOpensAt: new Date(now.getTime() - oneDay),
    registrationClosesAt: new Date(now.getTime() + oneDay * 2),
    startsAt: new Date(now.getTime() + oneDay * 3),
    endsAt: new Date(now.getTime() + oneDay * 3 + 4 * oneHour),
    entryFee: 100000,
    vehiclePolicy: 'MIXED',
    runtimeFormat: 'KNOCKOUT',
    driversPerMatch: 2,
    leaderboardMode: 'KNOCKOUT_WINS',
    prizes: [
      { rank: 1, title: 'Vô địch', description: 'Cúp vô địch + 2.000.000 VND' },
      { rank: 2, title: 'Á quân', description: 'Huy chương bạc + 1.000.000 VND' },
      { rank: 3, title: 'Hạng 3', description: 'Huy chương đồng + 500.000 VND' },
    ],
  });
  await seedPaidRegistrations({
    contestId: knockoutContestId,
    racerIds: racerIds.map((r) => r.id),
    vehicleIds,
    providerId: context.providerId,
    entryFee: 100000,
    prefix: 'KNO',
  });

  // ─── 2. Time trial contest — 15 paid + 1 empty slot for the user ───
  const timeTrialContestId = await createContest({
    context,
    name: CONTEST_NAMES.timeTrial,
    description:
      'Giải đấu đua tính giờ cá nhân. Mỗi tay đua chạy một lượt riêng, xếp hạng theo lap nhanh nhất. ' +
      '15 suất đã được thanh toán, còn 1 suất cuối chờ bạn đăng ký.',
    status: 'OPEN',
    contestTypeId: context.catalog.contestTypeId,
    contestFormatId: context.catalog.timeTrialFormatId,
    contestTemplateId: context.catalog.timeTrialTemplateId,
    registrationOpensAt: new Date(now.getTime() - oneDay),
    registrationClosesAt: new Date(now.getTime() + oneDay * 2),
    startsAt: new Date(now.getTime() + oneDay * 3),
    endsAt: new Date(now.getTime() + oneDay * 3 + 4 * oneHour),
    entryFee: 80000,
    vehiclePolicy: 'RENTAL_ONLY',
    runtimeFormat: 'TIME_TRIAL',
    driversPerMatch: 1,
    leaderboardMode: 'BEST_LAP',
    prizes: [
      { rank: 1, title: 'Fastest Lap', description: 'Cúp + voucher bảo dưỡng xe 1.500.000 VND' },
      { rank: 2, title: 'Second Fastest', description: 'Huy chương bạc + 800.000 VND' },
      { rank: 3, title: 'Third Fastest', description: 'Huy chương đồng + 500.000 VND' },
    ],
  });
  await seedPaidRegistrations({
    contestId: timeTrialContestId,
    racerIds: racerIds.map((r) => r.id),
    vehicleIds,
    providerId: context.providerId,
    entryFee: 80000,
    prefix: 'TTA',
  });

  // ─── 3. Grand Prix (Qualifying + Final) — 15 paid + 1 empty slot ───
  const grandPrixContestId = await createContest({
    context,
    name: CONTEST_NAMES.grandPrix,
    description:
      'Thể thức Grand Prix: vòng loại time attack, top 4 vào chung kết đối kháng knockout. ' +
      '15 tay đua đã thanh toán, 1 slot còn trống cho bạn tranh suất chung kết.',
    status: 'OPEN',
    contestTypeId: context.catalog.grandPrixTypeId,
    contestFormatId: context.catalog.qualifyingFinalFormatId,
    contestTemplateId: context.catalog.grandPrixTemplateId,
    registrationOpensAt: new Date(now.getTime() - oneDay),
    registrationClosesAt: new Date(now.getTime() + oneDay * 2),
    startsAt: new Date(now.getTime() + oneDay * 3),
    endsAt: new Date(now.getTime() + oneDay * 3 + 5 * oneHour),
    entryFee: 120000,
    vehiclePolicy: 'MIXED',
    runtimeFormat: 'QUALIFYING_FINAL',
    driversPerMatch: 1,
    leaderboardMode: 'BEST_LAP',
    finalists: 4,
    prizes: [
      { rank: 1, title: 'Grand Champion', description: 'Cúp vô địch + 3.000.000 VND' },
      { rank: 2, title: 'Runner-up', description: 'Huy chương bạc + 1.500.000 VND' },
      { rank: 3, title: 'Third Place', description: 'Huy chương đồng + 800.000 VND' },
    ],
  });
  await seedPaidRegistrations({
    contestId: grandPrixContestId,
    racerIds: racerIds.map((r) => r.id),
    vehicleIds,
    providerId: context.providerId,
    entryFee: 120000,
    prefix: 'GPX',
  });

  // ─── 4. Tonight contest — registration open now until 20:00, then check-in ───
  const tonightDates = buildVnTonightDates();
  const tonightContestId = await createContest({
    context,
    name: CONTEST_NAMES.tonight,
    description:
      'Giải đấu diễn ra tối nay. Đăng ký mở ngay bây giờ và đóng lúc 20:00. Check-in bắt đầu sau 20:00, ' +
      'sân chơi bắt đầu lúc 20:30. Còn 1 slot cuối dành cho bạn đăng ký thật và check-in thật.',
    status: 'OPEN',
    contestTypeId: context.catalog.contestTypeId,
    contestFormatId: context.catalog.knockoutFormatId,
    contestTemplateId: context.catalog.knockoutTemplateId,
    registrationOpensAt: tonightDates.registrationOpensAt,
    registrationClosesAt: tonightDates.registrationClosesAt,
    startsAt: tonightDates.startsAt,
    endsAt: tonightDates.endsAt,
    entryFee: 100000,
    vehiclePolicy: 'MIXED',
    runtimeFormat: 'KNOCKOUT',
    driversPerMatch: 2,
    leaderboardMode: 'KNOCKOUT_WINS',
    prizes: [
      { rank: 1, title: 'Vô địch đêm', description: 'Cúp mini + 500.000 VND' },
      { rank: 2, title: 'Á quân', description: 'Voucher 300.000 VND' },
    ],
  });
  await seedPaidRegistrations({
    contestId: tonightContestId,
    racerIds: racerIds.map((r) => r.id),
    vehicleIds,
    providerId: context.providerId,
    entryFee: 100000,
    prefix: 'TNG',
  });

  logger.info('SeedTonight', 'Created 4 contests with 15 paid registrations each');
  logger.info('SeedTonight', `Test account: ${TEST_RACER.email} / 123456`);
  logger.info(
    'SeedTonight',
    `Tonight contest closes at ${tonightDates.registrationClosesAt.toISOString()} (VN 20:00)`,
  );

  await AppDataSource.destroy();
  logger.info('SeedTonight', 'Done');
}

main().catch((err) => {
  logger.error('SeedTonight', 'Failed', err);
  process.exit(1);
});

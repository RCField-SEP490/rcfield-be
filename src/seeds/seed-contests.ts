import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

const SEED_CONTEST_PREFIX = '[SEED-CONTEST]';
const TEST_CUSTOMERS = [
  { email: 'contest.customer1@gmail.com', full_name: 'Contest Customer 1' },
  { email: 'contest.customer2@gmail.com', full_name: 'Contest Customer 2' },
  { email: 'contest.customer3@gmail.com', full_name: 'Contest Customer 3' },
  { email: 'contest.customer4@gmail.com', full_name: 'Contest Customer 4' },
];

type SeedUser = {
  id: string;
  email: string;
};

type SeedContestCatalog = {
  contestTypeId: string;
  knockoutFormatId: string;
  timeTrialFormatId: string;
  knockoutTemplateId: string;
  timeTrialTemplateId: string;
  driftTrackTypeId: string;
};

type SeedCafe = {
  id: string;
  name: string;
  slug: string;
};

async function ensureContestSchemaReady(): Promise<void> {
  const [{ exists }] = await AppDataSource.query<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'contest_types'
     )`,
  );

  if (!exists) {
    throw new Error(
      'Thiếu bảng contest_types. Hãy chạy npm run migration:run trước khi seed contest.',
    );
  }
}

async function ensureUser(email: string, fullName: string): Promise<SeedUser> {
  const [existing] = await AppDataSource.query<SeedUser[]>(
    `SELECT id, email FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  if (existing) return existing;

  const passwordHash = await bcrypt.hash('123456', 10);
  const [created] = await AppDataSource.query<SeedUser[]>(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'CUSTOMER', TRUE)
     RETURNING id, email`,
    [email, fullName, passwordHash],
  );
  logger.info('Seed', `Created contest user ${email}`);
  return created;
}

async function loadProviderContext(): Promise<{
  providerId: string;
  staffId: string | null;
  cafes: SeedCafe[];
  catalog: SeedContestCatalog;
}> {
  const [provider] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'provider@gmail.com' LIMIT 1`,
  );
  if (!provider) {
    throw new Error('provider@gmail.com không tồn tại. Hãy chạy seed-users.ts trước.');
  }

  const [staff] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'staff@gmail.com' LIMIT 1`,
  );

  const cafes = await AppDataSource.query<SeedCafe[]>(
    `SELECT id, name, slug
     FROM cafes
     WHERE provider_id = $1
     ORDER BY created_at ASC`,
    [provider.id],
  );
  if (cafes.length === 0) {
    throw new Error('Không tìm thấy cafe của provider@gmail.com. Hãy chạy seed-cafes.ts trước.');
  }

  const [contestType] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_types WHERE code = 'PROVIDER_STANDARD' LIMIT 1`,
  );
  const [knockoutFormat] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_formats WHERE code = 'KNOCKOUT' LIMIT 1`,
  );
  const [timeTrialFormat] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_formats WHERE code = 'TIME_TRIAL' LIMIT 1`,
  );
  const [knockoutTemplate] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_templates WHERE code = 'provider_standard_knockout' LIMIT 1`,
  );
  const [timeTrialTemplate] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contest_templates WHERE code = 'provider_standard_time_trial' LIMIT 1`,
  );
  const [driftTrack] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM track_types WHERE code = 'DRIFT' LIMIT 1`,
  );

  if (
    !contestType ||
    !knockoutFormat ||
    !timeTrialFormat ||
    !knockoutTemplate ||
    !timeTrialTemplate ||
    !driftTrack
  ) {
    throw new Error(
      'Thiếu contest catalog hoặc DRIFT track type. Hãy chạy migration contest trước.',
    );
  }

  return {
    providerId: provider.id,
    staffId: staff?.id ?? null,
    cafes,
    catalog: {
      contestTypeId: contestType.id,
      knockoutFormatId: knockoutFormat.id,
      timeTrialFormatId: timeTrialFormat.id,
      knockoutTemplateId: knockoutTemplate.id,
      timeTrialTemplateId: timeTrialTemplate.id,
      driftTrackTypeId: driftTrack.id,
    },
  };
}

async function cleanupSeedContests(): Promise<void> {
  const contests = await AppDataSource.query<{ id: string; name: string }[]>(
    `SELECT id, name FROM contests WHERE name LIKE $1`,
    [`${SEED_CONTEST_PREFIX}%`],
  );
  if (contests.length === 0) return;

  const contestIds = contests.map((item) => item.id);
  await AppDataSource.query(`DELETE FROM contest_audit_logs WHERE contest_id = ANY($1::uuid[])`, [
    contestIds,
  ]);
  await AppDataSource.query(
    `DELETE FROM contest_match_participants
     WHERE match_id IN (
       SELECT id FROM contest_matches WHERE contest_id = ANY($1::uuid[])
     )`,
    [contestIds],
  );
  await AppDataSource.query(`DELETE FROM contest_matches WHERE contest_id = ANY($1::uuid[])`, [
    contestIds,
  ]);
  await AppDataSource.query(
    `DELETE FROM contest_registrations WHERE contest_id = ANY($1::uuid[])`,
    [contestIds],
  );
  await AppDataSource.query(`DELETE FROM contest_cafes WHERE contest_id = ANY($1::uuid[])`, [
    contestIds,
  ]);
  await AppDataSource.query(`DELETE FROM contests WHERE id = ANY($1::uuid[])`, [contestIds]);
  logger.info('Seed', `Cleaned ${contests.length} existing seed contest(s)`);
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
) {
  await AppDataSource.query(
    `INSERT INTO contest_cafes (contest_id, cafe_id, role, display_order, check_in_enabled)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [contestId, cafeId, role, displayOrder],
  );
}

async function insertRegistration(params: {
  contestId: string;
  userId: string;
  vehicleId: string | null;
  status: string;
  paymentStatus: string;
  entryFeeAmount: number;
  checkInCode: string;
  checkedInCafeId?: string | null;
  checkedInBy?: string | null;
  checkedInAt?: Date | null;
  cancellationReason?: string | null;
}): Promise<string> {
  const [registration] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contest_registrations
       (contest_id, user_id, participant_role_snapshot, vehicle_source, vehicle_id, booking_id,
        status, check_in_code, checked_in_cafe_id, checked_in_by, checked_in_at,
        payment_status, entry_fee_amount, entry_fee_due_at, cancelled_by, cancelled_at,
        cancellation_reason, metadata)
     VALUES
       ($1, $2, 'CUSTOMER', 'RENTAL', $3, NULL,
        $4, $5, $6, $7, $8,
        $9, $10, NOW() + INTERVAL '3 days', NULL, NULL,
        $11, $12)
     RETURNING id`,
    [
      params.contestId,
      params.userId,
      params.vehicleId,
      params.status,
      params.checkInCode,
      params.checkedInCafeId ?? null,
      params.checkedInBy ?? null,
      params.checkedInAt ?? null,
      params.paymentStatus,
      params.entryFeeAmount,
      params.cancellationReason ?? null,
      JSON.stringify({ seeded: true }),
    ],
  );
  return registration.id;
}

async function writeAudit(params: {
  contestId: string;
  actorId: string | null;
  actorRole: string | null;
  eventType: string;
  registrationId?: string;
  matchId?: string;
  afterJson?: Record<string, unknown> | null;
  reason?: string | null;
}) {
  await AppDataSource.query(
    `INSERT INTO contest_audit_logs
       (contest_id, registration_id, match_id, actor_id, actor_role, event_type, after_json, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      params.contestId,
      params.registrationId ?? null,
      params.matchId ?? null,
      params.actorId,
      params.actorRole,
      params.eventType,
      JSON.stringify(params.afterJson ?? {}),
      params.reason ?? null,
      JSON.stringify({ seeded: true }),
    ],
  );
}

async function insertMatch(params: {
  contestId: string;
  cafeId: string;
  roundNo: number;
  matchNo: number;
  name: string;
  matchType: string;
  status: string;
  nextMatchId?: string | null;
  scheduledAt: Date;
  createdBy: string;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  advancementRule?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const [match] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contest_matches
       (contest_id, cafe_id, track_config_id, round_no, match_no, name, match_type, status,
        scheduled_at, started_at, ended_at, next_match_id, advancement_rule, result_summary,
        metadata, created_by, decided_by, decided_at)
     VALUES
       ($1, $2, NULL, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17)
     RETURNING id`,
    [
      params.contestId,
      params.cafeId,
      params.roundNo,
      params.matchNo,
      params.name,
      params.matchType,
      params.status,
      params.scheduledAt,
      params.startedAt ?? null,
      params.endedAt ?? null,
      params.nextMatchId ?? null,
      JSON.stringify(params.advancementRule ?? {}),
      JSON.stringify(params.resultSummary ?? {}),
      JSON.stringify(params.metadata ?? { seeded: true }),
      params.createdBy,
      params.decidedBy ?? null,
      params.decidedAt ?? null,
    ],
  );
  return match.id;
}

async function insertMatchParticipant(params: {
  matchId: string;
  registrationId: string;
  slotNo: number;
  lane?: string | null;
  seedNo?: number | null;
  status: string;
  finishPosition?: number | null;
  bestLapMs?: number | null;
  totalTimeMs?: number | null;
  isWinner?: boolean;
}) {
  await AppDataSource.query(
    `INSERT INTO contest_match_participants
       (match_id, registration_id, slot_no, lane, seed_no, status, finish_position,
        best_lap_ms, total_time_ms, is_winner, metadata)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11)`,
    [
      params.matchId,
      params.registrationId,
      params.slotNo,
      params.lane ?? null,
      params.seedNo ?? null,
      params.status,
      params.finishPosition ?? null,
      params.bestLapMs ?? null,
      params.totalTimeMs ?? null,
      params.isWinner ?? false,
      JSON.stringify({ seeded: true }),
    ],
  );
}

async function main() {
  await AppDataSource.initialize();
  logger.database('Connected');

  await ensureContestSchemaReady();
  const { providerId, staffId, cafes, catalog } = await loadProviderContext();
  const [hostCafe, secondaryCafe] = cafes;
  const customers = await Promise.all(
    TEST_CUSTOMERS.map((item) => ensureUser(item.email, item.full_name)),
  );

  const vehicles = await AppDataSource.query<{ id: string; cafe_id: string }[]>(
    `SELECT id, cafe_id
     FROM vehicles
     WHERE cafe_id = ANY($1::uuid[])
     ORDER BY created_at ASC`,
    [cafes.map((item) => item.id)],
  );
  const hostVehicleId = vehicles.find((item) => item.cafe_id === hostCafe.id)?.id ?? null;
  const secondaryVehicleId =
    (secondaryCafe && vehicles.find((item) => item.cafe_id === secondaryCafe.id)?.id) ?? null;

  await cleanupSeedContests();

  const now = new Date();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  const draftContestId = await insertContest({
    cafeId: hostCafe.id,
    providerId,
    name: `${SEED_CONTEST_PREFIX} Draft Provider Setup`,
    description: 'Contest nhap de test managed list va detail cho provider.',
    status: 'DRAFT',
    trackTypeId: catalog.driftTrackTypeId,
    contestTypeId: catalog.contestTypeId,
    contestFormatId: catalog.knockoutFormatId,
    contestTemplateId: catalog.knockoutTemplateId,
    registrationOpensAt: new Date(now.getTime() + oneDay),
    registrationClosesAt: new Date(now.getTime() + oneDay * 2),
    startsAt: new Date(now.getTime() + oneDay * 3),
    endsAt: new Date(now.getTime() + oneDay * 3 + 4 * oneHour),
    capacity: 16,
    entryFee: 150000,
    vehicleRule: { vehicle_policy: 'RENTAL_ONLY', assignment_policy: 'AT_CHECK_IN' },
    config: {
      format: 'KNOCKOUT',
      drivers_per_match: 2,
      seeding_mode: 'MANUAL',
      auto_bye: true,
    },
  });
  await addContestCafe(draftContestId, hostCafe.id, 'HOST', 0);
  if (secondaryCafe) await addContestCafe(draftContestId, secondaryCafe.id, 'PARTICIPATING', 1);
  await writeAudit({
    contestId: draftContestId,
    actorId: providerId,
    actorRole: 'PROVIDER',
    eventType: 'contest.created',
    afterJson: { status: 'DRAFT' },
  });

  const openContestId = await insertContest({
    cafeId: hostCafe.id,
    providerId,
    name: `${SEED_CONTEST_PREFIX} Open Registration Drift Cup`,
    description: 'Contest dang mo de FE test list, detail va registration dashboard.',
    status: 'OPEN',
    trackTypeId: catalog.driftTrackTypeId,
    contestTypeId: catalog.contestTypeId,
    contestFormatId: catalog.knockoutFormatId,
    contestTemplateId: catalog.knockoutTemplateId,
    registrationOpensAt: new Date(now.getTime() - oneDay),
    registrationClosesAt: new Date(now.getTime() + oneDay),
    startsAt: new Date(now.getTime() + oneDay * 2),
    endsAt: new Date(now.getTime() + oneDay * 2 + 5 * oneHour),
    capacity: 16,
    entryFee: 100000,
    vehicleRule: { vehicle_policy: 'RENTAL_ONLY', assignment_policy: 'AT_CHECK_IN' },
    config: {
      format: 'KNOCKOUT',
      drivers_per_match: 2,
      seeding_mode: 'MANUAL',
      auto_bye: true,
      prizes: [
        { rank: 1, title: 'Champion', description: 'Voucher 1.000.000 VND' },
        { rank: 2, title: 'Runner-up', description: 'Voucher 500.000 VND' },
      ],
    },
  });
  await addContestCafe(openContestId, hostCafe.id, 'HOST', 0);
  if (secondaryCafe) await addContestCafe(openContestId, secondaryCafe.id, 'PARTICIPATING', 1);

  const openPendingId = await insertRegistration({
    contestId: openContestId,
    userId: customers[0].id,
    vehicleId: hostVehicleId,
    status: 'PENDING',
    paymentStatus: 'PENDING_PAYMENT',
    entryFeeAmount: 100000,
    checkInCode: 'OPENP001',
  });
  const openConfirmedId = await insertRegistration({
    contestId: openContestId,
    userId: customers[1].id,
    vehicleId: secondaryVehicleId ?? hostVehicleId,
    status: 'CONFIRMED',
    paymentStatus: 'MARKED_PAID',
    entryFeeAmount: 100000,
    checkInCode: 'OPENC001',
  });
  await writeAudit({
    contestId: openContestId,
    actorId: providerId,
    actorRole: 'PROVIDER',
    eventType: 'registration.created',
    registrationId: openPendingId,
    afterJson: { status: 'PENDING' },
  });
  await writeAudit({
    contestId: openContestId,
    actorId: providerId,
    actorRole: 'PROVIDER',
    eventType: 'registration.approved',
    registrationId: openConfirmedId,
    afterJson: { status: 'CONFIRMED' },
  });

  const runningContestId = await insertContest({
    cafeId: hostCafe.id,
    providerId,
    name: `${SEED_CONTEST_PREFIX} Running Knockout Night`,
    description: 'Contest dang runtime de test registrations, matches, audit log va metrics.',
    status: 'RUNNING',
    trackTypeId: catalog.driftTrackTypeId,
    contestTypeId: catalog.contestTypeId,
    contestFormatId: catalog.knockoutFormatId,
    contestTemplateId: catalog.knockoutTemplateId,
    registrationOpensAt: new Date(now.getTime() - oneDay * 4),
    registrationClosesAt: new Date(now.getTime() - oneDay * 2),
    startsAt: new Date(now.getTime() - 6 * oneHour),
    endsAt: new Date(now.getTime() + 6 * oneHour),
    capacity: 8,
    entryFee: 0,
    vehicleRule: { vehicle_policy: 'RENTAL_ONLY', assignment_policy: 'AT_CHECK_IN' },
    config: {
      format: 'KNOCKOUT',
      drivers_per_match: 2,
      seeding_mode: 'CHECK_IN_ORDER',
      auto_bye: true,
      leaderboard_mode: 'KNOCKOUT_WINS',
    },
  });
  await addContestCafe(runningContestId, hostCafe.id, 'HOST', 0);

  const runningRegs = await Promise.all([
    insertRegistration({
      contestId: runningContestId,
      userId: customers[0].id,
      vehicleId: hostVehicleId,
      status: 'CHECKED_IN',
      paymentStatus: 'NOT_REQUIRED',
      entryFeeAmount: 0,
      checkInCode: 'RUNN001',
      checkedInCafeId: hostCafe.id,
      checkedInBy: staffId ?? providerId,
      checkedInAt: new Date(now.getTime() - 7 * oneHour),
    }),
    insertRegistration({
      contestId: runningContestId,
      userId: customers[1].id,
      vehicleId: hostVehicleId,
      status: 'CHECKED_IN',
      paymentStatus: 'NOT_REQUIRED',
      entryFeeAmount: 0,
      checkInCode: 'RUNN002',
      checkedInCafeId: hostCafe.id,
      checkedInBy: staffId ?? providerId,
      checkedInAt: new Date(now.getTime() - 7 * oneHour + 5 * 60 * 1000),
    }),
    insertRegistration({
      contestId: runningContestId,
      userId: customers[2].id,
      vehicleId: hostVehicleId,
      status: 'CHECKED_IN',
      paymentStatus: 'NOT_REQUIRED',
      entryFeeAmount: 0,
      checkInCode: 'RUNN003',
      checkedInCafeId: hostCafe.id,
      checkedInBy: staffId ?? providerId,
      checkedInAt: new Date(now.getTime() - 7 * oneHour + 10 * 60 * 1000),
    }),
    insertRegistration({
      contestId: runningContestId,
      userId: customers[3].id,
      vehicleId: hostVehicleId,
      status: 'CHECKED_IN',
      paymentStatus: 'NOT_REQUIRED',
      entryFeeAmount: 0,
      checkInCode: 'RUNN004',
      checkedInCafeId: hostCafe.id,
      checkedInBy: staffId ?? providerId,
      checkedInAt: new Date(now.getTime() - 7 * oneHour + 15 * 60 * 1000),
    }),
  ]);

  const runningFinalId = await insertMatch({
    contestId: runningContestId,
    cafeId: hostCafe.id,
    roundNo: 2,
    matchNo: 1,
    name: 'Final 1',
    matchType: 'FINAL',
    status: 'DRAFT',
    scheduledAt: new Date(now.getTime() + oneHour),
    createdBy: providerId,
    advancementRule: { winners_to_advance: 0, format: 'KNOCKOUT' },
  });
  const runningSemi1Id = await insertMatch({
    contestId: runningContestId,
    cafeId: hostCafe.id,
    roundNo: 1,
    matchNo: 1,
    name: 'Round 1 Match 1',
    matchType: 'HEAD_TO_HEAD',
    status: 'COMPLETED',
    nextMatchId: runningFinalId,
    scheduledAt: new Date(now.getTime() - 2 * oneHour),
    startedAt: new Date(now.getTime() - 110 * 60 * 1000),
    endedAt: new Date(now.getTime() - 100 * 60 * 1000),
    decidedAt: new Date(now.getTime() - 100 * 60 * 1000),
    createdBy: providerId,
    decidedBy: providerId,
    advancementRule: { winners_to_advance: 1, format: 'KNOCKOUT' },
    resultSummary: { winner_registration_id: runningRegs[0], participants_count: 2 },
  });
  const runningSemi2Id = await insertMatch({
    contestId: runningContestId,
    cafeId: hostCafe.id,
    roundNo: 1,
    matchNo: 2,
    name: 'Round 1 Match 2',
    matchType: 'HEAD_TO_HEAD',
    status: 'READY',
    nextMatchId: runningFinalId,
    scheduledAt: new Date(now.getTime() + 30 * 60 * 1000),
    createdBy: providerId,
    advancementRule: { winners_to_advance: 1, format: 'KNOCKOUT' },
  });

  await insertMatchParticipant({
    matchId: runningSemi1Id,
    registrationId: runningRegs[0],
    slotNo: 1,
    lane: 'L1',
    seedNo: 1,
    status: 'FINISHED',
    finishPosition: 1,
    isWinner: true,
  });
  await insertMatchParticipant({
    matchId: runningSemi1Id,
    registrationId: runningRegs[1],
    slotNo: 2,
    lane: 'L2',
    seedNo: 2,
    status: 'FINISHED',
    finishPosition: 2,
    isWinner: false,
  });
  await insertMatchParticipant({
    matchId: runningSemi2Id,
    registrationId: runningRegs[2],
    slotNo: 1,
    lane: 'L1',
    seedNo: 3,
    status: 'READY',
  });
  await insertMatchParticipant({
    matchId: runningSemi2Id,
    registrationId: runningRegs[3],
    slotNo: 2,
    lane: 'L2',
    seedNo: 4,
    status: 'READY',
  });
  await insertMatchParticipant({
    matchId: runningFinalId,
    registrationId: runningRegs[0],
    slotNo: 1,
    lane: 'L1',
    seedNo: 1,
    status: 'READY',
  });
  await writeAudit({
    contestId: runningContestId,
    actorId: providerId,
    actorRole: 'PROVIDER',
    eventType: 'contest.matches_generated',
    afterJson: { generated_match_count: 3 },
  });
  await writeAudit({
    contestId: runningContestId,
    actorId: providerId,
    actorRole: 'PROVIDER',
    eventType: 'match.results_submitted',
    matchId: runningSemi1Id,
    afterJson: { status: 'COMPLETED' },
  });
  await writeAudit({
    contestId: runningContestId,
    actorId: providerId,
    actorRole: 'PROVIDER',
    eventType: 'match.advanced',
    matchId: runningSemi1Id,
    afterJson: { next_match_id: runningFinalId, winners: [runningRegs[0]] },
  });

  const completedContestId = await insertContest({
    cafeId: hostCafe.id,
    providerId,
    name: `${SEED_CONTEST_PREFIX} Completed Time Trial Finals`,
    description: 'Contest da publish leaderboard de FE test detail, metrics va ranking.',
    status: 'COMPLETED',
    trackTypeId: catalog.driftTrackTypeId,
    contestTypeId: catalog.contestTypeId,
    contestFormatId: catalog.timeTrialFormatId,
    contestTemplateId: catalog.timeTrialTemplateId,
    registrationOpensAt: new Date(now.getTime() - oneDay * 8),
    registrationClosesAt: new Date(now.getTime() - oneDay * 6),
    startsAt: new Date(now.getTime() - oneDay * 5),
    endsAt: new Date(now.getTime() - oneDay * 5 + 3 * oneHour),
    capacity: 12,
    entryFee: 0,
    vehicleRule: { vehicle_policy: 'RENTAL_ONLY', assignment_policy: 'AT_CHECK_IN' },
    config: {
      format: 'TIME_TRIAL',
      drivers_per_match: 1,
      seeding_mode: 'CHECK_IN_ORDER',
      leaderboard_mode: 'BEST_LAP',
      published_leaderboard: {
        mode: 'BEST_LAP',
        match_count: 3,
        published_at: new Date(now.getTime() - oneDay * 4).toISOString(),
        published_by: providerId,
        entries: [
          {
            rank: 1,
            registration_id: 'seed-registration-a',
            wins: 1,
            best_lap_ms: 31880,
            total_time_ms: 31880,
            latest_finish_position: 1,
            matches_completed: 1,
            progressed_round: 1,
          },
          {
            rank: 2,
            registration_id: 'seed-registration-b',
            wins: 1,
            best_lap_ms: 32540,
            total_time_ms: 32540,
            latest_finish_position: 1,
            matches_completed: 1,
            progressed_round: 1,
          },
          {
            rank: 3,
            registration_id: 'seed-registration-c',
            wins: 1,
            best_lap_ms: 33990,
            total_time_ms: 33990,
            latest_finish_position: 1,
            matches_completed: 1,
            progressed_round: 1,
          },
        ],
      },
    },
  });
  await addContestCafe(completedContestId, hostCafe.id, 'HOST', 0);

  const completedRegs = await Promise.all([
    insertRegistration({
      contestId: completedContestId,
      userId: customers[0].id,
      vehicleId: hostVehicleId,
      status: 'CHECKED_IN',
      paymentStatus: 'NOT_REQUIRED',
      entryFeeAmount: 0,
      checkInCode: 'TIME001',
      checkedInCafeId: hostCafe.id,
      checkedInBy: staffId ?? providerId,
      checkedInAt: new Date(now.getTime() - oneDay * 5 - oneHour),
    }),
    insertRegistration({
      contestId: completedContestId,
      userId: customers[1].id,
      vehicleId: hostVehicleId,
      status: 'CHECKED_IN',
      paymentStatus: 'NOT_REQUIRED',
      entryFeeAmount: 0,
      checkInCode: 'TIME002',
      checkedInCafeId: hostCafe.id,
      checkedInBy: staffId ?? providerId,
      checkedInAt: new Date(now.getTime() - oneDay * 5 - oneHour + 5 * 60 * 1000),
    }),
    insertRegistration({
      contestId: completedContestId,
      userId: customers[2].id,
      vehicleId: hostVehicleId,
      status: 'CHECKED_IN',
      paymentStatus: 'NOT_REQUIRED',
      entryFeeAmount: 0,
      checkInCode: 'TIME003',
      checkedInCafeId: hostCafe.id,
      checkedInBy: staffId ?? providerId,
      checkedInAt: new Date(now.getTime() - oneDay * 5 - oneHour + 10 * 60 * 1000),
    }),
  ]);

  await AppDataSource.query(
    `UPDATE contests
     SET config = jsonb_set(
       config,
       '{published_leaderboard,entries}',
       $2::jsonb
     )
     WHERE id = $1`,
    [
      completedContestId,
      JSON.stringify([
        {
          rank: 1,
          registration_id: completedRegs[0],
          wins: 1,
          best_lap_ms: 31880,
          total_time_ms: 31880,
          latest_finish_position: 1,
          matches_completed: 1,
          progressed_round: 1,
        },
        {
          rank: 2,
          registration_id: completedRegs[1],
          wins: 1,
          best_lap_ms: 32540,
          total_time_ms: 32540,
          latest_finish_position: 1,
          matches_completed: 1,
          progressed_round: 1,
        },
        {
          rank: 3,
          registration_id: completedRegs[2],
          wins: 1,
          best_lap_ms: 33990,
          total_time_ms: 33990,
          latest_finish_position: 1,
          matches_completed: 1,
          progressed_round: 1,
        },
      ]),
    ],
  );

  const timeMatchA = await insertMatch({
    contestId: completedContestId,
    cafeId: hostCafe.id,
    roundNo: 1,
    matchNo: 1,
    name: 'Time Trial 1',
    matchType: 'TIME_ATTACK',
    status: 'COMPLETED',
    scheduledAt: new Date(now.getTime() - oneDay * 5),
    startedAt: new Date(now.getTime() - oneDay * 5),
    endedAt: new Date(now.getTime() - oneDay * 5 + 10 * 60 * 1000),
    decidedAt: new Date(now.getTime() - oneDay * 5 + 10 * 60 * 1000),
    createdBy: providerId,
    decidedBy: providerId,
    advancementRule: { winners_to_advance: 0, format: 'TIME_TRIAL' },
    resultSummary: {
      leaderboard_mode: 'BEST_LAP',
      winner_registration_id: completedRegs[0],
      best_lap_ms: 31880,
      total_time_ms: 31880,
    },
  });
  const timeMatchB = await insertMatch({
    contestId: completedContestId,
    cafeId: hostCafe.id,
    roundNo: 1,
    matchNo: 2,
    name: 'Time Trial 2',
    matchType: 'TIME_ATTACK',
    status: 'COMPLETED',
    scheduledAt: new Date(now.getTime() - oneDay * 5 + 15 * 60 * 1000),
    startedAt: new Date(now.getTime() - oneDay * 5 + 15 * 60 * 1000),
    endedAt: new Date(now.getTime() - oneDay * 5 + 25 * 60 * 1000),
    decidedAt: new Date(now.getTime() - oneDay * 5 + 25 * 60 * 1000),
    createdBy: providerId,
    decidedBy: providerId,
    advancementRule: { winners_to_advance: 0, format: 'TIME_TRIAL' },
    resultSummary: {
      leaderboard_mode: 'BEST_LAP',
      winner_registration_id: completedRegs[1],
      best_lap_ms: 32540,
      total_time_ms: 32540,
    },
  });
  const timeMatchC = await insertMatch({
    contestId: completedContestId,
    cafeId: hostCafe.id,
    roundNo: 1,
    matchNo: 3,
    name: 'Time Trial 3',
    matchType: 'TIME_ATTACK',
    status: 'COMPLETED',
    scheduledAt: new Date(now.getTime() - oneDay * 5 + 30 * 60 * 1000),
    startedAt: new Date(now.getTime() - oneDay * 5 + 30 * 60 * 1000),
    endedAt: new Date(now.getTime() - oneDay * 5 + 40 * 60 * 1000),
    decidedAt: new Date(now.getTime() - oneDay * 5 + 40 * 60 * 1000),
    createdBy: providerId,
    decidedBy: providerId,
    advancementRule: { winners_to_advance: 0, format: 'TIME_TRIAL' },
    resultSummary: {
      leaderboard_mode: 'BEST_LAP',
      winner_registration_id: completedRegs[2],
      best_lap_ms: 33990,
      total_time_ms: 33990,
    },
  });

  await insertMatchParticipant({
    matchId: timeMatchA,
    registrationId: completedRegs[0],
    slotNo: 1,
    seedNo: 1,
    status: 'FINISHED',
    finishPosition: 1,
    bestLapMs: 31880,
    totalTimeMs: 31880,
    isWinner: true,
  });
  await insertMatchParticipant({
    matchId: timeMatchB,
    registrationId: completedRegs[1],
    slotNo: 1,
    seedNo: 2,
    status: 'FINISHED',
    finishPosition: 1,
    bestLapMs: 32540,
    totalTimeMs: 32540,
    isWinner: true,
  });
  await insertMatchParticipant({
    matchId: timeMatchC,
    registrationId: completedRegs[2],
    slotNo: 1,
    seedNo: 3,
    status: 'FINISHED',
    finishPosition: 1,
    bestLapMs: 33990,
    totalTimeMs: 33990,
    isWinner: true,
  });
  await writeAudit({
    contestId: completedContestId,
    actorId: providerId,
    actorRole: 'PROVIDER',
    eventType: 'contest.leaderboard_published',
    afterJson: { published: true },
  });

  logger.info('Seed', `Contest seed ready for provider@gmail.com at cafe ${hostCafe.slug}`);
  logger.info('Seed', `Draft contest: ${draftContestId}`);
  logger.info('Seed', `Open contest: ${openContestId}`);
  logger.info('Seed', `Running contest: ${runningContestId}`);
  logger.info('Seed', `Completed contest: ${completedContestId}`);

  await AppDataSource.destroy();
}

main().catch((error) => {
  logger.error('Seed', 'Failed seeding contests', error);
  process.exit(1);
});

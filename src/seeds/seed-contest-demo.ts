import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

const PASSWORD = '123456';
const PROVIDER_EMAIL = 'contest_provider@gmail.com';
const STAFF_EMAIL = 'contest_staff@gmail.com';
const PLAYER_EMAILS = Array.from(
  { length: 8 },
  (_, index) => `contest_player${String(index + 1).padStart(2, '0')}@gmail.com`,
);
const CAFE_SLUG = 'contest-demo-arena';
const CONTEST_NAME = 'RCField Demo Knockout Cup';

interface IdRow {
  id: string;
}

async function upsertUser(
  email: string,
  fullName: string,
  role: 'PROVIDER' | 'STAFF' | 'CUSTOMER',
  passwordHash: string,
): Promise<string> {
  const [existing] = await AppDataSource.query<IdRow[]>(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);
  if (existing) return existing.id;

  const [created] = await AppDataSource.query<IdRow[]>(
    `INSERT INTO users (email, full_name, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id`,
    [email, fullName, passwordHash, role],
  );
  logger.info('ContestDemoSeed', `Created ${role}: ${email}`);
  return created.id;
}

async function ensureProviderProfile(providerId: string): Promise<void> {
  const [existing] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM provider_profiles WHERE user_id = $1`,
    [providerId],
  );
  if (existing) return;

  await AppDataSource.query(
    `INSERT INTO provider_profiles (user_id, business_name, registration_status)
     VALUES ($1, $2, 'ACTIVE')`,
    [providerId, 'Contest Demo Provider'],
  );
}

async function ensureSubscription(providerId: string): Promise<void> {
  const [existing] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM provider_subscriptions WHERE provider_id = $1 AND deleted_at IS NULL`,
    [providerId],
  );
  if (existing) return;

  const [plan] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM subscription_plans WHERE name = 'TRIAL' LIMIT 1`,
  );
  if (!plan) {
    logger.warn('ContestDemoSeed', 'Skip subscription: TRIAL plan is not available');
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const quotaResetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  await AppDataSource.query(
    `INSERT INTO provider_subscriptions
       (provider_id, plan_id, status, started_at, expires_at, ai_quota_reset_at)
     VALUES ($1, $2, 'TRIAL', $3, $4, $5)`,
    [providerId, plan.id, now, expiresAt, quotaResetAt],
  );
}

async function getDriftTrackTypeId(): Promise<string> {
  const [trackType] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM track_types WHERE code = 'DRIFT' AND is_active = TRUE LIMIT 1`,
  );
  if (!trackType) {
    throw new Error('Missing active DRIFT track type. Run migrations before contest demo seed.');
  }
  return trackType.id;
}

async function ensureCafe(providerId: string, trackTypeId: string): Promise<string> {
  const [existing] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM cafes WHERE slug = $1 LIMIT 1`,
    [CAFE_SLUG],
  );
  if (existing) {
    await AppDataSource.query(
      `UPDATE cafes
       SET provider_id = $1, status = 'ACTIVE', track_types = $2, updated_at = NOW()
       WHERE id = $3`,
      [providerId, [trackTypeId], existing.id],
    );
    return existing.id;
  }

  const [created] = await AppDataSource.query<IdRow[]>(
    `INSERT INTO cafes (
       provider_id, name, slug, description, phone, status,
       address, district, city, latitude, longitude,
       operating_hours, track_types,
       slot_duration_minutes, slot_fee_rate, max_concurrent_bookings,
       min_booking_notice_minutes, byoc_capacity
     ) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      providerId,
      'Contest Demo Arena',
      CAFE_SLUG,
      'Chi nhanh demo cho luong contest knockout 8 nguoi.',
      '0900000000',
      '123 Demo Street',
      'Quan Demo',
      'Ho Chi Minh',
      10.762622,
      106.660172,
      JSON.stringify({
        mon: { open: '09:00', close: '22:00' },
        tue: { open: '09:00', close: '22:00' },
        wed: { open: '09:00', close: '22:00' },
        thu: { open: '09:00', close: '22:00' },
        fri: { open: '09:00', close: '23:00' },
        sat: { open: '08:00', close: '23:00' },
        sun: { open: '08:00', close: '22:00' },
      }),
      [trackTypeId],
      60,
      50000,
      12,
      30,
      10,
    ],
  );
  return created.id;
}

async function ensureStaffAssignment(
  staffId: string,
  cafeId: string,
  providerId: string,
): Promise<void> {
  const [existing] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM staff_cafe_assignments WHERE staff_id = $1`,
    [staffId],
  );
  if (existing) {
    await AppDataSource.query(
      `UPDATE staff_cafe_assignments SET cafe_id = $1, assigned_by = $2 WHERE id = $3`,
      [cafeId, providerId, existing.id],
    );
    return;
  }

  await AppDataSource.query(
    `INSERT INTO staff_cafe_assignments (staff_id, cafe_id, assigned_by)
     VALUES ($1, $2, $3)`,
    [staffId, cafeId, providerId],
  );
}

async function ensureContest(
  providerId: string,
  cafeId: string,
  trackTypeId: string,
): Promise<string> {
  const [existing] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM contests WHERE provider_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
    [providerId, CONTEST_NAME],
  );

  const now = new Date();
  const startsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);
  const registrationClosesAt = new Date(startsAt.getTime() - 60 * 60 * 1000);

  let contestId: string;
  if (existing) {
    contestId = existing.id;
    await AppDataSource.query(
      `UPDATE contests
       SET track_type_id = $1,
           status = 'OPEN',
           starts_at = $2,
           ends_at = $3,
           registration_opens_at = $4,
           registration_closes_at = $5,
           capacity = 8,
           entry_fee = 0,
           banner_image_url = NULL,
           vehicle_rule = $6,
           config = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [
        trackTypeId,
        startsAt,
        endsAt,
        now,
        registrationClosesAt,
        JSON.stringify({ source: 'BYOC', note: 'Demo accepts BYOC cars' }),
        JSON.stringify({ demo: true, bracket_size: 8 }),
        contestId,
      ],
    );
  } else {
    const [created] = await AppDataSource.query<IdRow[]>(
      `INSERT INTO contests (
         provider_id, name, description, track_type_id, vehicle_rule,
         starts_at, ends_at, registration_opens_at, registration_closes_at,
         capacity, entry_fee, status, banner_image_url, config, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,8,0,'OPEN',$10,$11,$12)
       RETURNING id`,
      [
        providerId,
        CONTEST_NAME,
        'Demo contest seeded with 8 checked-in players and knockout bracket.',
        trackTypeId,
        JSON.stringify({ source: 'BYOC', note: 'Demo accepts BYOC cars' }),
        startsAt,
        endsAt,
        now,
        registrationClosesAt,
        null,
        JSON.stringify({ demo: true, bracket_size: 8 }),
        providerId,
      ],
    );
    contestId = created.id;
  }

  await AppDataSource.query(
    `INSERT INTO contest_cafes (contest_id, cafe_id, role, display_order)
     VALUES ($1, $2, 'HOST', 0)
     ON CONFLICT (contest_id, cafe_id) DO UPDATE
       SET role = EXCLUDED.role, display_order = EXCLUDED.display_order, updated_at = NOW()`,
    [contestId, cafeId],
  );

  return contestId;
}

async function ensureRegistrations(
  contestId: string,
  cafeId: string,
  staffId: string,
  playerIds: string[],
): Promise<string[]> {
  const registrationIds: string[] = [];
  for (const [index, userId] of playerIds.entries()) {
    const [existing] = await AppDataSource.query<IdRow[]>(
      `SELECT id FROM contest_registrations WHERE contest_id = $1 AND user_id = $2`,
      [contestId, userId],
    );
    const checkInCode = `DEMO-${String(index + 1).padStart(2, '0')}-${contestId.slice(0, 8)}`;

    if (existing) {
      await AppDataSource.query(
        `UPDATE contest_registrations
         SET status = 'CHECKED_IN',
             participant_role_snapshot = 'CUSTOMER',
             vehicle_source = 'BYOC',
             checked_in_cafe_id = $1,
             checked_in_by = $2,
             checked_in_at = COALESCE(checked_in_at, NOW()),
             cancelled_by = NULL,
             cancelled_at = NULL,
             cancellation_reason = NULL,
             metadata = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [cafeId, staffId, JSON.stringify({ demo_seed: true, seed: index + 1 }), existing.id],
      );
      registrationIds.push(existing.id);
      continue;
    }

    const [created] = await AppDataSource.query<IdRow[]>(
      `INSERT INTO contest_registrations (
         contest_id, user_id, participant_role_snapshot, vehicle_source, status,
         check_in_code, checked_in_cafe_id, checked_in_by, checked_in_at, metadata
       ) VALUES ($1,$2,'CUSTOMER','BYOC','CHECKED_IN',$3,$4,$5,NOW(),$6)
       RETURNING id`,
      [
        contestId,
        userId,
        checkInCode,
        cafeId,
        staffId,
        JSON.stringify({ demo_seed: true, seed: index + 1 }),
      ],
    );
    registrationIds.push(created.id);
  }
  return registrationIds;
}

async function ensureMatch(
  contestId: string,
  roundNo: number,
  matchNo: number,
  name: string,
  matchType: 'HEAD_TO_HEAD' | 'FINAL',
  nextMatchId: string | null,
  metadata: Record<string, unknown>,
): Promise<string> {
  const [existing] = await AppDataSource.query<IdRow[]>(
    `SELECT id FROM contest_matches WHERE contest_id = $1 AND round_no = $2 AND match_no = $3`,
    [contestId, roundNo, matchNo],
  );
  if (existing) {
    await AppDataSource.query(
      `UPDATE contest_matches
       SET name = $1,
           match_type = $2,
           status = 'READY',
           next_match_id = $3,
           advancement_rule = $4,
           result_summary = '{}'::jsonb,
           metadata = $5,
           decided_by = NULL,
           decided_at = NULL,
           updated_at = NOW()
       WHERE id = $6`,
      [
        name,
        matchType,
        nextMatchId,
        JSON.stringify({ top_n: 1 }),
        JSON.stringify(metadata),
        existing.id,
      ],
    );
    return existing.id;
  }

  const [created] = await AppDataSource.query<IdRow[]>(
    `INSERT INTO contest_matches (
       contest_id, round_no, match_no, name, match_type, status,
       next_match_id, advancement_rule, metadata
     ) VALUES ($1,$2,$3,$4,$5,'READY',$6,$7,$8)
     RETURNING id`,
    [
      contestId,
      roundNo,
      matchNo,
      name,
      matchType,
      nextMatchId,
      JSON.stringify({ top_n: 1 }),
      JSON.stringify(metadata),
    ],
  );
  return created.id;
}

async function resetMatchParticipants(matchId: string, registrationIds: string[]): Promise<void> {
  await AppDataSource.query(`DELETE FROM contest_match_participants WHERE match_id = $1`, [
    matchId,
  ]);
  for (const [index, registrationId] of registrationIds.entries()) {
    await AppDataSource.query(
      `INSERT INTO contest_match_participants (
         match_id, registration_id, slot_no, lane, grid_position, seed_no, status, metadata
       ) VALUES ($1,$2,$3,$4,$3,$3,'READY',$5)`,
      [
        matchId,
        registrationId,
        index + 1,
        String.fromCharCode(65 + index),
        JSON.stringify({ demo_seed: true }),
      ],
    );
  }
}

async function seedBracket(contestId: string, registrationIds: string[]) {
  const finalMatchId = await ensureMatch(contestId, 3, 1, 'Final', 'FINAL', null, {
    stage: 'FINAL',
  });
  const semi1Id = await ensureMatch(contestId, 2, 1, 'Semi Final 1', 'HEAD_TO_HEAD', finalMatchId, {
    stage: 'SEMI_FINAL',
  });
  const semi2Id = await ensureMatch(contestId, 2, 2, 'Semi Final 2', 'HEAD_TO_HEAD', finalMatchId, {
    stage: 'SEMI_FINAL',
  });

  const quarter1Id = await ensureMatch(
    contestId,
    1,
    1,
    'Quarter Final 1',
    'HEAD_TO_HEAD',
    semi1Id,
    {
      stage: 'QUARTER_FINAL',
      seed_pair: [1, 8],
    },
  );
  const quarter2Id = await ensureMatch(
    contestId,
    1,
    2,
    'Quarter Final 2',
    'HEAD_TO_HEAD',
    semi1Id,
    {
      stage: 'QUARTER_FINAL',
      seed_pair: [4, 5],
    },
  );
  const quarter3Id = await ensureMatch(
    contestId,
    1,
    3,
    'Quarter Final 3',
    'HEAD_TO_HEAD',
    semi2Id,
    {
      stage: 'QUARTER_FINAL',
      seed_pair: [2, 7],
    },
  );
  const quarter4Id = await ensureMatch(
    contestId,
    1,
    4,
    'Quarter Final 4',
    'HEAD_TO_HEAD',
    semi2Id,
    {
      stage: 'QUARTER_FINAL',
      seed_pair: [3, 6],
    },
  );

  await resetMatchParticipants(quarter1Id, [registrationIds[0], registrationIds[1]]);
  await resetMatchParticipants(quarter2Id, [registrationIds[2], registrationIds[3]]);
  await resetMatchParticipants(quarter3Id, [registrationIds[4], registrationIds[5]]);
  await resetMatchParticipants(quarter4Id, [registrationIds[6], registrationIds[7]]);

  return { quarter1Id, quarter2Id, quarter3Id, quarter4Id, semi1Id, semi2Id, finalMatchId };
}
async function seed() {
  await AppDataSource.initialize();
  logger.database('Connected');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const providerId = await upsertUser(
    PROVIDER_EMAIL,
    'Contest Demo Provider',
    'PROVIDER',
    passwordHash,
  );
  const staffId = await upsertUser(STAFF_EMAIL, 'Contest Demo Staff', 'STAFF', passwordHash);
  const playerIds = [];
  for (const [index, email] of PLAYER_EMAILS.entries()) {
    playerIds.push(
      await upsertUser(email, `Contest Player ${index + 1}`, 'CUSTOMER', passwordHash),
    );
  }

  await ensureProviderProfile(providerId);
  await ensureSubscription(providerId);
  const trackTypeId = await getDriftTrackTypeId();
  const cafeId = await ensureCafe(providerId, trackTypeId);
  await ensureStaffAssignment(staffId, cafeId, providerId);
  const contestId = await ensureContest(providerId, cafeId, trackTypeId);
  const registrationIds = await ensureRegistrations(contestId, cafeId, staffId, playerIds);
  const bracket = await seedBracket(contestId, registrationIds);

  await AppDataSource.destroy();
  logger.info('ContestDemoSeed', 'Done');
  logger.info('ContestDemoSeed', `Provider: ${PROVIDER_EMAIL} / ${PASSWORD}`);
  logger.info('ContestDemoSeed', `Staff:    ${STAFF_EMAIL} / ${PASSWORD}`);
  logger.info('ContestDemoSeed', `Players:  contest_player01..08@gmail.com / ${PASSWORD}`);
  logger.info('ContestDemoSeed', `Cafe ID:  ${cafeId}`);
  logger.info('ContestDemoSeed', `Contest:  ${contestId}`);
  logger.info('ContestDemoSeed', `Bracket:  ${JSON.stringify(bracket)}`);
}

seed().catch(async (err) => {
  logger.error('ContestDemoSeed', 'Failed', err);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});

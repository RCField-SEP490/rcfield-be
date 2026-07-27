import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

/**
 * Chạy FULL luồng contest end-to-end qua HTTP API thật (dev server localhost:3000):
 *
 *   provider tạo contest → open → racer đăng ký đủ 3 nguồn xe
 *   (BYOC khai báo / booking thuê có sẵn WF-A / thuê inline WF-B)
 *   → mock-checkout booking thuê → (mark-entry-fee-paid nếu có phí)
 *   → approve → close → check-in → generate matches → submit results
 *   → advance → publish leaderboard → contest COMPLETED
 *
 * Cover 3 format: KNOCKOUT, TIME_TRIAL, GRAND_PRIX (QUALIFYING_FINAL).
 * Ghi vào DEV DB (có thể xem lại trên UI). Idempotent: xoá contest [FLOW-E2E]% cũ.
 *
 * Chạy: npm run test:contest-flow (cần dev server đang chạy + seed:cafes đã có).
 */

const API_BASE = process.env.FLOW_API_BASE ?? 'http://localhost:3000/api/v1';
const FLOW_PREFIX = '[FLOW-E2E]';
const PASSWORD = '123456';

const RACERS = [
  { key: 'minhtri', email: 'minhtri.nguyen.racer@gmail.com', fullName: 'Nguyễn Minh Trí' },
  { key: 'quocbao', email: 'quocbao.tran.racer@gmail.com', fullName: 'Trần Quốc Bảo' },
  { key: 'giahuy', email: 'giahuy.le.racer@gmail.com', fullName: 'Lê Gia Huy' },
  { key: 'hoangnam', email: 'hoangnam.pham.racer@gmail.com', fullName: 'Phạm Hoàng Nam' },
  { key: 'thanhdat', email: 'thanhdat.do.racer@gmail.com', fullName: 'Đỗ Thành Đạt' },
  { key: 'anhquan', email: 'anhquan.vo.racer@gmail.com', fullName: 'Võ Anh Quân' },
  { key: 'duckhang', email: 'duckhang.bui.racer@gmail.com', fullName: 'Bùi Đức Khang' },
  { key: 'tuananh', email: 'tuananh.dang.racer@gmail.com', fullName: 'Đặng Tuấn Anh' },
] as const;

type RacerKey = (typeof RACERS)[number]['key'];

// ─── HTTP helpers ────────────────────────────────────────────────────────────

type ApiOptions = { token?: string; body?: unknown };

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json: { success?: boolean; data?: T; message?: string; code?: string };
  try {
    json = (text ? JSON.parse(text) : {}) as typeof json;
  } catch {
    throw new Error(`${method} ${path} → HTTP ${res.status}: non-JSON body: ${text.slice(0, 300)}`);
  }
  if (!res.ok || json.success === false) {
    throw new Error(
      `${method} ${path} → HTTP ${res.status}: ${json.message ?? text.slice(0, 300)} (${json.code ?? 'UNKNOWN'})`,
    );
  }
  return (json.data ?? (json as unknown as T)) as T;
}

async function login(email: string): Promise<string> {
  const data = await api<{ access_token: string }>('POST', '/auth/login', {
    body: { email, password: PASSWORD },
  });
  return data.access_token;
}

// ─── Logging ─────────────────────────────────────────────────────────────────

let stepNo = 0;
function step(message: string) {
  stepNo += 1;
  logger.info('Flow', `  ✓ [${String(stepNo).padStart(2, '0')}] ${message}`);
}
function section(title: string) {
  logger.info('Flow', `\n═══ ${title} ${'═'.repeat(Math.max(4, 60 - title.length))}`);
}

// ─── DB helpers (catalog lookup, time shift, cleanup) ────────────────────────

async function sqlOne<T extends Record<string, unknown>>(
  query: string,
  params?: unknown[],
): Promise<T> {
  const rows = (await AppDataSource.query(query, params)) as T[];
  if (rows.length === 0) throw new Error(`SQL trả về 0 dòng: ${query.slice(0, 120)}`);
  return rows[0];
}

async function idOf(table: string, code: string): Promise<string> {
  const row = await sqlOne<{ id: string }>(`SELECT id FROM ${table} WHERE code = $1 LIMIT 1`, [
    code,
  ]);
  return row.id;
}

/** Check-in yêu cầu starts_at ≤ now ≤ ends_at — dồn khung giờ thi về hiện tại. */
async function shiftContestWindowToNow(contestId: string) {
  await AppDataSource.query(
    `UPDATE contests
     SET registration_closes_at = NOW() - INTERVAL '10 minutes',
         starts_at = NOW() - INTERVAL '5 minutes',
         ends_at = NOW() + INTERVAL '6 hours'
     WHERE id = $1`,
    [contestId],
  );
}

/**
 * BE gap: getRuntimeFormatFromCatalog() map mọi format ≠ TIME_TRIAL thành KNOCKOUT,
 * nên contest GRAND_PRIX tạo qua API có runtime_format=KNOCKOUT và engine chạy sai.
 * Patch config về QUALIFYING_FINAL (giống dữ liệu seed qua SQL) để đúng engine.
 */
async function forceRuntimeFormat(contestId: string, format: 'QUALIFYING_FINAL') {
  await AppDataSource.query(
    `UPDATE contests
     SET config = jsonb_set(jsonb_set(config, '{format}', to_jsonb($2::text)), '{runtime_format}', to_jsonb($2::text))
     WHERE id = $1`,
    [contestId, format],
  );
}

async function cleanupFlowContests() {
  const contests = (await AppDataSource.query(`SELECT id FROM contests WHERE name LIKE $1`, [
    `${FLOW_PREFIX}%`,
  ])) as { id: string }[];
  if (contests.length === 0) return;
  const ids = contests.map((item) => item.id);
  const run = (query: string) => AppDataSource.query(query, [ids]);
  await run(
    `DELETE FROM payment_transactions WHERE contest_registration_id IN (SELECT id FROM contest_registrations WHERE contest_id = ANY($1::uuid[]))`,
  );
  await run(
    `DELETE FROM contest_match_participants WHERE match_id IN (SELECT id FROM contest_matches WHERE contest_id = ANY($1::uuid[]))`,
  );
  await run(`DELETE FROM contest_matches WHERE contest_id = ANY($1::uuid[])`);
  await run(`DELETE FROM contest_registrations WHERE contest_id = ANY($1::uuid[])`);
  await run(`DELETE FROM contest_staff_assignments WHERE contest_id = ANY($1::uuid[])`);
  await run(`DELETE FROM contest_audit_logs WHERE contest_id = ANY($1::uuid[])`);
  await run(
    `DELETE FROM payment_components WHERE booking_id IN (SELECT id FROM bookings WHERE contest_id = ANY($1::uuid[]))`,
  );
  await run(
    `DELETE FROM payment_transactions WHERE booking_id IN (SELECT id FROM bookings WHERE contest_id = ANY($1::uuid[]))`,
  );
  await run(
    `DELETE FROM booking_vehicles WHERE booking_id IN (SELECT id FROM bookings WHERE contest_id = ANY($1::uuid[]))`,
  );
  await run(`DELETE FROM bookings WHERE contest_id = ANY($1::uuid[])`);
  await run(`DELETE FROM contest_cafes WHERE contest_id = ANY($1::uuid[])`);
  await run(`DELETE FROM contests WHERE id = ANY($1::uuid[])`);
  logger.info('Flow', `Đã dọn ${ids.length} contest ${FLOW_PREFIX} cũ.`);
}

/**
 * Xoá Redis slot-lock trỏ tới booking không còn trong DB (sót từ các lần
 * cleanup trước — booking bị xoá nhưng lock chưa hết TTL).
 */
async function cleanupOrphanVehicleLocks() {
  const keys = await redis.keys('slot:lock:vehicle:*');
  if (keys.length === 0) return;
  const values = await redis.mget(...keys);
  const bookingIds = values.filter((value): value is string => Boolean(value));
  const aliveRows = (await AppDataSource.query(
    `SELECT id FROM bookings WHERE id = ANY($1::uuid[])`,
    [bookingIds.length > 0 ? bookingIds : ['00000000-0000-0000-0000-000000000000']],
  )) as { id: string }[];
  const alive = new Set(aliveRows.map((row) => row.id));
  const orphanKeys = keys.filter(
    (_, index) => !values[index] || !alive.has(values[index] as string),
  );
  if (orphanKeys.length > 0) {
    await redis.del(...orphanKeys);
  }
  logger.info(
    'Flow',
    `Đã dọn ${orphanKeys.length}/${keys.length} vehicle slot lock mồ côi trong Redis.`,
  );
}

/** Đảm bảo 8 racer tồn tại (idempotent — chạy được kể cả khi chưa seed). */
async function ensureRacers(): Promise<Map<RacerKey, string>> {
  const map = new Map<RacerKey, string>();
  for (const racer of RACERS) {
    const existing = (await AppDataSource.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
      racer.email,
    ])) as { id: string }[];
    if (existing.length > 0) {
      map.set(racer.key, existing[0].id);
      continue;
    }
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const created = await sqlOne<{ id: string }>(
      `INSERT INTO users (email, full_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'CUSTOMER', TRUE) RETURNING id`,
      [racer.email, racer.fullName, passwordHash],
    );
    map.set(racer.key, created.id);
  }
  return map;
}

// ─── Flow building blocks ────────────────────────────────────────────────────

/** Mốc giờ cố định của một ngày tới — tránh vượt ngoài giờ hoạt động của cafe. */
function at(daysAhead: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d;
}

type ContestFormatKey = 'KNOCKOUT' | 'TIME_TRIAL' | 'QUALIFYING_FINAL';

type FlowContext = {
  providerToken: string;
  racerTokens: Map<RacerKey, string>;
  cafeId: string;
  trackTypeId: string;
  /** Mỗi scenario 1 ngày riêng để booking thuê của giải trước không chặn giải sau. */
  dayOffset: number;
  catalog: Record<ContestFormatKey, { typeId: string; formatId: string; templateId: string }>;
};

type RegistrationResult = {
  id: string;
  paymentStatus?: string;
  booking?: { id: string; status: string } | null;
};

type MatchRow = {
  id: string;
  round_no: number;
  match_no: number;
  name: string;
  status: string;
  next_match_id: string | null;
  participants: { registration_id: string }[];
};

async function createAndOpenContest(
  ctx: FlowContext,
  params: { name: string; format: ContestFormatKey; entryFee: number; description: string },
): Promise<string> {
  const catalog = ctx.catalog[params.format];
  const created = await api<{ id: string }>('POST', '/contests', {
    token: ctx.providerToken,
    body: {
      name: params.name,
      description: params.description,
      contest_type_id: catalog.typeId,
      contest_format_id: catalog.formatId,
      contest_template_id: catalog.templateId,
      track_type_id: ctx.trackTypeId,
      participating_cafe_ids: [ctx.cafeId],
      registration_opens_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      registration_closes_at: at(ctx.dayOffset, 8, 0).toISOString(),
      starts_at: at(ctx.dayOffset, 10, 0).toISOString(),
      ends_at: at(ctx.dayOffset, 18, 0).toISOString(),
      capacity: 16,
      entry_fee: params.entryFee,
      vehicle_rule: { vehicle_policy: 'MIXED' },
      config: params.format === 'QUALIFYING_FINAL' ? { finalists: 4 } : {},
    },
  });
  step(`Tạo contest "${params.name}" (DRAFT)`);
  await api('POST', `/contests/${created.id}/open`, { token: ctx.providerToken });
  step('Mở đăng ký (OPEN)');
  return created.id;
}

async function registerByoc(
  ctx: FlowContext,
  contestId: string,
  racer: RacerKey,
  vehicleName: string,
): Promise<string> {
  const registration = await api<RegistrationResult>('POST', `/contests/${contestId}/register`, {
    token: ctx.racerTokens.get(racer),
    body: { vehicle_source: 'BYOC', byoc_vehicle_name: vehicleName },
  });
  step(`Đăng ký BYOC: ${racer} ("${vehicleName}")`);
  return registration.id;
}

/** WF-A: tạo booking thuê trước (contest-rental), mock-checkout, rồi đăng ký với booking đó. */
async function registerWithExistingBooking(
  ctx: FlowContext,
  contestId: string,
  racer: RacerKey,
): Promise<string> {
  const token = ctx.racerTokens.get(racer);
  const booking = await api<{ booking_id: string; vehicle_id: string }>(
    'POST',
    '/bookings/contest-rental',
    {
      token,
      body: {
        contest_id: contestId,
        cafe_id: ctx.cafeId,
        slot_start: at(ctx.dayOffset, 10, 30).toISOString(),
        slot_end: at(ctx.dayOffset, 11, 30).toISOString(),
      },
    },
  );
  await api('POST', `/bookings/${booking.booking_id}/mock-checkout`, { token });
  const registration = await api<RegistrationResult>('POST', `/contests/${contestId}/register`, {
    token,
    body: {
      vehicle_source: 'RENTAL',
      booking_id: booking.booking_id,
      vehicle_id: booking.vehicle_id,
    },
  });
  step(`Đăng ký RENTAL (booking có sẵn, WF-A): ${racer}`);
  return registration.id;
}

/** WF-B: đăng ký kèm rental_slot — server tự tạo booking, rồi mock-checkout booking đó. */
async function registerWithInlineRental(
  ctx: FlowContext,
  contestId: string,
  racer: RacerKey,
): Promise<string> {
  const token = ctx.racerTokens.get(racer);
  const registration = await api<RegistrationResult>('POST', `/contests/${contestId}/register`, {
    token,
    body: {
      vehicle_source: 'RENTAL',
      rental_slot: {
        cafe_id: ctx.cafeId,
        slot_start: at(ctx.dayOffset, 12, 0).toISOString(),
        slot_end: at(ctx.dayOffset, 13, 0).toISOString(),
      },
    },
  });
  if (!registration.booking?.id) {
    throw new Error(`WF-B register không trả về booking cho ${racer}`);
  }
  await api('POST', `/bookings/${registration.booking.id}/mock-checkout`, { token });
  step(`Đăng ký RENTAL (thuê inline, WF-B): ${racer} + mock-checkout booking`);
  return registration.id;
}

async function settleAndApproveAll(
  ctx: FlowContext,
  contestId: string,
  registrationIds: string[],
  entryFee: number,
) {
  for (const registrationId of registrationIds) {
    if (entryFee > 0) {
      await api('POST', `/contest-registrations/${registrationId}/mark-entry-fee-paid`, {
        token: ctx.providerToken,
      });
    }
    await api('POST', `/contest-registrations/${registrationId}/approve`, {
      token: ctx.providerToken,
    });
  }
  step(
    `Duyệt ${registrationIds.length} đăng ký (CONFIRMED)${entryFee > 0 ? ' — đã mark-entry-fee-paid' : ''}`,
  );
}

async function closeAndCheckInAll(ctx: FlowContext, contestId: string, registrationIds: string[]) {
  await shiftContestWindowToNow(contestId);
  await api('POST', `/contests/${contestId}/close`, { token: ctx.providerToken });
  step('Đóng đăng ký + dồn khung giờ thi về hiện tại');
  for (const registrationId of registrationIds) {
    await api('POST', `/contest-registrations/${registrationId}/check-in`, {
      token: ctx.providerToken,
      body: { checked_in_cafe_id: ctx.cafeId },
    });
  }
  step(`Check-in ${registrationIds.length} tay đua`);
}

async function listMatches(ctx: FlowContext, contestId: string): Promise<MatchRow[]> {
  return api<MatchRow[]>('GET', `/contests/${contestId}/matches`, { token: ctx.providerToken });
}

async function submitMatchResults(ctx: FlowContext, match: MatchRow, bestLapBase: number) {
  const results = match.participants.map((participant, index) => ({
    registration_id: participant.registration_id,
    finish_position: index + 1,
    is_winner: index === 0,
    best_lap_seconds: Number((bestLapBase + index * 0.37).toFixed(3)),
    total_time_seconds: Number(((bestLapBase + index * 0.37) * 10).toFixed(3)),
  }));
  await api('POST', `/contest-matches/${match.id}/results`, {
    token: ctx.providerToken,
    body: { results, reason: 'Kết quả chính thức từ ban tổ chức (flow e2e)' },
  });
}

async function finishKnockoutBracket(ctx: FlowContext, contestId: string) {
  // Nhập kết quả + advance theo từng vòng cho tới chung kết.
  for (let round = 1; round <= 8; round += 1) {
    const matches = await listMatches(ctx, contestId);
    const roundMatches = matches.filter(
      (match) =>
        match.round_no >= round && match.status !== 'COMPLETED' && match.participants.length > 0,
    );
    if (roundMatches.length === 0) break;
    for (const match of roundMatches) {
      await submitMatchResults(ctx, match, 18.2 + match.match_no * 0.11);
      if (match.next_match_id) {
        await api('POST', `/contest-matches/${match.id}/advance`, { token: ctx.providerToken });
      }
    }
    step(`Vòng đấu xong: ${roundMatches.map((match) => match.name).join(', ')}`);
  }
}

async function publishAndAssertCompleted(ctx: FlowContext, contestId: string, label: string) {
  const leaderboard = await api<{ entries?: unknown[] }>(
    'POST',
    `/contests/${contestId}/leaderboard/publish`,
    {
      token: ctx.providerToken,
      body: {},
    },
  );
  const contest = await api<{ id: string; status: string }>('GET', `/contests/${contestId}`, {
    token: ctx.providerToken,
  });
  if (contest.status !== 'COMPLETED') {
    throw new Error(`${label}: contest status=${contest.status}, mong đợi COMPLETED`);
  }
  step(`Publish leaderboard (${leaderboard.entries?.length ?? 0} entries) → contest COMPLETED`);
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

async function runKnockoutScenario(ctx: FlowContext) {
  section('SCENARIO 1 — KNOCKOUT 4 tay đua (fee 0, MIXED)');
  const contestId = await createAndOpenContest(ctx, {
    name: `${FLOW_PREFIX} RCField Drift Series 2026: Vòng Loại Trực Tiếp`,
    format: 'KNOCKOUT',
    entryFee: 0,
    description: 'Bracket loại trực tiếp 1v1 cho 4 tay đua — chạy full flow e2e.',
  });

  const registrations = [
    await registerByoc(ctx, contestId, 'minhtri', 'MST RMX 2.5'),
    await registerWithExistingBooking(ctx, contestId, 'quocbao'),
    await registerWithInlineRental(ctx, contestId, 'giahuy'),
    await registerByoc(ctx, contestId, 'hoangnam', 'Yokomo YD-2S Plus'),
  ];
  step('Đủ 4 đăng ký qua 3 nguồn xe (BYOC ×2, WF-A booking, WF-B inline)');

  await settleAndApproveAll(ctx, contestId, registrations, 0);
  await closeAndCheckInAll(ctx, contestId, registrations);

  await api('POST', `/contests/${contestId}/matches/generate`, {
    token: ctx.providerToken,
    body: { cafe_id: ctx.cafeId, registration_ids: registrations },
  });
  step('Generate bracket: 2 bán kết + 1 chung kết');

  await finishKnockoutBracket(ctx, contestId);
  await publishAndAssertCompleted(ctx, contestId, 'KNOCKOUT');
}

async function runTimeTrialScenario(ctx: FlowContext) {
  section('SCENARIO 2 — TIME_TRIAL 3 tay đua (fee 50.000đ, MIXED)');
  ctx.dayOffset = 2;
  const contestId = await createAndOpenContest(ctx, {
    name: `${FLOW_PREFIX} RCField Time Attack Series 2026: Đường Trường`,
    format: 'TIME_TRIAL',
    entryFee: 50000,
    description: 'Mỗi tay đua một lượt time attack, xếp hạng theo best lap — chạy full flow e2e.',
  });

  const registrations = [
    await registerByoc(ctx, contestId, 'thanhdat', 'Traxxas Slash 4x4'),
    await registerWithInlineRental(ctx, contestId, 'anhquan'),
    await registerWithExistingBooking(ctx, contestId, 'duckhang'),
  ];
  step('Đủ 3 đăng ký qua 3 nguồn xe (BYOC, WF-B inline, WF-A booking)');

  await settleAndApproveAll(ctx, contestId, registrations, 50000);
  await closeAndCheckInAll(ctx, contestId, registrations);

  await api('POST', `/contests/${contestId}/matches/generate`, {
    token: ctx.providerToken,
    body: { cafe_id: ctx.cafeId, registration_ids: registrations },
  });
  step('Generate: 3 lượt time attack');

  const matches = await listMatches(ctx, contestId);
  for (const match of matches) {
    await submitMatchResults(ctx, match, 17.5 + match.match_no * 0.23);
  }
  step('Nhập kết quả best lap cho cả 3 lượt');

  await publishAndAssertCompleted(ctx, contestId, 'TIME_TRIAL');
}

async function runGrandPrixScenario(ctx: FlowContext) {
  section('SCENARIO 3 — GRAND_PRIX (QUALIFYING_FINAL) 4 tay đua (fee 0, MIXED)');
  ctx.dayOffset = 3;
  const contestId = await createAndOpenContest(ctx, {
    name: `${FLOW_PREFIX} RCField Grand Prix Series 2026: Chung Kết Mùa`,
    format: 'QUALIFYING_FINAL',
    entryFee: 0,
    description: 'Vòng loại time attack → top 4 vào bracket chung kết — chạy full flow e2e.',
  });

  const registrations = [
    await registerByoc(ctx, contestId, 'tuananh', 'Tamiya TT-02 Drift Spec'),
    await registerWithExistingBooking(ctx, contestId, 'minhtri'),
    await registerWithInlineRental(ctx, contestId, 'quocbao'),
    await registerByoc(ctx, contestId, 'giahuy', 'MST FXX 2.0 KMW'),
  ];
  step('Đủ 4 đăng ký qua 3 nguồn xe');

  await forceRuntimeFormat(contestId, 'QUALIFYING_FINAL');
  step('Patch runtime_format=QUALIFYING_FINAL (workaround BE mapping gap)');

  await settleAndApproveAll(ctx, contestId, registrations, 0);
  await closeAndCheckInAll(ctx, contestId, registrations);

  await api('POST', `/contests/${contestId}/matches/generate`, {
    token: ctx.providerToken,
    body: { cafe_id: ctx.cafeId, registration_ids: registrations },
  });
  step('Generate vòng loại: 4 lượt time attack');

  const qualifying = await listMatches(ctx, contestId);
  for (const match of qualifying) {
    if (match.participants.length === 0) continue;
    await submitMatchResults(ctx, match, 16.8 + match.match_no * 0.19);
  }
  step('Nhập best lap vòng loại');

  await api('POST', `/contests/${contestId}/matches/generate-final-bracket`, {
    token: ctx.providerToken,
    body: {},
  });
  step('Generate bracket chung kết từ kết quả vòng loại');

  await finishKnockoutBracket(ctx, contestId);
  await publishAndAssertCompleted(ctx, contestId, 'GRAND_PRIX');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await AppDataSource.initialize();
  logger.info('Flow', `Full contest flow e2e → ${API_BASE}`);

  await cleanupFlowContests();
  await cleanupOrphanVehicleLocks();
  const racerIds = await ensureRacers();
  logger.info('Flow', `Sẵn sàng ${racerIds.size} racer.`);

  const hnCafe = await sqlOne<{ id: string }>(
    `SELECT id FROM cafes WHERE slug = 'rc-arena-ha-noi' LIMIT 1`,
  );
  const ctx: FlowContext = {
    providerToken: await login('provider@gmail.com'),
    racerTokens: new Map(),
    cafeId: hnCafe.id,
    trackTypeId: await idOf('track_types', 'DRIFT'),
    dayOffset: 1,
    catalog: {
      KNOCKOUT: {
        typeId: await idOf('contest_types', 'PROVIDER_STANDARD'),
        formatId: await idOf('contest_formats', 'KNOCKOUT'),
        templateId: await idOf('contest_templates', 'provider_standard_knockout'),
      },
      TIME_TRIAL: {
        typeId: await idOf('contest_types', 'PROVIDER_STANDARD'),
        formatId: await idOf('contest_formats', 'TIME_TRIAL'),
        templateId: await idOf('contest_templates', 'provider_standard_time_trial'),
      },
      QUALIFYING_FINAL: {
        typeId: await idOf('contest_types', 'GRAND_PRIX'),
        formatId: await idOf('contest_formats', 'QUALIFYING_FINAL'),
        templateId: await idOf('contest_templates', 'grand_prix_qualifying_final'),
      },
    },
  };
  step('Login provider@gmail.com');
  for (const racer of RACERS) {
    ctx.racerTokens.set(racer.key, await login(racer.email));
  }
  step(`Login ${RACERS.length} racer`);

  await runKnockoutScenario(ctx);
  await runTimeTrialScenario(ctx);
  await runGrandPrixScenario(ctx);

  logger.info(
    'Flow',
    '\n✅ FULL FLOW OK — 3 contest [FLOW-E2E] đã COMPLETED với leaderboard (xem trên UI).',
  );
  await AppDataSource.destroy();
  redis.disconnect();
}

main().catch(async (error) => {
  logger.error('Flow', `Flow thất bại ở bước [${stepNo}]`, error);
  try {
    await AppDataSource.destroy();
    redis.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

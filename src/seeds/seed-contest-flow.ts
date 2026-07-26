import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

/**
 * Seed demo data cho luồng contest (phục vụ test tay trên FE):
 *  - 8 tài khoản racer (CUSTOMER, password 123456, tên Việt tự nhiên).
 *  - 4 contest OPEN phủ đủ mọi thể loại: PROVIDER_STANDARD × (KNOCKOUT | TIME_TRIAL)
 *    và GRAND_PRIX × QUALIFYING_FINAL, với đủ 3 vehicle_policy
 *    (RENTAL_ONLY | BYOC_ONLY | MIXED), neo ngày quanh "hôm nay" nên không bị cũ.
 *  - Vài registration mẫu ở các trạng thái khác nhau (BYOC/RENTAL, PENDING/CONFIRMED).
 *
 * Chạy: npm run seed:contest-flow (cần seed-users + seed-cafes đã chạy trước).
 * Idempotent: xoá rồi tạo lại đúng 4 contest theo tên cố định bên dưới.
 */

const SEED_NOTE = '[SEED-CONTEST-FLOW]';

const RACERS = [
  { email: 'minhtri.nguyen.racer@gmail.com', fullName: 'Nguyễn Minh Trí' },
  { email: 'quocbao.tran.racer@gmail.com', fullName: 'Trần Quốc Bảo' },
  { email: 'giahuy.le.racer@gmail.com', fullName: 'Lê Gia Huy' },
  { email: 'hoangnam.pham.racer@gmail.com', fullName: 'Phạm Hoàng Nam' },
  { email: 'thanhdat.do.racer@gmail.com', fullName: 'Đỗ Thành Đạt' },
  { email: 'anhquan.vo.racer@gmail.com', fullName: 'Võ Anh Quân' },
  { email: 'duckhang.bui.racer@gmail.com', fullName: 'Bùi Đức Khang' },
  { email: 'tuananh.dang.racer@gmail.com', fullName: 'Đặng Tuấn Anh' },
] as const;

const CONTEST_NAMES = [
  'RC Knockout Cup Hà Nội — Mùa Hè 2026',
  'Saigon Drift Time Attack — Tháng 8',
  'BYOC Garage Challenge 2026',
  'RCField Grand Prix 2026 — Chặng 1',
] as const;

type SeedUser = { id: string; email: string };

type CatalogIds = {
  providerStandardTypeId: string;
  grandPrixTypeId: string;
  knockoutFormatId: string;
  timeTrialFormatId: string;
  qualifyingFinalFormatId: string;
  knockoutTemplateId: string;
  timeTrialTemplateId: string;
  grandPrixTemplateId: string;
  driftTrackTypeId: string;
};

type CafeRow = { id: string; name: string; slug: string };

type VehicleRow = {
  id: string;
  identifier: string;
  catalog_name: string;
  hourly_rate: string;
  security_deposit: string;
  damage_multiplier: string;
};

async function ensureUser(email: string, fullName: string): Promise<SeedUser> {
  const [existing] = await AppDataSource.query<(SeedUser & { full_name: string })[]>(
    `SELECT id, email, full_name FROM users WHERE email = $1 LIMIT 1`,
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
  logger.info('Seed', `Created racer ${email}`);
  return created;
}

async function loadContext(): Promise<{
  providerId: string;
  hnCafe: CafeRow;
  sgCafe: CafeRow;
  catalog: CatalogIds;
}> {
  const [provider] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'provider@gmail.com' LIMIT 1`,
  );
  if (!provider) {
    throw new Error('provider@gmail.com không tồn tại. Hãy chạy npm run seed trước.');
  }

  const cafes = await AppDataSource.query<CafeRow[]>(
    `SELECT id, name, slug FROM cafes WHERE slug IN ('rc-arena-ha-noi', 'rc-drift-club-sai-gon')`,
  );
  const hnCafe = cafes.find((cafe) => cafe.slug === 'rc-arena-ha-noi');
  const sgCafe = cafes.find((cafe) => cafe.slug === 'rc-drift-club-sai-gon');
  if (!hnCafe || !sgCafe) {
    throw new Error(
      'Thiếu cafe RC Arena Hà Nội / RC Drift Club Sài Gòn. Hãy chạy npm run seed:cafes trước.',
    );
  }

  const idOf = async (table: string, code: string): Promise<string> => {
    const [row] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM ${table} WHERE code = $1 LIMIT 1`,
      [code],
    );
    if (!row) throw new Error(`Thiếu ${table} code=${code}. Hãy chạy migration trước.`);
    return row.id;
  };

  const catalog: CatalogIds = {
    providerStandardTypeId: await idOf('contest_types', 'PROVIDER_STANDARD'),
    grandPrixTypeId: await idOf('contest_types', 'GRAND_PRIX'),
    knockoutFormatId: await idOf('contest_formats', 'KNOCKOUT'),
    timeTrialFormatId: await idOf('contest_formats', 'TIME_TRIAL'),
    qualifyingFinalFormatId: await idOf('contest_formats', 'QUALIFYING_FINAL'),
    knockoutTemplateId: await idOf('contest_templates', 'provider_standard_knockout'),
    timeTrialTemplateId: await idOf('contest_templates', 'provider_standard_time_trial'),
    grandPrixTemplateId: await idOf('contest_templates', 'grand_prix_qualifying_final'),
    driftTrackTypeId: await idOf('track_types', 'DRIFT'),
  };

  return { providerId: provider.id, hnCafe, sgCafe, catalog };
}

async function cleanupSeedContests(): Promise<void> {
  const contests = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM contests WHERE name = ANY($1::text[])`,
    [CONTEST_NAMES],
  );
  if (contests.length === 0) return;

  const contestIds = contests.map((item) => item.id);
  await AppDataSource.query(
    `DELETE FROM payment_transactions
     WHERE contest_registration_id IN (
       SELECT id FROM contest_registrations WHERE contest_id = ANY($1::uuid[])
     )`,
    [contestIds],
  );
  await AppDataSource.query(
    `DELETE FROM contest_match_participants
     WHERE match_id IN (SELECT id FROM contest_matches WHERE contest_id = ANY($1::uuid[]))`,
    [contestIds],
  );
  await AppDataSource.query(`DELETE FROM contest_matches WHERE contest_id = ANY($1::uuid[])`, [
    contestIds,
  ]);
  await AppDataSource.query(
    `DELETE FROM contest_registrations WHERE contest_id = ANY($1::uuid[])`,
    [contestIds],
  );
  await AppDataSource.query(
    `DELETE FROM contest_staff_assignments WHERE contest_id = ANY($1::uuid[])`,
    [contestIds],
  );
  await AppDataSource.query(`DELETE FROM contest_audit_logs WHERE contest_id = ANY($1::uuid[])`, [
    contestIds,
  ]);
  await AppDataSource.query(
    `DELETE FROM booking_vehicles
     WHERE booking_id IN (SELECT id FROM bookings WHERE contest_id = ANY($1::uuid[]))`,
    [contestIds],
  );
  await AppDataSource.query(`DELETE FROM bookings WHERE contest_id = ANY($1::uuid[])`, [
    contestIds,
  ]);
  await AppDataSource.query(`DELETE FROM contest_cafes WHERE contest_id = ANY($1::uuid[])`, [
    contestIds,
  ]);
  await AppDataSource.query(`DELETE FROM contests WHERE id = ANY($1::uuid[])`, [contestIds]);
  logger.info('Seed', `Cleaned ${contests.length} existing contest-flow contest(s)`);
}

async function insertContest(params: {
  cafeId: string;
  providerId: string;
  name: string;
  description: string;
  contestTypeId: string;
  contestFormatId: string;
  contestTemplateId: string;
  driftTrackTypeId: string;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  entryFee: number;
  vehiclePolicy: 'RENTAL_ONLY' | 'BYOC_ONLY' | 'MIXED';
  config?: Record<string, unknown>;
}): Promise<string> {
  const [contest] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contests
       (cafe_id, provider_id, name, description, track_type, track_type_id, contest_type_id,
        contest_format_id, contest_template_id, registration_opens_at, registration_closes_at,
        banner_image_url, vehicle_rule, config, starts_at, ends_at, capacity, entry_fee, status, created_by)
     VALUES
       ($1, $2, $3, $4, 'DRIFT', $5, $6,
        $7, $8, $9, $10,
        NULL, $11, $12, $13, $14, $15, $16, 'OPEN', $2)
     RETURNING id`,
    [
      params.cafeId,
      params.providerId,
      params.name,
      params.description,
      params.driftTrackTypeId,
      params.contestTypeId,
      params.contestFormatId,
      params.contestTemplateId,
      params.registrationOpensAt,
      params.registrationClosesAt,
      JSON.stringify({
        vehicle_policy: params.vehiclePolicy,
        assignment_policy: 'AT_CHECK_IN',
      }),
      JSON.stringify(params.config ?? {}),
      params.startsAt,
      params.endsAt,
      params.capacity,
      params.entryFee,
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

async function pickAvailableVehicle(cafeId: string): Promise<VehicleRow> {
  const [vehicle] = await AppDataSource.query<VehicleRow[]>(
    `SELECT v.id, v.identifier, c.name AS catalog_name, c.hourly_rate, c.security_deposit, c.damage_multiplier
     FROM vehicles v
     JOIN vehicle_catalogs c ON v.catalog_id = c.id
     WHERE v.cafe_id = $1 AND v.status = 'AVAILABLE' AND v.deleted_at IS NULL
     ORDER BY c.name ASC, v.identifier ASC
     LIMIT 1`,
    [cafeId],
  );
  if (!vehicle) {
    throw new Error(`Không có xe AVAILABLE tại cafe ${cafeId}. Hãy chạy seed:cafes trước.`);
  }
  return vehicle;
}

/** Booking CONFIRMED nguồn CONTEST gắn với giải — đại diện cho xe thuê đã thanh toán. */
async function insertContestBooking(params: {
  contestId: string;
  customerId: string;
  cafeId: string;
  driftTrackTypeId: string;
  vehicle: VehicleRow;
  slotStart: Date;
  slotEnd: Date;
}): Promise<string> {
  const [booking] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO bookings (
       customer_id, cafe_id, booking_mode, play_mode, source, contest_id, track_type_id, status,
       slot_start, slot_end, slot_count, payment_expires_at, snapshot, notes
     ) VALUES ($1, $2, 'SINGLE', 'RENTAL', 'CONTEST', $3, $4, 'CONFIRMED', $5, $6, 1, $7, $8, $9)
     RETURNING id`,
    [
      params.customerId,
      params.cafeId,
      params.contestId,
      params.driftTrackTypeId,
      params.slotStart,
      params.slotEnd,
      params.slotStart,
      JSON.stringify({
        vehicle_name: params.vehicle.catalog_name,
        hourly_rate: Number(params.vehicle.hourly_rate),
        contest_source: true,
      }),
      `Booking thuê xe thi đấu ${SEED_NOTE}`,
    ],
  );

  await AppDataSource.query(
    `INSERT INTO booking_vehicles (
       booking_id, vehicle_id, hourly_rate_snapshot, security_deposit_snapshot, damage_multiplier_snapshot
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      booking.id,
      params.vehicle.id,
      Number(params.vehicle.hourly_rate),
      Number(params.vehicle.security_deposit),
      Number(params.vehicle.damage_multiplier),
    ],
  );
  return booking.id;
}

async function insertRegistration(params: {
  contestId: string;
  userId: string;
  vehicleSource: 'RENTAL' | 'BYOC';
  vehicleId?: string | null;
  bookingId?: string | null;
  status: 'PENDING' | 'CONFIRMED';
  paymentStatus: string;
  entryFeeAmount: number;
  checkInCode: string;
  byocDeclaration?: { name: string; brand?: string; class?: string; notes?: string };
}): Promise<string> {
  const [registration] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO contest_registrations
       (contest_id, user_id, participant_role_snapshot, vehicle_source, vehicle_id, customer_vehicle_id, booking_id,
        status, check_in_code, payment_status, entry_fee_amount, entry_fee_due_at, metadata)
     VALUES
       ($1, $2, 'CUSTOMER', $3, $4, NULL, $5,
        $6, $7, $8, $9, NOW() + INTERVAL '3 days', $10)
     RETURNING id`,
    [
      params.contestId,
      params.userId,
      params.vehicleSource,
      params.vehicleId ?? null,
      params.bookingId ?? null,
      params.status,
      params.checkInCode,
      params.paymentStatus,
      params.entryFeeAmount,
      JSON.stringify({
        seeded: true,
        seed_note: SEED_NOTE,
        ...(params.byocDeclaration
          ? {
              byoc_declaration: {
                vehicle_name: params.byocDeclaration.name,
                vehicle_brand: params.byocDeclaration.brand ?? null,
                vehicle_class: params.byocDeclaration.class ?? null,
                notes: params.byocDeclaration.notes ?? null,
              },
            }
          : {}),
      }),
    ],
  );
  return registration.id;
}

async function main() {
  await AppDataSource.initialize();
  logger.info('Seed', 'Seeding contest-flow demo data...');

  const { providerId, hnCafe, sgCafe, catalog } = await loadContext();

  const racers = new Map<string, SeedUser>();
  for (const racer of RACERS) {
    const user = await ensureUser(racer.email, racer.fullName);
    racers.set(racer.email, user);
  }
  const racer = (email: string): SeedUser => {
    const user = racers.get(email);
    if (!user) throw new Error(`Missing racer ${email}`);
    return user;
  };

  await cleanupSeedContests();

  // Neo ngày quanh "hôm nay": đăng ký mở từ hôm qua, đóng +7 ngày, thi +7 ngày
  // → contest luôn OPEN được bất kể seed chạy lại lúc nào trong tuần.
  const day = 24 * 60 * 60 * 1000;
  const regOpens = new Date(Date.now() - day);
  const regCloses = new Date(Date.now() + 7 * day);
  const startsAt = new Date(Date.now() + 7 * day + 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 7 * day + 4 * 60 * 60 * 1000);

  // ── 1. KNOCKOUT · RENTAL_ONLY · RC Arena Hà Nội ────────────────────────────
  const knockoutContestId = await insertContest({
    cafeId: hnCafe.id,
    providerId,
    name: CONTEST_NAMES[0],
    description:
      'Giải đấu loại trực tiếp 1v1 tại RC Arena Hà Nội. Xe thi đấu do quán cung cấp (thuê tại quầy), bracket bốc thăm ngẫu nhiên sau check-in.',
    contestTypeId: catalog.providerStandardTypeId,
    contestFormatId: catalog.knockoutFormatId,
    contestTemplateId: catalog.knockoutTemplateId,
    driftTrackTypeId: catalog.driftTrackTypeId,
    registrationOpensAt: regOpens,
    registrationClosesAt: regCloses,
    startsAt,
    endsAt,
    capacity: 16,
    entryFee: 50000,
    vehiclePolicy: 'RENTAL_ONLY',
  });
  await addContestCafe(knockoutContestId, hnCafe.id, 'HOST', 1);

  // ── 2. TIME_TRIAL · MIXED · RC Drift Club Sài Gòn ──────────────────────────
  const timeTrialContestId = await insertContest({
    cafeId: sgCafe.id,
    providerId,
    name: CONTEST_NAMES[1],
    description:
      'Chạy time attack trên layout drift Sài Gòn — mỗi tay đua một lượt riêng, xếp hạng theo vòng chạy nhanh nhất (best lap). Mang xe riêng hay thuê tại quầy đều được.',
    contestTypeId: catalog.providerStandardTypeId,
    contestFormatId: catalog.timeTrialFormatId,
    contestTemplateId: catalog.timeTrialTemplateId,
    driftTrackTypeId: catalog.driftTrackTypeId,
    registrationOpensAt: regOpens,
    registrationClosesAt: regCloses,
    startsAt,
    endsAt,
    capacity: 24,
    entryFee: 0,
    vehiclePolicy: 'MIXED',
  });
  await addContestCafe(timeTrialContestId, sgCafe.id, 'HOST', 1);

  // ── 3. KNOCKOUT · BYOC_ONLY · RC Arena Hà Nội ──────────────────────────────
  const byocContestId = await insertContest({
    cafeId: hnCafe.id,
    providerId,
    name: CONTEST_NAMES[2],
    description:
      'Sân chơi dành riêng cho anh em mang xe cá nhân (BYOC). Khai báo xe khi đăng ký, xe sẽ được kiểm tra trước giờ thi đấu.',
    contestTypeId: catalog.providerStandardTypeId,
    contestFormatId: catalog.knockoutFormatId,
    contestTemplateId: catalog.knockoutTemplateId,
    driftTrackTypeId: catalog.driftTrackTypeId,
    registrationOpensAt: regOpens,
    registrationClosesAt: regCloses,
    startsAt,
    endsAt,
    capacity: 16,
    entryFee: 30000,
    vehiclePolicy: 'BYOC_ONLY',
  });
  await addContestCafe(byocContestId, hnCafe.id, 'HOST', 1);

  // ── 4. GRAND_PRIX · QUALIFYING_FINAL · MIXED · 2 chi nhánh ────────────────
  const grandPrixContestId = await insertContest({
    cafeId: hnCafe.id,
    providerId,
    name: CONTEST_NAMES[3],
    description:
      'Chặng mở màn Grand Prix 2026: vòng loại time attack chấm theo best lap, top 4 vào bracket chung kết loại trực tiếp. Đồng tổ chức tại Hà Nội và Sài Gòn.',
    contestTypeId: catalog.grandPrixTypeId,
    contestFormatId: catalog.qualifyingFinalFormatId,
    contestTemplateId: catalog.grandPrixTemplateId,
    driftTrackTypeId: catalog.driftTrackTypeId,
    registrationOpensAt: regOpens,
    registrationClosesAt: regCloses,
    startsAt,
    endsAt,
    capacity: 32,
    entryFee: 100000,
    vehiclePolicy: 'MIXED',
    config: { finalists: 4 },
  });
  await addContestCafe(grandPrixContestId, hnCafe.id, 'HOST', 1);
  await addContestCafe(grandPrixContestId, sgCafe.id, 'PARTICIPATING', 2);

  // ── Registrations mẫu ──────────────────────────────────────────────────────
  let codeSeq = 1;
  const nextCheckInCode = () => `FLOW${String(codeSeq++).padStart(5, '0')}`;

  // Time Attack Sài Gòn (MIXED, fee 0): 1 BYOC CONFIRMED + 1 RENTAL CONFIRMED.
  await insertRegistration({
    contestId: timeTrialContestId,
    userId: racer('minhtri.nguyen.racer@gmail.com').id,
    vehicleSource: 'BYOC',
    status: 'CONFIRMED',
    paymentStatus: 'NOT_REQUIRED',
    entryFeeAmount: 0,
    checkInCode: nextCheckInCode(),
    byocDeclaration: {
      name: 'MST RMX 2.5',
      brand: 'MST',
      class: 'Drift',
      notes: 'Setup gyro MST, pin 2S 5200mAh.',
    },
  });
  const sgVehicle = await pickAvailableVehicle(sgCafe.id);
  const sgBookingId = await insertContestBooking({
    contestId: timeTrialContestId,
    customerId: racer('quocbao.tran.racer@gmail.com').id,
    cafeId: sgCafe.id,
    driftTrackTypeId: catalog.driftTrackTypeId,
    vehicle: sgVehicle,
    slotStart: new Date(startsAt.getTime() + 30 * 60 * 1000),
    slotEnd: new Date(startsAt.getTime() + 90 * 60 * 1000),
  });
  await insertRegistration({
    contestId: timeTrialContestId,
    userId: racer('quocbao.tran.racer@gmail.com').id,
    vehicleSource: 'RENTAL',
    vehicleId: sgVehicle.id,
    bookingId: sgBookingId,
    status: 'CONFIRMED',
    paymentStatus: 'NOT_REQUIRED',
    entryFeeAmount: 0,
    checkInCode: nextCheckInCode(),
  });

  // BYOC Garage Challenge (BYOC_ONLY, fee 30k): 1 CONFIRMED + 1 PENDING chờ duyệt.
  await insertRegistration({
    contestId: byocContestId,
    userId: racer('giahuy.le.racer@gmail.com').id,
    vehicleSource: 'BYOC',
    status: 'CONFIRMED',
    paymentStatus: 'MARKED_PAID',
    entryFeeAmount: 30000,
    checkInCode: nextCheckInCode(),
    byocDeclaration: {
      name: 'Yokomo YD-2S Plus',
      brand: 'Yokomo',
      class: 'Drift',
    },
  });
  await insertRegistration({
    contestId: byocContestId,
    userId: racer('hoangnam.pham.racer@gmail.com').id,
    vehicleSource: 'BYOC',
    status: 'PENDING',
    paymentStatus: 'PENDING_PAYMENT',
    entryFeeAmount: 30000,
    checkInCode: nextCheckInCode(),
    byocDeclaration: {
      name: 'MST FXX 2.0 KMW',
      brand: 'MST',
      class: 'Drift',
    },
  });

  // Knockout Cup Hà Nội (RENTAL_ONLY, fee 50k): 1 PENDING vừa đăng ký, chưa gắn booking.
  await insertRegistration({
    contestId: knockoutContestId,
    userId: racer('duckhang.bui.racer@gmail.com').id,
    vehicleSource: 'RENTAL',
    status: 'PENDING',
    paymentStatus: 'PENDING_PAYMENT',
    entryFeeAmount: 50000,
    checkInCode: nextCheckInCode(),
  });

  // Grand Prix (MIXED, fee 100k): 1 RENTAL CONFIRMED (kèm booking) + 1 BYOC CONFIRMED.
  const hnVehicle = await pickAvailableVehicle(hnCafe.id);
  const hnBookingId = await insertContestBooking({
    contestId: grandPrixContestId,
    customerId: racer('thanhdat.do.racer@gmail.com').id,
    cafeId: hnCafe.id,
    driftTrackTypeId: catalog.driftTrackTypeId,
    vehicle: hnVehicle,
    slotStart: new Date(startsAt.getTime() + 30 * 60 * 1000),
    slotEnd: new Date(startsAt.getTime() + 90 * 60 * 1000),
  });
  await insertRegistration({
    contestId: grandPrixContestId,
    userId: racer('thanhdat.do.racer@gmail.com').id,
    vehicleSource: 'RENTAL',
    vehicleId: hnVehicle.id,
    bookingId: hnBookingId,
    status: 'CONFIRMED',
    paymentStatus: 'MARKED_PAID',
    entryFeeAmount: 100000,
    checkInCode: nextCheckInCode(),
  });
  await insertRegistration({
    contestId: grandPrixContestId,
    userId: racer('anhquan.vo.racer@gmail.com').id,
    vehicleSource: 'BYOC',
    status: 'CONFIRMED',
    paymentStatus: 'MARKED_PAID',
    entryFeeAmount: 100000,
    checkInCode: nextCheckInCode(),
    byocDeclaration: {
      name: 'Traxxas Slash 4x4',
      brand: 'Traxxas',
      class: 'Drift',
      notes: 'Đã đổ lốp drift cứng theo quy định giải.',
    },
  });

  const [{ count }] = await AppDataSource.query<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM contest_registrations
     WHERE contest_id = ANY($1::uuid[])`,
    [[knockoutContestId, timeTrialContestId, byocContestId, grandPrixContestId]],
  );

  logger.info(
    'Seed',
    `Done: 4 contest OPEN (${CONTEST_NAMES.join(' | ')}), ${count} registration mẫu, ${RACERS.length} racer (password 123456).`,
  );
  await AppDataSource.destroy();
}

main().catch(async (error) => {
  logger.error('Seed', 'Seed contest-flow failed', error);
  try {
    await AppDataSource.destroy();
  } catch {
    // ignore
  }
  process.exit(1);
});

import 'dotenv/config';
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Seed data: 2 chi nhánh RC cafe thực tế tại Hà Nội và TP.HCM
// Chạy SAU seed-users.ts (cần provider@gmail.com đã tồn tại)
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  await AppDataSource.initialize();
  logger.database('Connected');

  // Lấy provider và staff từ seed-users
  const [provider] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'provider@gmail.com'`,
  );
  const [staff] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'staff@gmail.com'`,
  );
  const [admin] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'admin@gmail.com'`,
  );

  if (!provider) {
    logger.error('Seed', 'provider@gmail.com không tồn tại — chạy seed-users.ts trước', null);
    process.exit(1);
  }

  // ─── Cafe 1: RC Arena Hà Nội ─────────────────────────────────────────────

  const [existingCafe1] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM cafes WHERE slug = 'rc-arena-ha-noi'`,
  );

  let cafe1Id: string;

  if (existingCafe1) {
    cafe1Id = existingCafe1.id;
    logger.warn('Seed', 'Skip cafe 1 — already exists: rc-arena-ha-noi');
  } else {
    const [c1] = await AppDataSource.query<{ id: string }[]>(
      `INSERT INTO cafes (
        provider_id, name, slug, description, phone, status,
        address, district, city, latitude, longitude,
        operating_hours, track_types,
        slot_duration_minutes, slot_fee_rate, max_concurrent_bookings,
        min_booking_notice_minutes, byoc_capacity
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id`,
      [
        provider.id,
        'RC Arena Hà Nội',
        'rc-arena-ha-noi',
        'Sân chơi xe RC chuyên nghiệp đầu tiên tại Hà Nội. Trang bị 2 đường đua: drift track dài 80m và obstacle course với 12 chướng ngại vật. Không gian điều hoà, wifi miễn phí, đồ uống phong phú.',
        '024 3795 6688',
        'ACTIVE',
        '72 Duy Tân, Dịch Vọng Hậu, Cầu Giấy, Hà Nội',
        'Cầu Giấy',
        'Hà Nội',
        21.0285,
        105.7967,
        JSON.stringify({
          mon: { open: '10:00', close: '22:00' },
          tue: { open: '10:00', close: '22:00' },
          wed: { open: '10:00', close: '22:00' },
          thu: { open: '10:00', close: '22:00' },
          fri: { open: '10:00', close: '23:00' },
          sat: { open: '09:00', close: '23:00' },
          sun: { open: '09:00', close: '22:00' },
        }),
        '{DRIFT,OBSTACLE}',
        60,
        50000, // slot_fee_rate (phí đặt chỗ 50k/slot)
        6, // max_concurrent_bookings
        30, // min_booking_notice_minutes
        3, // byoc_capacity
      ],
    );
    cafe1Id = c1.id;
    logger.info('Seed', `Created cafe 1 — RC Arena Hà Nội (${cafe1Id})`);
  }

  // ─── Cafe 2: RC Drift Club Sài Gòn ────────────────────────────────────────

  const [existingCafe2] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM cafes WHERE slug = 'rc-drift-club-sai-gon'`,
  );

  let cafe2Id: string;

  if (existingCafe2) {
    cafe2Id = existingCafe2.id;
    logger.warn('Seed', 'Skip cafe 2 — already exists: rc-drift-club-sai-gon');
  } else {
    const [c2] = await AppDataSource.query<{ id: string }[]>(
      `INSERT INTO cafes (
        provider_id, name, slug, description, phone, status,
        address, district, city, latitude, longitude,
        operating_hours, track_types,
        slot_duration_minutes, slot_fee_rate, max_concurrent_bookings,
        min_booking_notice_minutes, byoc_capacity
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id`,
      [
        provider.id,
        'RC Drift Club Sài Gòn',
        'rc-drift-club-sai-gon',
        'Câu lạc bộ xe RC chuyên drift tại quận 7. Đường đua drift 120m dạng figure-8, sàn epoxy nhẵn bóng đạt chuẩn thi đấu. Tổ chức giải hàng tháng, có lớp học drift cơ bản và nâng cao.',
        '028 6262 7788',
        'ACTIVE',
        '15 Hoàng Văn Thái, Tân Phú, Quận 7, TP. Hồ Chí Minh',
        'Quận 7',
        'TP. Hồ Chí Minh',
        10.7403,
        106.712,
        JSON.stringify({
          mon: { open: '14:00', close: '22:30' },
          tue: { open: '14:00', close: '22:30' },
          wed: { open: '14:00', close: '22:30' },
          thu: { open: '14:00', close: '22:30' },
          fri: { open: '13:00', close: '23:30' },
          sat: { open: '09:00', close: '23:30' },
          sun: { open: '09:00', close: '22:00' },
        }),
        '{DRIFT}',
        60,
        60000, // slot_fee_rate
        8, // max_concurrent_bookings
        60,
        4,
      ],
    );
    cafe2Id = c2.id;
    logger.info('Seed', `Created cafe 2 — RC Drift Club Sài Gòn (${cafe2Id})`);
  }

  // ─── Vehicles — Cafe 1 (Hà Nội) ──────────────────────────────────────────

  await seedVehicles(cafe1Id, [
    {
      name: 'Tamiya TT-02 Drift Spec',
      description:
        'Xe drift nhập khẩu từ Nhật, thân nhựa ABS, khung TT-02 độ lốp drift. Phù hợp người mới học kỹ thuật trượt bánh.',
      tier: 'STANDARD',
      hourly_rate: 80000,
      security_deposit: 200000,
      damage_multiplier: 1.0,
      compatible_track_types: '{DRIFT,OBSTACLE}',
    },
    {
      name: 'Yokomo YD-2S Plus',
      description:
        'Xe drift mid-motor layout, khung carbon fiber, hệ thống lái servo metal gear. Phản hồi tay lái nhạy, ổn định tốc độ cao. Dành cho người chơi trung cấp trở lên.',
      tier: 'STANDARD',
      hourly_rate: 90000,
      security_deposit: 300000,
      damage_multiplier: 1.0,
      compatible_track_types: '{DRIFT}',
    },
    {
      name: 'MST RMX 2.0 S RTR',
      description:
        'Xe drift rear-motor cao cấp, độ nhạy lái chính xác. Thân xe Lexus RC F body kit carbon-look. Lý tưởng cho kỹ thuật drift tandem.',
      tier: 'PREMIUM',
      hourly_rate: 130000,
      security_deposit: 500000,
      damage_multiplier: 1.5,
      compatible_track_types: '{DRIFT}',
    },
    {
      name: 'Traxxas Rustler 4×4 VXL',
      description:
        'Buggy 4WD brushless motor, tốc độ tối đa 80km/h. Chuyên obstacle course và địa hình. Cần kinh nghiệm điều khiển — chỉ dành cho người chơi thành thạo.',
      tier: 'PREMIUM',
      hourly_rate: 150000,
      security_deposit: 700000,
      damage_multiplier: 1.8,
      compatible_track_types: '{OBSTACLE}',
    },
    {
      name: 'Yokomo YD-2RX Carpet Edition',
      description:
        'Phiên bản giới hạn dành cho thi đấu chuyên nghiệp. Khung nhôm CNC, servo Savöx, ESC Hobbywing 10BL120. Chỉ cho thuê cho thành viên đăng ký trước.',
      tier: 'RESTRICTED',
      hourly_rate: 220000,
      security_deposit: 1500000,
      damage_multiplier: 2.5,
      compatible_track_types: '{DRIFT}',
    },
  ]);

  // ─── Vehicles — Cafe 2 (Sài Gòn) ─────────────────────────────────────────

  await seedVehicles(cafe2Id, [
    {
      name: 'HPI RS4 Sport 3 Drift',
      description:
        'Xe drift 4WD shaft-driven kinh điển của HPI. Ổn định, dễ kiểm soát, thích hợp cho người mới học drift. Thân xe Subaru BRZ matte black.',
      tier: 'STANDARD',
      hourly_rate: 90000,
      security_deposit: 250000,
      damage_multiplier: 1.0,
      compatible_track_types: '{DRIFT}',
    },
    {
      name: 'Tamiya TA08 Pro Drift',
      description:
        'Phiên bản Pro của dòng TA08 nổi tiếng. Khung aluminum lightweight, hệ thống belt drive mượt mà. Thân xe Toyota GR86 official licensed.',
      tier: 'STANDARD',
      hourly_rate: 95000,
      security_deposit: 300000,
      damage_multiplier: 1.0,
      compatible_track_types: '{DRIFT}',
    },
    {
      name: 'Overdose GALM Ver.2',
      description:
        'Xe drift Japan-spec từ hãng Overdose, thiết kế thi đấu chuyên nghiệp. Hệ thống treo độc lập, servo metal full, body kit Silvia S15 chính hãng.',
      tier: 'PREMIUM',
      hourly_rate: 140000,
      security_deposit: 600000,
      damage_multiplier: 1.6,
      compatible_track_types: '{DRIFT}',
    },
    {
      name: 'Schumacher Cat K1 Aero',
      description:
        'Touring car chuẩn thi đấu, khung carbon tổng hợp, lốp slick chuyên sàn epoxy. Dành riêng cho vòng thi đấu giải hàng tháng của club.',
      tier: 'RESTRICTED',
      hourly_rate: 200000,
      security_deposit: 2000000,
      damage_multiplier: 3.0,
      compatible_track_types: '{DRIFT}',
    },
  ]);

  // ─── Menu — Cafe 1 (Hà Nội) ───────────────────────────────────────────────

  await seedMenuItems(cafe1Id, [
    {
      name: 'Trà sữa trân châu đen',
      description: 'Trà oolong pha sữa tươi, trân châu nấu mềm, đường tùy chỉnh',
      price: 35000,
      category: 'Đồ uống',
    },
    {
      name: 'Cà phê sữa đá',
      description: 'Cà phê phin Đà Lạt pha với sữa đặc Ông Thọ, đá viên',
      price: 25000,
      category: 'Đồ uống',
    },
    {
      name: 'Matcha latte đá',
      description: 'Matcha Uji Nhật xay mịn, sữa tươi đậm đà, đá viên lớn',
      price: 40000,
      category: 'Đồ uống',
    },
    {
      name: 'Nước cam ép',
      description: 'Cam tươi ép nguyên chất, không đường, không pha loãng',
      price: 30000,
      category: 'Đồ uống',
    },
    { name: 'Pepsi / 7UP lon', description: null, price: 15000, category: 'Đồ uống' },
    { name: 'Nước suối', description: null, price: 10000, category: 'Đồ uống' },
    {
      name: 'Bánh mì que phô mai',
      description: 'Bánh mì nướng giòn nhân phô mai mozzarella chảy',
      price: 25000,
      category: 'Ăn vặt',
    },
    {
      name: 'Snack vị bò cay',
      description: 'Snack khoai tây lát mỏng vị bò nướng cay Hàn Quốc 60g',
      price: 20000,
      category: 'Ăn vặt',
    },
    {
      name: 'Khoai tây chiên bơ tỏi',
      description: 'Khoai tây wedges chiên vàng, sốt bơ tỏi thơm, phục vụ nóng',
      price: 35000,
      category: 'Ăn vặt',
    },
    {
      name: 'Xúc xích nướng (2 chiếc)',
      description: 'Xúc xích Đức nướng than, kèm mù tạt và tương cà',
      price: 30000,
      category: 'Ăn vặt',
    },
  ]);

  // ─── Menu — Cafe 2 (Sài Gòn) ─────────────────────────────────────────────

  await seedMenuItems(cafe2Id, [
    {
      name: 'Bạc xỉu đá',
      description: 'Cà phê Sài Gòn nhiều sữa ít cà phê — đặc trưng phong cách miền Nam',
      price: 22000,
      category: 'Đồ uống',
    },
    {
      name: 'Cà phê đen đá',
      description: 'Cà phê hạt Robusta Tây Nguyên pha phin, đậm vị',
      price: 18000,
      category: 'Đồ uống',
    },
    {
      name: 'Sinh tố xoài',
      description: 'Xoài cát Hoà Lộc xay nhuyễn với sữa chua, không đá',
      price: 35000,
      category: 'Đồ uống',
    },
    {
      name: 'Trà đào cam sả',
      description: 'Trà đen ngâm đào, thêm cam tươi và sả thơm, đá lạnh',
      price: 30000,
      category: 'Đồ uống',
    },
    {
      name: 'Lon nước ngọt',
      description: 'Coca-Cola / Pepsi / 7UP / Mirinda',
      price: 15000,
      category: 'Đồ uống',
    },
    {
      name: 'Bánh tráng trộn',
      description: 'Bánh tráng Tây Ninh trộn xoài, tôm khô, sa tế — đặc sản Sài Gòn',
      price: 25000,
      category: 'Ăn vặt',
    },
    {
      name: 'Hột vịt lộn (2 trứng)',
      description: 'Hột vịt lộn 14 ngày, ăn kèm rau răm và gừng muối',
      price: 20000,
      category: 'Ăn vặt',
    },
    {
      name: 'Bắp rang bơ (ly lớn)',
      description: 'Bắp rang bơ muối kiểu rạp phim, phục vụ trong ly giấy 500ml',
      price: 25000,
      category: 'Ăn vặt',
    },
    {
      name: 'Khô mực nướng',
      description: 'Mực một nắng nướng than, chấm tương me cay, 100g',
      price: 45000,
      category: 'Ăn vặt',
    },
  ]);

  // ─── Staff assignment ──────────────────────────────────────────────────────

  if (staff) {
    const [existingAssign] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM staff_cafe_assignments WHERE staff_id = $1`,
      [staff.id],
    );
    if (!existingAssign) {
      await AppDataSource.query(
        `INSERT INTO staff_cafe_assignments (staff_id, cafe_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [staff.id, cafe1Id, provider.id],
      );
      logger.info('Seed', `Staff assigned to RC Arena Hà Nội`);
    } else {
      logger.warn('Seed', 'Skip staff assignment — already exists');
    }
  }

  // ─── Feature flags AI_CHATBOT ─────────────────────────────────────────────

  const enabledBy = admin?.id ?? provider.id;

  for (const [cafeId, cafeName] of [
    [cafe1Id, 'RC Arena HN'],
    [cafe2Id, 'RC Drift SGN'],
  ]) {
    const [existingFlag] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM feature_flags WHERE feature_key = 'AI_CHATBOT' AND entity_id = $1`,
      [cafeId],
    );
    if (!existingFlag) {
      await AppDataSource.query(
        `INSERT INTO feature_flags (
          feature_key, display_name, description,
          is_enabled, entity_type, entity_id,
          config, enabled_by, enabled_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [
          'AI_CHATBOT',
          `AI Chat — ${cafeName}`,
          'Tính năng chat AI với RAG knowledge base per chi nhánh',
          true,
          'CAFE',
          cafeId,
          JSON.stringify({ monthly_quota: 1000, used_this_month: 0, quota_reset_day: 1 }),
          enabledBy,
        ],
      );
      logger.info('Seed', `Feature flag AI_CHATBOT created for ${cafeName}`);
    } else {
      logger.warn('Seed', `Skip feature flag — already exists for ${cafeName}`);
    }
  }

  // ─── Widget configs ────────────────────────────────────────────────────────

  await seedWidgetConfig(cafe1Id, {
    greeting_message: 'Xin chào! Tôi là trợ lý AI của RC Arena Hà Nội. Bạn cần hỗ trợ gì?',
    position: 'BOTTOM_RIGHT',
    primary_color: '#1E40AF',
    quick_replies: ['Xem giá thuê xe', 'Kiểm tra slot hôm nay', 'Nội quy sân', 'Menu đồ uống'],
  });

  await seedWidgetConfig(cafe2Id, {
    greeting_message: 'Chào mừng đến RC Drift Club Sài Gòn! Hỏi tôi về sân, xe hoặc lịch giải nhé.',
    position: 'BOTTOM_RIGHT',
    primary_color: '#DC2626',
    quick_replies: ['Giá thuê xe', 'Slot hôm nay', 'Lịch giải tháng này', 'Nội quy'],
  });

  await AppDataSource.destroy();
  logger.info('Seed', '─────────────────────────────────────────────');
  logger.info('Seed', 'Done! Cafe IDs for Postman:');
  logger.info('Seed', `  RC Arena Hà Nội:       ${cafe1Id}`);
  logger.info('Seed', `  RC Drift Club Sài Gòn: ${cafe2Id}`);
  logger.info('Seed', '─────────────────────────────────────────────');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedVehicles(
  cafeId: string,
  vehicles: {
    name: string;
    description: string;
    tier: string;
    hourly_rate: number;
    security_deposit: number;
    damage_multiplier: number;
    compatible_track_types: string;
  }[],
) {
  for (const v of vehicles) {
    const [existing] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM vehicles WHERE cafe_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [cafeId, v.name],
    );
    if (existing) {
      logger.warn('Seed', `Skip vehicle — ${v.name}`);
      continue;
    }
    await AppDataSource.query(
      `INSERT INTO vehicles (
        cafe_id, name, description, tier, status,
        hourly_rate, security_deposit, damage_multiplier, compatible_track_types
      ) VALUES ($1,$2,$3,$4,'AVAILABLE',$5,$6,$7,$8)`,
      [
        cafeId,
        v.name,
        v.description,
        v.tier,
        v.hourly_rate,
        v.security_deposit,
        v.damage_multiplier,
        v.compatible_track_types,
      ],
    );
    logger.info('Seed', `  Vehicle: ${v.tier.padEnd(10)} ${v.name}`);
  }
}

async function seedMenuItems(
  cafeId: string,
  items: { name: string; description: string | null; price: number; category: string }[],
) {
  for (const item of items) {
    const [existing] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM menu_items WHERE cafe_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [cafeId, item.name],
    );
    if (existing) continue;

    await AppDataSource.query(
      `INSERT INTO menu_items (cafe_id, name, description, price, category, is_available)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [cafeId, item.name, item.description, item.price, item.category],
    );
  }
  logger.info('Seed', `  Menu: ${items.length} items inserted for cafe ${cafeId.slice(0, 8)}...`);
}

async function seedWidgetConfig(
  cafeId: string,
  cfg: {
    greeting_message: string;
    position: string;
    primary_color: string;
    quick_replies: string[];
  },
) {
  const [existing] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM cafe_widget_configs WHERE cafe_id = $1`,
    [cafeId],
  );
  if (existing) {
    logger.warn('Seed', `Skip widget config — already exists for ${cafeId.slice(0, 8)}...`);
    return;
  }
  await AppDataSource.query(
    `INSERT INTO cafe_widget_configs (cafe_id, greeting_message, position, primary_color, quick_replies, is_enabled)
     VALUES ($1,$2,$3,$4,$5,true)`,
    [
      cafeId,
      cfg.greeting_message,
      cfg.position,
      cfg.primary_color,
      JSON.stringify(cfg.quick_replies),
    ],
  );
  logger.info('Seed', `  Widget config created for ${cafeId.slice(0, 8)}...`);
}

seed().catch((err) => {
  logger.error('Seed', 'Failed', err);
  process.exit(1);
});

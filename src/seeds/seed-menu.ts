import 'dotenv/config';
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

type MenuSeedItem = {
  name: string;
  description: string | null;
  price: number;
  category: string;
  image_url?: string | null;
  is_available?: boolean;
};

const menuSeeds: Record<string, MenuSeedItem[]> = {
  'rc-arena-ha-noi': [
    {
      name: 'Trà sữa trân châu đen',
      description: 'Trà oolong pha sữa tươi, trân châu nấu mềm, đường tùy chỉnh',
      price: 35000,
      category: 'DRINK',
    },
    {
      name: 'Cà phê sữa đá',
      description: 'Cà phê phin Đà Lạt pha với sữa đặc, đá viên',
      price: 25000,
      category: 'DRINK',
    },
    {
      name: 'Matcha latte đá',
      description: 'Matcha Uji Nhật xay mịn, sữa tươi đậm đà',
      price: 40000,
      category: 'DRINK',
    },
    {
      name: 'Khoai tây chiên bơ tỏi',
      description: 'Khoai tây wedges chiên vàng, sốt bơ tỏi thơm',
      price: 35000,
      category: 'SNACK',
    },
    {
      name: 'Xúc xích nướng',
      description: 'Xúc xích Đức nướng, kèm mù tạt và tương cà',
      price: 30000,
      category: 'SNACK',
    },
  ],
  'rc-drift-club-sai-gon': [
    {
      name: 'Bạc xỉu đá',
      description: 'Cà phê Sài Gòn nhiều sữa ít cà phê',
      price: 22000,
      category: 'DRINK',
    },
    {
      name: 'Cà phê đen đá',
      description: 'Cà phê hạt Robusta Tây Nguyên pha phin, đậm vị',
      price: 18000,
      category: 'DRINK',
    },
    {
      name: 'Trà đào cam sả',
      description: 'Trà đen ngâm đào, thêm cam tươi và sả thơm',
      price: 30000,
      category: 'DRINK',
    },
    {
      name: 'Bánh tráng trộn',
      description: 'Bánh tráng Tây Ninh trộn xoài, tôm khô, sa tế',
      price: 25000,
      category: 'SNACK',
    },
    {
      name: 'Bắp rang bơ',
      description: 'Bắp rang bơ muối kiểu rạp phim',
      price: 25000,
      category: 'SNACK',
    },
  ],
};

async function seedMenuForCafe(slug: string, items: MenuSeedItem[]): Promise<void> {
  const [cafe] = await AppDataSource.query<{ id: string; name: string }[]>(
    `SELECT id, name FROM cafes WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );

  if (!cafe) {
    logger.warn('SeedMenu', `Skip ${slug} - cafe not found`);
    return;
  }

  let inserted = 0;
  for (const item of items) {
    const [existing] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM menu_items WHERE cafe_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [cafe.id, item.name],
    );

    if (existing) {
      continue;
    }

    await AppDataSource.query(
      `INSERT INTO menu_items
         (cafe_id, name, description, price, category, image_url, is_available)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        cafe.id,
        item.name,
        item.description,
        item.price,
        item.category,
        item.image_url ?? null,
        item.is_available ?? true,
      ],
    );
    inserted += 1;
  }

  logger.info('SeedMenu', `${cafe.name}: inserted ${inserted}/${items.length} menu items`);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  logger.database('Connected');

  await ensureSeedProviderIsActive();

  for (const [slug, items] of Object.entries(menuSeeds)) {
    await seedMenuForCafe(slug, items);
  }

  await AppDataSource.destroy();
  logger.info('SeedMenu', 'Done');
}

async function ensureSeedProviderIsActive(): Promise<void> {
  const [provider] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM users WHERE email = 'provider@gmail.com' AND deleted_at IS NULL`,
  );

  if (!provider) {
    logger.warn('SeedMenu', 'Skip provider activation - provider@gmail.com not found');
    return;
  }

  const [profile] = await AppDataSource.query<{ user_id: string }[]>(
    `SELECT user_id FROM provider_profiles WHERE user_id = $1 AND deleted_at IS NULL`,
    [provider.id],
  );

  if (profile) {
    await AppDataSource.query(
      `UPDATE provider_profiles
       SET registration_status = 'ACTIVE', updated_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [provider.id],
    );
  } else {
    await AppDataSource.query(
      `INSERT INTO provider_profiles (user_id, business_name, registration_status)
       VALUES ($1, $2, 'ACTIVE')`,
      [provider.id, 'RCField Seed Provider'],
    );
  }

  const [existingSub] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM provider_subscriptions WHERE provider_id = $1 AND deleted_at IS NULL`,
    [provider.id],
  );

  if (!existingSub) {
    const [trialPlan] = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM subscription_plans WHERE name = 'TRIAL' LIMIT 1`,
    );

    if (trialPlan) {
      await AppDataSource.query(
        `INSERT INTO provider_subscriptions
           (provider_id, plan_id, status, started_at, expires_at, ai_quota_reset_at)
         VALUES ($1, $2, 'TRIAL', NOW(), NOW() + INTERVAL '30 days', NOW() + INTERVAL '1 month')`,
        [provider.id, trialPlan.id],
      );
    }
  }

  logger.info('SeedMenu', 'provider@gmail.com is ACTIVE for local menu testing');
}

main().catch((err) => {
  logger.error('SeedMenu', 'Failed', err);
  process.exit(1);
});

import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

const USERS = [
  { email: 'admin@gmail.com', full_name: 'Admin RCField', role: 'ADMIN', password: '123456' },
  {
    email: 'provider@gmail.com',
    full_name: 'Provider Owner',
    role: 'PROVIDER',
    password: '123456',
  },
  {
    email: 'provider_other@gmail.com',
    full_name: 'Other Provider Owner',
    role: 'PROVIDER',
    password: '123456',
  },
  { email: 'staff@gmail.com', full_name: 'Staff Member', role: 'STAFF', password: '123456' },
  {
    email: 'staff_other@gmail.com',
    full_name: 'Other Staff Member',
    role: 'STAFF',
    password: '123456',
  },
  { email: 'customer@gmail.com', full_name: 'Khách Hàng', role: 'CUSTOMER', password: '123456' },
];

async function seed() {
  await AppDataSource.initialize();
  logger.database('Connected');

  for (const u of USERS) {
    const [existing] = await AppDataSource.query(`SELECT id FROM users WHERE email = $1`, [
      u.email,
    ]);

    let userId: string;

    if (existing) {
      logger.warn('Seed', `Skip — already exists: ${u.email}`);
      userId = existing.id;
    } else {
      const password_hash = await bcrypt.hash(u.password, 10);
      const result = await AppDataSource.query(
        `INSERT INTO users (email, full_name, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [u.email, u.full_name, password_hash, u.role],
      );
      userId = result[0]?.id;
      logger.info('Seed', `Created ${u.role.padEnd(8)} — ${u.email}`);
    }

    if (u.role === 'PROVIDER' && userId) {
      const [existingProfile] = await AppDataSource.query(
        `SELECT id FROM provider_profiles WHERE user_id = $1`,
        [userId],
      );
      if (!existingProfile) {
        await AppDataSource.query(
          `INSERT INTO provider_profiles (user_id, business_name, registration_status)
           VALUES ($1, $2, 'ACTIVE')`,
          [userId, u.full_name + ' Business'],
        );
        logger.info('Seed', `Created Provider Profile for ${u.email}`);
      } else {
        logger.warn('Seed', `Skip profile — already exists for ${u.email}`);
      }
    }
  }

  await AppDataSource.destroy();
  logger.info('Seed', 'Done');
}

seed().catch((err) => {
  logger.error('Seed', 'Failed', err);
  process.exit(1);
});

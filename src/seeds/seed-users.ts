import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

const USERS = [
  { email: 'admin@gmail.com',    full_name: 'Admin RCField',  role: 'ADMIN',    password: '123456' },
  { email: 'provider@gmail.com', full_name: 'Provider Owner', role: 'PROVIDER', password: '123456' },
  { email: 'staff@gmail.com',    full_name: 'Staff Member',   role: 'STAFF',    password: '123456' },
  { email: 'customer@gmail.com', full_name: 'Khách Hàng',     role: 'CUSTOMER', password: '123456' },
];

async function seed() {
  await AppDataSource.initialize();
  logger.database('Connected');

  for (const u of USERS) {
    const [existing] = await AppDataSource.query(
      `SELECT id FROM users WHERE email = $1`,
      [u.email],
    );

    if (existing) {
      logger.warn('Seed', `Skip — already exists: ${u.email}`);
      continue;
    }

    const password_hash = await bcrypt.hash(u.password, 10);
    await AppDataSource.query(
      `INSERT INTO users (email, full_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [u.email, u.full_name, password_hash, u.role],
    );

    logger.info('Seed', `Created ${u.role.padEnd(8)} — ${u.email}`);
  }

  await AppDataSource.destroy();
  logger.info('Seed', 'Done');
}

seed().catch((err) => {
  logger.error('Seed', 'Failed', err);
  process.exit(1);
});

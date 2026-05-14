import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../config/database';
import { env } from '../../config/env';
import { UserRole } from '../../types';

// ── Users ────────────────────────────────────────────────────────────────────

interface CreateUserOptions {
  email?: string;
  role?: UserRole;
  full_name?: string;
}

export async function createTestUser(options: CreateUserOptions = {}) {
  const { email, role = UserRole.CUSTOMER, full_name = 'Test User' } = options;
  const uniqueEmail = email ?? `test_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
  const password_hash = await bcrypt.hash('Test@123456', 10);

  const [user] = await AppDataSource.query(
    `INSERT INTO users (email, full_name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [uniqueEmail, full_name, password_hash, role],
  );
  return user;
}

export function generateToken(user: { id: string; email: string; role: UserRole }) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    env.jwt.secret,
    { expiresIn: '1h' },
  );
}

// ── Cafes ────────────────────────────────────────────────────────────────────

interface CreateCafeOptions {
  provider_id?: string;
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  track_types?: string[];
  byoc_capacity?: number;
}

export async function createTestCafe(options: CreateCafeOptions = {}) {
  const {
    status = 'ACTIVE',
    track_types = ['DRIFT', 'CIRCUIT'],
    byoc_capacity = 5,
  } = options;

  const provider_id =
    options.provider_id ??
    (await createTestUser({ role: UserRole.PROVIDER })).id;

  const slug = `test-cafe-${Date.now()}`;

  const [cafe] = await AppDataSource.query(
    `INSERT INTO cafes
       (provider_id, name, slug, address, district, city,
        slot_fee_rate, status, track_types, byoc_capacity,
        operating_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      provider_id,
      'Test Cafe',
      slug,
      '123 Test Street',
      'Quận 7',
      'Hồ Chí Minh',
      150000,
      status,
      track_types,
      byoc_capacity,
      JSON.stringify({ mon: { open: '09:00', close: '22:00', is_closed: false } }),
    ],
  );
  return cafe;
}

// ── Vehicles ─────────────────────────────────────────────────────────────────

interface CreateVehicleOptions {
  cafe_id: string;
  tier?: 'STANDARD' | 'PREMIUM' | 'RESTRICTED';
  status?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  compatible_track_types?: string[];
}

export async function createTestVehicle(options: CreateVehicleOptions) {
  const {
    cafe_id,
    tier = 'STANDARD',
    status = 'AVAILABLE',
    compatible_track_types = [],
  } = options;

  const [vehicle] = await AppDataSource.query(
    `INSERT INTO vehicles
       (cafe_id, name, tier, status, hourly_rate,
        security_deposit, damage_multiplier, compatible_track_types)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [cafe_id, 'Traxxas Slash 4x4', tier, status, 50000, 500000, 1.0, compatible_track_types],
  );
  return vehicle;
}

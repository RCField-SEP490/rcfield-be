import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { AppError, AuthProvider, UserRole } from '../types';
import { User } from '../models/user.entity';

export interface CreateStaffInput {
  cafe_id: string;
  full_name: string;
  email: string;
  phone?: string;
  password: string;
}

export interface StaffProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole.STAFF;
  isActive: boolean;
  cafeId: string;
  cafeName?: string;
  cafeSlug?: string;
  assignedBy: string;
  assignedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ListStaffInput {
  page: number;
  limit: number;
  cafe_id?: string;
  is_active?: boolean;
}

export interface UpdateStaffInput {
  full_name?: string;
  email?: string;
  phone?: string | null;
}

interface StaffRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole.STAFF;
  is_active: boolean;
  cafe_id: string;
  cafe_name: string;
  cafe_slug: string;
  assigned_by: string;
  assigned_at: Date;
  created_at: Date;
  updated_at: Date;
}

function toStaffProfile(row: StaffRow): StaffProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: UserRole.STAFF,
    isActive: row.is_active,
    cafeId: row.cafe_id,
    cafeName: row.cafe_name,
    cafeSlug: row.cafe_slug,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateTemporaryPassword(): string {
  return `RCF-${crypto.randomBytes(6).toString('base64url')}`;
}

async function getOwnedCafeOrThrow(providerId: string, cafeId: string): Promise<{ id: string }> {
  const [cafe] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id
     FROM cafes
     WHERE id = $1 AND provider_id = $2 AND deleted_at IS NULL`,
    [cafeId, providerId],
  );
  if (!cafe) {
    logger.warn('Staff', 'provider tried to use cafe outside ownership', { providerId, cafeId });
    throw new AppError('Cafe không tồn tại hoặc không thuộc Provider này', 404, 'CAFE_NOT_FOUND');
  }
  return cafe;
}

async function getStaffForProviderOrThrow(providerId: string, staffId: string): Promise<StaffRow> {
  const [staff] = await AppDataSource.query<StaffRow[]>(
    `SELECT
       u.id, u.email, u.full_name, u.phone, u.role, u.is_active,
       u.created_at, u.updated_at,
       sca.cafe_id, sca.assigned_by, sca.assigned_at,
       c.name AS cafe_name, c.slug AS cafe_slug
     FROM users u
     JOIN staff_cafe_assignments sca ON sca.staff_id = u.id
     JOIN cafes c ON c.id = sca.cafe_id
     WHERE u.id = $1
       AND u.role = 'STAFF'
       AND u.deleted_at IS NULL
       AND c.provider_id = $2
       AND c.deleted_at IS NULL`,
    [staffId, providerId],
  );
  if (!staff) {
    logger.warn('Staff', 'staff not found in provider scope', { providerId, staffId });
    throw new AppError('Nhân viên không tồn tại', 404, 'STAFF_NOT_FOUND');
  }
  return staff;
}

export async function createStaffForProvider(
  providerId: string,
  input: CreateStaffInput,
): Promise<StaffProfile> {
  const email = input.email.toLowerCase().trim();
  logger.info('Staff', 'create staff requested', { providerId, cafeId: input.cafe_id, email });

  const result = await AppDataSource.transaction(async (manager) => {
    const [cafe] = await manager.query<{ id: string }[]>(
      `SELECT id FROM cafes WHERE id = $1 AND provider_id = $2 AND deleted_at IS NULL`,
      [input.cafe_id, providerId],
    );

    if (!cafe) {
      logger.warn('Staff', 'provider tried to create staff outside owned cafe', {
        providerId,
        cafeId: input.cafe_id,
        email,
      });
      throw new AppError('Cafe không tồn tại hoặc không thuộc Provider này', 404, 'CAFE_NOT_FOUND');
    }

    const existing = await manager.getRepository(User).findOne({ where: { email } });
    if (existing) {
      logger.warn('Staff', 'staff email already exists', { providerId, cafeId: cafe.id, email });
      throw new AppError('Email đã được sử dụng', 409, 'EMAIL_ALREADY_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const userRepo = manager.getRepository(User);
    const staff = await userRepo.save(
      userRepo.create({
        email,
        full_name: input.full_name.trim(),
        phone: input.phone ?? null,
        password_hash: passwordHash,
        role: UserRole.STAFF,
        auth_provider: AuthProvider.LOCAL,
        is_active: true,
      }),
    );

    await manager.query(
      `INSERT INTO staff_cafe_assignments (staff_id, cafe_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [staff.id, cafe.id, providerId],
    );

    return {
      id: staff.id,
      email: staff.email,
      fullName: staff.full_name,
      phone: staff.phone,
      role: UserRole.STAFF as const,
      isActive: staff.is_active,
      cafeId: cafe.id,
      assignedBy: providerId,
    };
  });

  logger.info('Staff', 'staff created', {
    providerId,
    cafeId: result.cafeId,
    staffId: result.id,
    email: result.email,
  });

  return result;
}

export async function listStaffForProvider(
  providerId: string,
  input: ListStaffInput,
): Promise<{ data: StaffProfile[]; total: number }> {
  logger.info('Staff', 'list staff requested', { providerId, ...input });
  const params: unknown[] = [providerId];
  let query = `
    SELECT
      u.id, u.email, u.full_name, u.phone, u.role, u.is_active,
      u.created_at, u.updated_at,
      sca.cafe_id, sca.assigned_by, sca.assigned_at,
      c.name AS cafe_name, c.slug AS cafe_slug
    FROM users u
    JOIN staff_cafe_assignments sca ON sca.staff_id = u.id
    JOIN cafes c ON c.id = sca.cafe_id
    WHERE u.role = 'STAFF'
      AND u.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND c.provider_id = $1
  `;

  if (input.cafe_id) {
    await getOwnedCafeOrThrow(providerId, input.cafe_id);
    params.push(input.cafe_id);
    query += ` AND sca.cafe_id = $${params.length}`;
  }

  if (input.is_active !== undefined) {
    params.push(input.is_active);
    query += ` AND u.is_active = $${params.length}`;
  }

  const countResult = await AppDataSource.query<[{ count: string }]>(
    `SELECT COUNT(*) AS count FROM (${query}) t`,
    params,
  );
  const total = parseInt(countResult[0]?.count ?? '0', 10);

  params.push(input.limit, (input.page - 1) * input.limit);
  query += ` ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const rows = await AppDataSource.query<StaffRow[]>(query, params);
  return { data: rows.map(toStaffProfile), total };
}

export async function getStaffDetailForProvider(
  providerId: string,
  staffId: string,
): Promise<StaffProfile> {
  logger.info('Staff', 'get staff detail requested', { providerId, staffId });
  return toStaffProfile(await getStaffForProviderOrThrow(providerId, staffId));
}

export async function updateStaffForProvider(
  providerId: string,
  staffId: string,
  input: UpdateStaffInput,
): Promise<StaffProfile> {
  logger.info('Staff', 'update staff requested', {
    providerId,
    staffId,
    fields: Object.keys(input),
  });
  await getStaffForProviderOrThrow(providerId, staffId);

  const email = input.email?.toLowerCase().trim();
  if (email) {
    const existing = await AppDataSource.getRepository(User).findOne({ where: { email } });
    if (existing && existing.id !== staffId) {
      logger.warn('Staff', 'staff update email already exists', { providerId, staffId, email });
      throw new AppError('Email đã được sử dụng', 409, 'EMAIL_ALREADY_EXISTS');
    }
  }

  await AppDataSource.transaction(async (manager) => {
    const repo = manager.getRepository(User);
    const staff = await repo.findOne({ where: { id: staffId, role: UserRole.STAFF } });
    if (!staff) throw new AppError('Nhân viên không tồn tại', 404, 'STAFF_NOT_FOUND');

    if (input.full_name !== undefined) staff.full_name = input.full_name.trim();
    if (email !== undefined) staff.email = email;
    if (input.phone !== undefined) staff.phone = input.phone;
    await repo.save(staff);
  });

  const updated = await getStaffDetailForProvider(providerId, staffId);
  logger.info('Staff', 'staff updated', { providerId, staffId });
  return updated;
}

export async function updateStaffAssignmentForProvider(
  providerId: string,
  staffId: string,
  cafeId: string,
): Promise<StaffProfile> {
  logger.info('Staff', 'update staff assignment requested', { providerId, staffId, cafeId });
  await getStaffForProviderOrThrow(providerId, staffId);
  await getOwnedCafeOrThrow(providerId, cafeId);

  await AppDataSource.query(
    `UPDATE staff_cafe_assignments
     SET cafe_id = $1, assigned_by = $2, assigned_at = NOW()
     WHERE staff_id = $3`,
    [cafeId, providerId, staffId],
  );

  const updated = await getStaffDetailForProvider(providerId, staffId);
  logger.info('Staff', 'staff assignment updated', { providerId, staffId, cafeId });
  return updated;
}

export async function updateStaffStatusForProvider(
  providerId: string,
  staffId: string,
  isActive: boolean,
): Promise<StaffProfile> {
  logger.info('Staff', 'update staff status requested', { providerId, staffId, isActive });
  await getStaffForProviderOrThrow(providerId, staffId);

  await AppDataSource.transaction(async (manager) => {
    await manager.getRepository(User).update(
      { id: staffId, role: UserRole.STAFF },
      {
        is_active: isActive,
      },
    );
    if (!isActive) {
      await manager.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [staffId]);
    }
  });

  const updated = await getStaffDetailForProvider(providerId, staffId);
  logger.info('Staff', 'staff status updated', { providerId, staffId, isActive });
  return updated;
}

export async function resetStaffPasswordForProvider(
  providerId: string,
  staffId: string,
): Promise<{ staff: StaffProfile; temporaryPassword: string }> {
  logger.info('Staff', 'reset staff password requested', { providerId, staffId });
  await getStaffForProviderOrThrow(providerId, staffId);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  await AppDataSource.transaction(async (manager) => {
    await manager.getRepository(User).update(
      { id: staffId, role: UserRole.STAFF },
      {
        password_hash: passwordHash,
        auth_provider: AuthProvider.LOCAL,
      },
    );
    await manager.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [staffId]);
  });

  const staff = await getStaffDetailForProvider(providerId, staffId);
  logger.info('Staff', 'staff password reset', { providerId, staffId });
  return { staff, temporaryPassword };
}

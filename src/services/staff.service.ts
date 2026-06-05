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
  cafeId: string;
  assignedBy: string;
}

export async function createStaffForProvider(
  providerId: string,
  input: CreateStaffInput,
): Promise<StaffProfile> {
  const email = input.email.toLowerCase().trim();
  logger.info('Staff', 'create staff requested', { providerId, cafeId: input.cafe_id, email });

  const result = await AppDataSource.transaction(async (manager) => {
    const [cafe] = await manager.query<{ id: string; provider_id: string }[]>(
      `SELECT id, provider_id
       FROM cafes
       WHERE id = $1 AND provider_id = $2 AND deleted_at IS NULL`,
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

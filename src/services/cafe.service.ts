import { FindOptionsWhere } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Cafe } from '../models/cafe.entity';
import { AppError, CafeOperatingHours, CafeStatus, TrackType, UserRole } from '../types';
import { checkBranchQuota } from './subscription.service';

export interface Viewer {
  userId: string;
  role: UserRole;
}

interface ListOptions {
  page: number;
  limit: number;
  district?: string;
  city?: string;
  track_type?: string;
  status?: CafeStatus;
  viewer?: Viewer;
}

export interface CreateCafeBody {
  name: string;
  description?: string | null;
  phone?: string | null;
  cover_image_url?: string | null;
  address: string;
  district: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  operating_hours: CafeOperatingHours;
  track_types: TrackType[];
  slot_duration_minutes: number;
  slot_fee_rate: number;
  max_concurrent_bookings: number;
  min_booking_notice_minutes: number;
  byoc_capacity: number;
}

export type UpdateCafeBody = Partial<CreateCafeBody>;

function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'cafe';
}

async function makeUniqueSlug(name: string): Promise<string> {
  const repo = AppDataSource.getRepository(Cafe);
  const base = slugify(name);
  let slug = base;
  let suffix = 1;

  while (await repo.findOne({ where: { slug } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  return slug;
}

function assertCafeOwner(cafe: Cafe, providerId: string): void {
  if (cafe.providerId !== providerId) {
    throw new AppError('Bạn chỉ có thể cập nhật cafe thuộc sở hữu của mình', 403, 'FORBIDDEN');
  }
}

export async function getCafeOrThrow(id: string): Promise<Cafe> {
  const cafe = await AppDataSource.getRepository(Cafe).findOne({
    where: { id } as FindOptionsWhere<Cafe>,
  });
  if (!cafe) throw new AppError('Cafe không tồn tại', 404, 'CAFE_NOT_FOUND');
  return cafe;
}

export async function getManagedCafeOrThrow(id: string, viewer: Viewer): Promise<Cafe> {
  const cafe = await getCafeOrThrow(id);
  if (viewer.role === UserRole.PROVIDER) {
    if (cafe.providerId === viewer.userId) return cafe;
    throw new AppError('Bạn không phải chủ sở hữu chi nhánh này', 403, 'FORBIDDEN');
  }
  if (viewer.role === UserRole.STAFF) {
    const isAssigned = await AppDataSource.query(
      `SELECT 1 FROM staff_cafe_assignments WHERE staff_id = $1 AND cafe_id = $2`,
      [viewer.userId, id],
    );
    if (isAssigned && isAssigned.length > 0) return cafe;
    throw new AppError('Nhân viên không thuộc chi nhánh này', 403, 'FORBIDDEN');
  }
  throw new AppError('Bạn không có quyền truy cập hoặc quản lý chi nhánh này', 403, 'FORBIDDEN');
}

export async function createCafe(providerId: string, body: CreateCafeBody): Promise<Cafe> {
  await checkBranchQuota(providerId);

  const repo = AppDataSource.getRepository(Cafe);
  const cafe = new Cafe();
  cafe.providerId = providerId;
  cafe.name = body.name;
  cafe.slug = await makeUniqueSlug(body.name);
  cafe.description = body.description ?? null;
  cafe.phone = body.phone ?? null;
  cafe.status = CafeStatus.PENDING;
  cafe.coverImageUrl = body.cover_image_url ?? null;
  cafe.address = body.address;
  cafe.district = body.district;
  cafe.city = body.city;
  cafe.latitude = body.latitude ?? null;
  cafe.longitude = body.longitude ?? null;
  cafe.operatingHours = body.operating_hours;
  cafe.trackTypes = body.track_types;
  cafe.slotDurationMinutes = body.slot_duration_minutes;
  cafe.slotFeeRate = body.slot_fee_rate;
  cafe.maxConcurrentBookings = body.max_concurrent_bookings;
  cafe.minBookingNoticeMinutes = body.min_booking_notice_minutes;
  cafe.byocCapacity = body.byoc_capacity;

  return repo.save(cafe);
}

export async function listCafes(options: ListOptions): Promise<{ data: Cafe[]; total: number }> {
  const { page, limit, district, city, track_type, status, viewer } = options;
  const qb = AppDataSource.getRepository(Cafe)
    .createQueryBuilder('cafe')
    .where('cafe.deleted_at IS NULL');

  if (!viewer || viewer.role === UserRole.CUSTOMER || viewer.role === UserRole.STAFF) {
    qb.andWhere('cafe.status = :active', { active: CafeStatus.ACTIVE });
  } else if (viewer.role === UserRole.PROVIDER) {
    qb.andWhere('(cafe.status = :active OR cafe.provider_id = :providerId)', {
      active: CafeStatus.ACTIVE,
      providerId: viewer.userId,
    });
  }

  if (status && viewer?.role === UserRole.ADMIN) {
    qb.andWhere('cafe.status = :status', { status });
  } else if (status && viewer?.role === UserRole.PROVIDER) {
    qb.andWhere('cafe.status = :status', { status });
  }
  if (district) qb.andWhere('cafe.district = :district', { district });
  if (city) qb.andWhere('cafe.city = :city', { city });
  if (track_type) qb.andWhere(':trackType = ANY(cafe.track_types)', { trackType: track_type });

  const [data, total] = await qb
    .orderBy('cafe.created_at', 'DESC')
    .skip((page - 1) * limit)
    .take(limit)
    .getManyAndCount();

  return { data, total };
}

export async function getCafeDetail(id: string, viewer?: Viewer): Promise<Cafe> {
  const cafe = await getCafeOrThrow(id);
  const canViewInactive =
    viewer?.role === UserRole.ADMIN ||
    (viewer?.role === UserRole.PROVIDER && viewer.userId === cafe.providerId);

  if (cafe.status !== CafeStatus.ACTIVE && !canViewInactive) {
    throw new AppError('Cafe không tồn tại', 404, 'CAFE_NOT_FOUND');
  }

  return cafe;
}

export async function updateCafe(
  id: string,
  providerId: string,
  body: UpdateCafeBody,
): Promise<Cafe> {
  const cafe = await getCafeOrThrow(id);
  assertCafeOwner(cafe, providerId);

  if (body.name !== undefined) cafe.name = body.name;
  if (body.description !== undefined) cafe.description = body.description;
  if (body.phone !== undefined) cafe.phone = body.phone;
  if (body.cover_image_url !== undefined) cafe.coverImageUrl = body.cover_image_url;
  if (body.address !== undefined) cafe.address = body.address;
  if (body.district !== undefined) cafe.district = body.district;
  if (body.city !== undefined) cafe.city = body.city;
  if (body.latitude !== undefined) cafe.latitude = body.latitude;
  if (body.longitude !== undefined) cafe.longitude = body.longitude;
  if (body.operating_hours !== undefined) cafe.operatingHours = body.operating_hours;
  if (body.track_types !== undefined) cafe.trackTypes = body.track_types;
  if (body.slot_duration_minutes !== undefined) {
    cafe.slotDurationMinutes = body.slot_duration_minutes;
  }
  if (body.slot_fee_rate !== undefined) cafe.slotFeeRate = body.slot_fee_rate;
  if (body.max_concurrent_bookings !== undefined) {
    cafe.maxConcurrentBookings = body.max_concurrent_bookings;
  }
  if (body.min_booking_notice_minutes !== undefined) {
    cafe.minBookingNoticeMinutes = body.min_booking_notice_minutes;
  }
  if (body.byoc_capacity !== undefined) cafe.byocCapacity = body.byoc_capacity;

  return AppDataSource.getRepository(Cafe).save(cafe);
}

export async function updateCafeStatus(id: string, status: CafeStatus): Promise<Cafe> {
  const cafe = await getCafeOrThrow(id);
  cafe.status = status;
  return AppDataSource.getRepository(Cafe).save(cafe);
}

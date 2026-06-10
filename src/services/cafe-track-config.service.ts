import { AppDataSource } from '../config/database';
import { CafeTrackConfig } from '../models/cafe-track-config.entity';
import { TrackType } from '../models/track-type.entity';
import { Booking } from '../models/booking.entity';
import { AppError, BookingStatus, UserRole } from '../types';
import { getManagedCafeOrThrow } from './cafe.service';
import { uploadImage } from './cloudinary.service';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface CreateTrackConfigBody {
  track_type_id: string;
  max_concurrent: number;
  byoc_capacity: number;
  description?: string;
  sort_order?: number;
}

export interface UpdateTrackConfigBody {
  max_concurrent?: number;
  byoc_capacity?: number;
  description?: string | null;
  images?: string[];
  sort_order?: number;
  is_active?: boolean;
}

function formatConfig(config: CafeTrackConfig, trackType?: TrackType) {
  return {
    id: config.id,
    cafe_id: config.cafeId,
    track_type_id: config.trackTypeId,
    track_type: trackType
      ? {
          id: trackType.id,
          code: trackType.code,
          name: trackType.name,
          description: trackType.description,
        }
      : undefined,
    max_concurrent: config.maxConcurrent,
    byoc_capacity: config.byocCapacity,
    images: config.images,
    description: config.description,
    sort_order: config.sortOrder,
    is_active: config.isActive,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  };
}

export async function listTrackConfigs(
  cafeId: string,
  viewer?: Viewer,
): Promise<ReturnType<typeof formatConfig>[]> {
  const repo = AppDataSource.getRepository(CafeTrackConfig);
  const trackTypeRepo = AppDataSource.getRepository(TrackType);

  const isProvider = viewer?.role === UserRole.PROVIDER || viewer?.role === UserRole.ADMIN;

  const qb = repo
    .createQueryBuilder('ctc')
    .where('ctc.cafe_id = :cafeId', { cafeId })
    .andWhere('ctc.deleted_at IS NULL')
    .orderBy('ctc.sort_order', 'ASC')
    .addOrderBy('ctc.created_at', 'ASC');

  if (!isProvider) {
    // Public: only active configs that have at least 1 image
    qb.andWhere('ctc.is_active = true').andWhere('array_length(ctc.images, 1) > 0');
  }

  const configs = await qb.getMany();

  const trackTypeIds = [...new Set(configs.map((c) => c.trackTypeId))];
  const trackTypes = trackTypeIds.length ? await trackTypeRepo.findByIds(trackTypeIds) : [];
  const trackTypeMap = new Map(trackTypes.map((tt) => [tt.id, tt]));

  return configs.map((c) => formatConfig(c, trackTypeMap.get(c.trackTypeId)));
}

export async function createTrackConfig(
  cafeId: string,
  viewer: Viewer,
  body: CreateTrackConfigBody,
): Promise<ReturnType<typeof formatConfig>> {
  await getManagedCafeOrThrow(cafeId, viewer);

  const trackTypeRepo = AppDataSource.getRepository(TrackType);
  const trackType = await trackTypeRepo.findOne({ where: { id: body.track_type_id } });
  if (!trackType || !trackType.isActive) {
    throw new AppError('Track type not found or inactive', 400, 'TRACK_TYPE_NOT_FOUND');
  }

  const repo = AppDataSource.getRepository(CafeTrackConfig);
  const existing = await repo
    .createQueryBuilder('ctc')
    .where('ctc.cafe_id = :cafeId', { cafeId })
    .andWhere('ctc.track_type_id = :trackTypeId', { trackTypeId: body.track_type_id })
    .andWhere('ctc.deleted_at IS NULL')
    .getOne();

  if (existing) {
    throw new AppError(
      'Track config already exists for this track type',
      409,
      'TRACK_CONFIG_ALREADY_EXISTS',
    );
  }

  const config = repo.create({
    cafeId,
    trackTypeId: body.track_type_id,
    maxConcurrent: body.max_concurrent,
    byocCapacity: body.byoc_capacity,
    description: body.description ?? null,
    sortOrder: body.sort_order ?? 0,
    images: [],
    isActive: true,
  });

  await repo.save(config);
  return formatConfig(config, trackType);
}

export async function updateTrackConfig(
  cafeId: string,
  configId: string,
  viewer: Viewer,
  body: UpdateTrackConfigBody,
): Promise<ReturnType<typeof formatConfig>> {
  await getManagedCafeOrThrow(cafeId, viewer);

  const repo = AppDataSource.getRepository(CafeTrackConfig);
  const config = await repo.findOne({
    where: { id: configId, cafeId },
  });
  if (!config || config.deletedAt) {
    throw new AppError('Track config not found', 404, 'TRACK_CONFIG_NOT_FOUND');
  }

  // Deactivation guard: block if upcoming active bookings exist
  if (body.is_active === false && config.isActive) {
    const upcomingCount = await AppDataSource.getRepository(Booking)
      .createQueryBuilder('b')
      .where('b.track_config_id = :configId', { configId })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
      })
      .andWhere('b.slot_start > NOW()')
      .getCount();

    if (upcomingCount > 0) {
      throw new AppError(
        'Cannot deactivate: upcoming bookings exist on this track',
        409,
        'TRACK_CONFIG_HAS_UPCOMING_BOOKINGS',
      );
    }
  }

  if (body.max_concurrent !== undefined) config.maxConcurrent = body.max_concurrent;
  if (body.byoc_capacity !== undefined) config.byocCapacity = body.byoc_capacity;
  if (body.description !== undefined) config.description = body.description;
  if (body.images !== undefined) config.images = body.images;
  if (body.sort_order !== undefined) config.sortOrder = body.sort_order;
  if (body.is_active !== undefined) config.isActive = body.is_active;

  await repo.save(config);

  const trackType = await AppDataSource.getRepository(TrackType).findOne({
    where: { id: config.trackTypeId },
  });
  return formatConfig(config, trackType ?? undefined);
}

export async function uploadTrackConfigImages(
  cafeId: string,
  configId: string,
  viewer: Viewer,
  files: Express.Multer.File[],
): Promise<string[]> {
  await getManagedCafeOrThrow(cafeId, viewer);

  const repo = AppDataSource.getRepository(CafeTrackConfig);
  const config = await repo.findOne({ where: { id: configId, cafeId } });
  if (!config || config.deletedAt) {
    throw new AppError('Track config not found', 404, 'TRACK_CONFIG_NOT_FOUND');
  }

  if (config.images.length + files.length > 20) {
    throw new AppError('Too many images: max 20 per track config', 400, 'TOO_MANY_IMAGES');
  }

  const newUrls: string[] = [];
  for (const file of files) {
    const uploaded = await uploadImage({
      buffer: file.buffer,
      folder: `rcfield/tracks/${cafeId}/${configId}`,
      publicIdPrefix: `track-${configId}`,
    });
    newUrls.push(uploaded.url);
  }

  config.images = [...config.images, ...newUrls];
  await repo.save(config);
  return config.images;
}

export async function getTrackConfigOrThrow(
  cafeId: string,
  configId: string,
): Promise<CafeTrackConfig> {
  const config = await AppDataSource.getRepository(CafeTrackConfig).findOne({
    where: { id: configId, cafeId, isActive: true },
  });
  if (!config || config.deletedAt) {
    throw new AppError('Track config not found or inactive', 400, 'TRACK_CONFIG_NOT_FOUND');
  }
  return config;
}

import { IsNull } from 'typeorm';
import { AppDataSource } from '../config/database';
import { VehicleCatalog } from '../models/vehicle-catalog.entity';
import { Vehicle } from '../models/vehicle.entity';
import { getManagedCafeOrThrow, Viewer } from './cafe.service';
import { AppError, UserRole, VehicleStatus } from '../types';

export async function createVehicleUnit(
  cafeId: string,
  catalogId: string,
  providerId: string,
  body: {
    status?: VehicleStatus;
    identifier?: string | null;
    color?: string | null;
    distinctive_image_url?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<Record<string, unknown>> {
  // 1. Verify cafe ownership
  const cafe = await getManagedCafeOrThrow(cafeId, { userId: providerId, role: UserRole.PROVIDER });

  // 2. Verify catalog exists under this cafe
  const catalogRepo = AppDataSource.getRepository(VehicleCatalog);
  const catalog = await catalogRepo.findOne({
    where: { id: catalogId, cafeId, deletedAt: IsNull() },
  });
  if (!catalog) {
    throw new AppError('Catalog xe không tồn tại', 404, 'CATALOG_NOT_FOUND');
  }

  // 3. Create unit
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const vehicle = new Vehicle();
  vehicle.cafeId = cafe.id;
  vehicle.catalogId = catalog.id;
  vehicle.status = body.status ?? VehicleStatus.AVAILABLE;
  vehicle.identifier = body.identifier ?? null;
  vehicle.color = body.color ?? null;
  vehicle.distinctiveImageUrl = body.distinctive_image_url ?? null;
  vehicle.notes = body.notes ?? null;
  vehicle.metadata = body.metadata ?? null;
  await vehicleRepo.save(vehicle);

  return {
    id: vehicle.id,
    status: vehicle.status,
    last_maintenance_at: vehicle.lastMaintenanceAt,
    identifier: vehicle.identifier,
    color: vehicle.color,
    distinctive_image_url: vehicle.distinctiveImageUrl,
    notes: vehicle.notes,
    metadata: vehicle.metadata,
  };
}

export async function updateVehicleUnit(
  cafeId: string,
  catalogId: string,
  unitId: string,
  viewer: Viewer,
  body: {
    status?: VehicleStatus;
    last_maintenance_at?: Date | null;
    identifier?: string | null;
    color?: string | null;
    distinctive_image_url?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<Record<string, unknown>> {
  // 1. Verify cafe ownership/staff assignment
  await getManagedCafeOrThrow(cafeId, viewer);

  // 2. Verify catalog exists under this cafe
  const catalogRepo = AppDataSource.getRepository(VehicleCatalog);
  const catalog = await catalogRepo.findOne({
    where: { id: catalogId, cafeId, deletedAt: IsNull() },
  });
  if (!catalog) {
    throw new AppError('Catalog xe không tồn tại', 404, 'CATALOG_NOT_FOUND');
  }

  // 3. Find physical unit
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const vehicle = await vehicleRepo.findOne({
    where: { id: unitId, catalogId, cafeId, deletedAt: IsNull() },
  });
  if (!vehicle) {
    throw new AppError('Xe vật lý không tồn tại', 404, 'VEHICLE_NOT_FOUND');
  }

  // 4. Update fields
  if (body.status !== undefined) vehicle.status = body.status;
  if (body.last_maintenance_at !== undefined) vehicle.lastMaintenanceAt = body.last_maintenance_at;
  if (body.identifier !== undefined) vehicle.identifier = body.identifier;
  if (body.color !== undefined) vehicle.color = body.color;
  if (body.distinctive_image_url !== undefined)
    vehicle.distinctiveImageUrl = body.distinctive_image_url;
  if (body.notes !== undefined) vehicle.notes = body.notes;
  if (body.metadata !== undefined) vehicle.metadata = body.metadata;

  await vehicleRepo.save(vehicle);

  return {
    id: vehicle.id,
    status: vehicle.status,
    last_maintenance_at: vehicle.lastMaintenanceAt,
    identifier: vehicle.identifier,
    color: vehicle.color,
    distinctive_image_url: vehicle.distinctiveImageUrl,
    notes: vehicle.notes,
    metadata: vehicle.metadata,
  };
}

export async function deleteVehicleUnit(
  cafeId: string,
  catalogId: string,
  unitId: string,
  providerId: string,
): Promise<void> {
  // 1. Verify cafe ownership
  await getManagedCafeOrThrow(cafeId, { userId: providerId, role: UserRole.PROVIDER });

  // 2. Verify catalog exists under this cafe
  const catalogRepo = AppDataSource.getRepository(VehicleCatalog);
  const catalog = await catalogRepo.findOne({
    where: { id: catalogId, cafeId, deletedAt: IsNull() },
  });
  if (!catalog) {
    throw new AppError('Catalog xe không tồn tại', 404, 'CATALOG_NOT_FOUND');
  }

  // 3. Find physical unit
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const vehicle = await vehicleRepo.findOne({
    where: { id: unitId, catalogId, cafeId, deletedAt: IsNull() },
  });
  if (!vehicle) {
    throw new AppError('Xe vật lý không tồn tại', 404, 'VEHICLE_NOT_FOUND');
  }

  // 4. Soft delete
  vehicle.deletedAt = new Date();
  await vehicleRepo.save(vehicle);
}

export async function getVehicleUnitDetail(
  cafeId: string,
  catalogId: string,
  unitId: string,
  viewer?: Viewer,
): Promise<Record<string, unknown>> {
  // Determine if viewer is cafe operator/owner
  let isOperator = false;
  if (viewer && [UserRole.PROVIDER, UserRole.STAFF].includes(viewer.role as UserRole)) {
    try {
      await getManagedCafeOrThrow(cafeId, viewer);
      isOperator = true;
    } catch {
      isOperator = false;
    }
  }

  // 2. Verify catalog exists under this cafe
  const catalogRepo = AppDataSource.getRepository(VehicleCatalog);
  const catalog = await catalogRepo.findOne({
    where: { id: catalogId, cafeId, deletedAt: IsNull() },
  });
  if (!catalog) {
    throw new AppError('Catalog xe không tồn tại', 404, 'CATALOG_NOT_FOUND');
  }

  // 3. Find physical unit
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const vehicle = await vehicleRepo.findOne({
    where: { id: unitId, catalogId, cafeId, deletedAt: IsNull() },
  });
  if (!vehicle) {
    throw new AppError('Xe vật lý không tồn tại', 404, 'VEHICLE_NOT_FOUND');
  }

  if (!isOperator && vehicle.status === VehicleStatus.RETIRED) {
    throw new AppError('Xe vật lý không tồn tại', 404, 'VEHICLE_NOT_FOUND');
  }

  const base: Record<string, unknown> = {
    id: vehicle.id,
    catalogId: vehicle.catalogId,
    status: vehicle.status,
    identifier: vehicle.identifier,
    color: vehicle.color,
    distinctive_image_url: vehicle.distinctiveImageUrl,
    notes: vehicle.notes,
    metadata: vehicle.metadata as Record<string, unknown> | null,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };

  if (isOperator) {
    base.last_maintenance_at = vehicle.lastMaintenanceAt;
  }

  return base;
}

export async function listVehicleUnits(
  cafeId: string,
  viewer: Viewer | undefined,
  filters: { status?: VehicleStatus; catalog_id?: string; search?: string },
): Promise<Record<string, unknown>[]> {
  // Determine if viewer is cafe operator/owner
  let isOperator = false;
  if (viewer && [UserRole.PROVIDER, UserRole.STAFF].includes(viewer.role as UserRole)) {
    try {
      await getManagedCafeOrThrow(cafeId, viewer);
      isOperator = true;
    } catch {
      isOperator = false;
    }
  }

  // 2. Query vehicles
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const qb = vehicleRepo
    .createQueryBuilder('v')
    .innerJoinAndSelect('v.catalog', 'c')
    .where('v.cafeId = :cafeId', { cafeId })
    .andWhere('v.deletedAt IS NULL')
    .andWhere('c.deletedAt IS NULL');

  if (filters.status) {
    if (!isOperator && filters.status === VehicleStatus.RETIRED) {
      // Customers cannot query retired units
      qb.andWhere('1 = 0');
    } else {
      qb.andWhere('v.status = :status', { status: filters.status });
    }
  }

  if (!isOperator) {
    qb.andWhere('v.status != :retiredStatus', { retiredStatus: VehicleStatus.RETIRED });
  }

  if (filters.catalog_id) {
    qb.andWhere('v.catalogId = :catalogId', { catalogId: filters.catalog_id });
  }

  if (filters.search) {
    qb.andWhere(
      '(v.identifier ILIKE :search OR v.color ILIKE :search OR v.notes ILIKE :search OR c.name ILIKE :search)',
      { search: `%${filters.search}%` },
    );
  }

  qb.orderBy('v.createdAt', 'DESC');

  const vehicles = await qb.getMany();

  return vehicles.map((v) => {
    const base: Record<string, unknown> = {
      id: v.id,
      catalogId: v.catalogId,
      status: v.status,
      identifier: v.identifier,
      color: v.color,
      distinctive_image_url: v.distinctiveImageUrl,
      notes: v.notes,
      metadata: v.metadata as Record<string, unknown> | null,
      catalog: {
        id: v.catalog.id,
        name: v.catalog.name,
        tier: v.catalog.tier,
        cover_image_url: v.catalog.coverImageUrl,
        hourlyRate: Number(v.catalog.hourlyRate),
      },
      createdAt: v.createdAt,
    };

    if (isOperator) {
      base.last_maintenance_at = v.lastMaintenanceAt;
    }

    return base;
  });
}

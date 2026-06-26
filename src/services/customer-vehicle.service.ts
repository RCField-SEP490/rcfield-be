import { AppDataSource } from '../config/database';
import { CustomerVehicle } from '../models/customer-vehicle.entity';
import { AppError } from '../types';

export interface CustomerVehicleDto {
  id: string;
  customer_id: string;
  name: string;
  scale: string;
  chassis_type: string;
  frequency: string;
  status: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  description: string | null;
  notes: string | null;
  image_url: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCustomerVehicleBody {
  name: string;
  scale: string;
  chassis_type: string;
  frequency: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  description?: string | null;
  notes?: string | null;
  image_url?: string | null;
  metadata?: Record<string, unknown>;
}

export type UpdateCustomerVehicleBody = Partial<CreateCustomerVehicleBody> & {
  status?: string;
};

function toCustomerVehicleDto(vehicle: CustomerVehicle): CustomerVehicleDto {
  return {
    id: vehicle.id,
    customer_id: vehicle.customerId,
    name: vehicle.name,
    scale: vehicle.scale,
    chassis_type: vehicle.chassisType,
    frequency: vehicle.frequency,
    status: vehicle.status,
    brand: vehicle.brand,
    model: vehicle.model,
    serial_number: vehicle.serialNumber,
    description: vehicle.description,
    notes: vehicle.notes,
    image_url: vehicle.imageUrl,
    metadata: vehicle.metadata,
    created_at: vehicle.createdAt,
    updated_at: vehicle.updatedAt,
  };
}

export async function createCustomerVehicle(
  customerId: string,
  body: CreateCustomerVehicleBody,
): Promise<CustomerVehicleDto> {
  const repo = AppDataSource.getRepository(CustomerVehicle);
  const vehicle = repo.create({
    customerId,
    userIdLegacy: customerId,
    name: body.name,
    scale: body.scale,
    chassisType: body.chassis_type,
    frequency: body.frequency,
    status: 'ACTIVE',
    brand: body.brand ?? null,
    model: body.model ?? null,
    serialNumber: body.serial_number ?? null,
    description: body.description ?? null,
    notes: body.notes ?? null,
    imageUrl: body.image_url ?? null,
    metadata: body.metadata ?? {},
  });

  return toCustomerVehicleDto(await repo.save(vehicle));
}

export async function listCustomerVehicles(customerId: string): Promise<CustomerVehicleDto[]> {
  const vehicles = await AppDataSource.getRepository(CustomerVehicle)
    .createQueryBuilder('vehicle')
    .where('vehicle.customer_id = :customerId OR vehicle.user_id = :customerId', { customerId })
    .orderBy('vehicle.created_at', 'DESC')
    .getMany();

  return vehicles.map(toCustomerVehicleDto);
}

export async function getCustomerVehicleOrThrow(
  id: string,
  customerId: string,
): Promise<CustomerVehicle> {
  const vehicle = await AppDataSource.getRepository(CustomerVehicle)
    .createQueryBuilder('vehicle')
    .where('vehicle.id = :id', { id })
    .andWhere('(vehicle.customer_id = :customerId OR vehicle.user_id = :customerId)', {
      customerId,
    })
    .getOne();

  if (!vehicle) {
    throw new AppError(
      'Phuong tien khong ton tai hoac khong thuoc quyen so huu cua ban',
      404,
      'CUSTOMER_VEHICLE_NOT_FOUND',
    );
  }
  return vehicle;
}

export async function getCustomerVehicle(
  id: string,
  customerId: string,
): Promise<CustomerVehicleDto> {
  return toCustomerVehicleDto(await getCustomerVehicleOrThrow(id, customerId));
}

export async function updateCustomerVehicle(
  id: string,
  customerId: string,
  body: UpdateCustomerVehicleBody,
): Promise<CustomerVehicleDto> {
  const vehicle = await getCustomerVehicleOrThrow(id, customerId);

  if (body.name !== undefined) vehicle.name = body.name;
  if (body.scale !== undefined) vehicle.scale = body.scale;
  if (body.chassis_type !== undefined) vehicle.chassisType = body.chassis_type;
  if (body.frequency !== undefined) vehicle.frequency = body.frequency;
  if (body.status !== undefined) vehicle.status = body.status;
  if (body.brand !== undefined) vehicle.brand = body.brand;
  if (body.model !== undefined) vehicle.model = body.model;
  if (body.serial_number !== undefined) vehicle.serialNumber = body.serial_number;
  if (body.description !== undefined) vehicle.description = body.description;
  if (body.notes !== undefined) vehicle.notes = body.notes;
  if (body.image_url !== undefined) vehicle.imageUrl = body.image_url;
  if (body.metadata !== undefined) vehicle.metadata = body.metadata;
  if (!vehicle.userIdLegacy) vehicle.userIdLegacy = vehicle.customerId;

  return toCustomerVehicleDto(await AppDataSource.getRepository(CustomerVehicle).save(vehicle));
}

export async function deleteCustomerVehicle(id: string, customerId: string): Promise<void> {
  const vehicle = await getCustomerVehicleOrThrow(id, customerId);
  await AppDataSource.getRepository(CustomerVehicle).softRemove(vehicle);
}

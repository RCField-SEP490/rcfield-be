import { AppDataSource } from '../config/database';
import { CustomerVehicle } from '../models/customer-vehicle.entity';
import { AppError } from '../types';

export interface CreateCustomerVehicleBody {
  name: string;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  notes?: string | null;
  image_url?: string | null;
  metadata?: Record<string, unknown>;
}

export type UpdateCustomerVehicleBody = Partial<CreateCustomerVehicleBody>;

export async function createCustomerVehicle(
  userId: string,
  body: CreateCustomerVehicleBody,
): Promise<CustomerVehicle> {
  const repo = AppDataSource.getRepository(CustomerVehicle);
  const vehicle = new CustomerVehicle();
  vehicle.userId = userId;
  vehicle.name = body.name;
  vehicle.brand = body.brand ?? null;
  vehicle.model = body.model ?? null;
  vehicle.color = body.color ?? null;
  vehicle.notes = body.notes ?? null;
  vehicle.imageUrl = body.image_url ?? null;
  vehicle.metadata = body.metadata ?? {};

  return repo.save(vehicle);
}

export async function listCustomerVehicles(userId: string): Promise<CustomerVehicle[]> {
  return AppDataSource.getRepository(CustomerVehicle).find({
    where: { userId },
    order: { createdAt: 'DESC' },
  });
}

export async function getCustomerVehicleOrThrow(
  id: string,
  userId: string,
): Promise<CustomerVehicle> {
  const vehicle = await AppDataSource.getRepository(CustomerVehicle).findOne({
    where: { id, userId },
  });
  if (!vehicle) {
    throw new AppError(
      'Phương tiện không tồn tại hoặc không thuộc quyền sở hữu của bạn',
      404,
      'CUSTOMER_VEHICLE_NOT_FOUND',
    );
  }
  return vehicle;
}

export async function updateCustomerVehicle(
  id: string,
  userId: string,
  body: UpdateCustomerVehicleBody,
): Promise<CustomerVehicle> {
  const vehicle = await getCustomerVehicleOrThrow(id, userId);

  if (body.name !== undefined) vehicle.name = body.name;
  if (body.brand !== undefined) vehicle.brand = body.brand;
  if (body.model !== undefined) vehicle.model = body.model;
  if (body.color !== undefined) vehicle.color = body.color;
  if (body.notes !== undefined) vehicle.notes = body.notes;
  if (body.image_url !== undefined) vehicle.imageUrl = body.image_url;
  if (body.metadata !== undefined) vehicle.metadata = body.metadata;

  return AppDataSource.getRepository(CustomerVehicle).save(vehicle);
}

export async function deleteCustomerVehicle(id: string, userId: string): Promise<void> {
  const vehicle = await getCustomerVehicleOrThrow(id, userId);
  await AppDataSource.getRepository(CustomerVehicle).softRemove(vehicle);
}

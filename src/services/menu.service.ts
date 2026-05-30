import { AppDataSource } from '../config/database';
import { MenuItem } from '../models/menu-item.entity';
import { AppError, UserRole } from '../types';
import { getManagedCafeOrThrow } from './cafe.service';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface MenuListOptions {
  cafeId: string;
  viewer: Viewer;
  page: number;
  limit: number;
  category?: string;
  available?: boolean;
}

export interface CreateMenuItemBody {
  name: string;
  description?: string | null;
  price: number;
  category?: string | null;
  image_url?: string | null;
  is_available?: boolean;
}

export type UpdateMenuItemBody = Partial<CreateMenuItemBody>;

async function getMenuItemOrThrow(cafeId: string, itemId: string): Promise<MenuItem> {
  const item = await AppDataSource.getRepository(MenuItem)
    .createQueryBuilder('item')
    .where('item.id = :itemId', { itemId })
    .andWhere('item.cafe_id = :cafeId', { cafeId })
    .andWhere('item.deleted_at IS NULL')
    .getOne();

  if (!item) {
    throw new AppError('Món không tồn tại', 404, 'MENU_ITEM_NOT_FOUND');
  }

  return item;
}

export async function listMenuItems(
  options: MenuListOptions,
): Promise<{ data: MenuItem[]; total: number }> {
  const { cafeId, viewer, page, limit, category, available } = options;
  await getManagedCafeOrThrow(cafeId, viewer);

  const qb = AppDataSource.getRepository(MenuItem)
    .createQueryBuilder('item')
    .where('item.cafe_id = :cafeId', { cafeId })
    .andWhere('item.deleted_at IS NULL');

  if (category) {
    qb.andWhere('item.category = :category', { category });
  }

  if (available !== undefined) {
    qb.andWhere('item.is_available = :available', { available });
  }

  const [data, total] = await qb
    .orderBy('item.category', 'ASC', 'NULLS LAST')
    .addOrderBy('item.name', 'ASC')
    .skip((page - 1) * limit)
    .take(limit)
    .getManyAndCount();

  return { data, total };
}

export async function createMenuItem(
  cafeId: string,
  viewer: Viewer,
  body: CreateMenuItemBody,
): Promise<MenuItem> {
  await getManagedCafeOrThrow(cafeId, viewer);

  const repo = AppDataSource.getRepository(MenuItem);
  const item = repo.create({
    cafeId,
    name: body.name,
    description: body.description ?? null,
    price: body.price.toFixed(2),
    category: body.category ?? null,
    imageUrl: body.image_url ?? null,
    isAvailable: body.is_available ?? true,
  });

  return repo.save(item);
}

export async function updateMenuItem(
  cafeId: string,
  itemId: string,
  viewer: Viewer,
  body: UpdateMenuItemBody,
): Promise<MenuItem> {
  await getManagedCafeOrThrow(cafeId, viewer);
  const item = await getMenuItemOrThrow(cafeId, itemId);

  if (body.name !== undefined) item.name = body.name;
  if (body.description !== undefined) item.description = body.description;
  if (body.price !== undefined) item.price = body.price.toFixed(2);
  if (body.category !== undefined) item.category = body.category;
  if (body.image_url !== undefined) item.imageUrl = body.image_url;
  if (body.is_available !== undefined) item.isAvailable = body.is_available;

  return AppDataSource.getRepository(MenuItem).save(item);
}

export async function deleteMenuItem(
  cafeId: string,
  itemId: string,
  viewer: Viewer,
): Promise<void> {
  await getManagedCafeOrThrow(cafeId, viewer);
  const item = await getMenuItemOrThrow(cafeId, itemId);
  item.deletedAt = new Date();
  await AppDataSource.getRepository(MenuItem).save(item);
}

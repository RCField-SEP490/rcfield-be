import { AppDataSource } from '../config/database';
import { MenuItem } from '../models/menu-item.entity';
import { MenuItemComponent } from '../models/menu-item-component.entity';
import { AppError, FnbCategory, UserRole } from '../types';
import { getCafeDetail, getManagedCafeOrThrow } from './cafe.service';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface MenuListOptions {
  cafeId: string;
  viewer?: Viewer;
  page: number;
  limit: number;
  category?: FnbCategory;
  available?: boolean;
}

export interface CreateMenuItemBody {
  name: string;
  description?: string | null;
  price: number;
  category?: FnbCategory | null;
  image_url?: string | null;
  is_available?: boolean;
}

export type UpdateMenuItemBody = Partial<CreateMenuItemBody>;

export interface ComboComponentInput {
  item_id: string;
  quantity: number;
}

export interface CreateComboBody {
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  is_available?: boolean;
  components: ComboComponentInput[];
}

export type UpdateComboBody = Partial<CreateComboBody>;

export interface MenuItemWithComponents extends MenuItem {
  components?: Array<{ itemId: string; name: string; quantity: number }>;
}

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

async function attachComponents(items: MenuItem[]): Promise<MenuItemWithComponents[]> {
  const comboIds = items.filter((i) => i.isCombo).map((i) => i.id);
  if (!comboIds.length) return items as MenuItemWithComponents[];

  const rows = await AppDataSource.query<
    { combo_id: string; item_id: string; item_name: string; quantity: number }[]
  >(
    `SELECT mc.combo_id, mc.item_id, mi.name AS item_name, mc.quantity
       FROM menu_item_components mc
       JOIN menu_items mi ON mi.id = mc.item_id AND mi.deleted_at IS NULL
      WHERE mc.combo_id = ANY($1::uuid[])
      ORDER BY mc.created_at ASC`,
    [comboIds],
  );

  const byCombo = new Map<string, Array<{ itemId: string; name: string; quantity: number }>>();
  for (const row of rows) {
    if (!byCombo.has(row.combo_id)) byCombo.set(row.combo_id, []);
    byCombo
      .get(row.combo_id)!
      .push({ itemId: row.item_id, name: row.item_name, quantity: row.quantity });
  }

  return items.map((item) => ({
    ...item,
    components: item.isCombo ? (byCombo.get(item.id) ?? []) : undefined,
  })) as MenuItemWithComponents[];
}

export async function listMenuItems(
  options: MenuListOptions,
): Promise<{ data: MenuItemWithComponents[]; total: number }> {
  const { cafeId, viewer, page, limit, category, available } = options;
  const cafe = await getCafeDetail(cafeId, viewer);
  const canManage =
    viewer?.role === UserRole.ADMIN ||
    (viewer?.role === UserRole.PROVIDER && cafe.providerId === viewer.userId);

  const qb = AppDataSource.getRepository(MenuItem)
    .createQueryBuilder('item')
    .where('item.cafe_id = :cafeId', { cafeId })
    .andWhere('item.deleted_at IS NULL');

  if (category) {
    qb.andWhere('item.category = :category', { category });
  }

  if (!canManage) {
    qb.andWhere('item.is_available = true');
  } else if (available !== undefined) {
    qb.andWhere('item.is_available = :available', { available });
  }

  const [data, total] = await qb
    .orderBy('item.is_combo', 'ASC')
    .addOrderBy('item.category', 'ASC', 'NULLS LAST')
    .addOrderBy('item.name', 'ASC')
    .skip((page - 1) * limit)
    .take(limit)
    .getManyAndCount();

  return { data: await attachComponents(data), total };
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
    isCombo: false,
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

  if (item.isCombo)
    throw new AppError('Dùng endpoint combo để sửa combo', 400, 'USE_COMBO_ENDPOINT');

  if (body.name !== undefined) item.name = body.name;
  if (body.description !== undefined) item.description = body.description ?? null;
  if (body.price !== undefined) item.price = body.price.toFixed(2);
  if (body.category !== undefined) item.category = body.category ?? null;
  if (body.image_url !== undefined) item.imageUrl = body.image_url ?? null;
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

export async function createCombo(
  cafeId: string,
  viewer: Viewer,
  body: CreateComboBody,
): Promise<MenuItemWithComponents> {
  await getManagedCafeOrThrow(cafeId, viewer);

  // Validate all component items belong to this cafe
  const componentIds = body.components.map((c) => c.item_id);
  const existingItems = await AppDataSource.getRepository(MenuItem).find({
    where: componentIds.map((id) => ({ id, cafeId })),
  });
  if (existingItems.length !== componentIds.length) {
    throw new AppError('Một hoặc nhiều món trong combo không hợp lệ', 400, 'INVALID_COMBO_ITEMS');
  }
  const hasComboInComponents = existingItems.some((i) => i.isCombo);
  if (hasComboInComponents) {
    throw new AppError('Không thể thêm combo vào trong combo', 400, 'COMBO_IN_COMBO');
  }

  return AppDataSource.transaction(async (manager) => {
    const itemRepo = manager.getRepository(MenuItem);
    const combo = await itemRepo.save(
      itemRepo.create({
        cafeId,
        name: body.name,
        description: body.description ?? null,
        price: body.price.toFixed(2),
        category: FnbCategory.COMBO,
        isCombo: true,
        imageUrl: body.image_url ?? null,
        isAvailable: body.is_available ?? true,
      }),
    );

    const compRepo = manager.getRepository(MenuItemComponent);
    await compRepo.save(
      body.components.map((c) =>
        compRepo.create({ comboId: combo.id, itemId: c.item_id, quantity: c.quantity }),
      ),
    );

    const [result] = await attachComponents([combo]);
    return result;
  });
}

export async function updateCombo(
  cafeId: string,
  itemId: string,
  viewer: Viewer,
  body: UpdateComboBody,
): Promise<MenuItemWithComponents> {
  await getManagedCafeOrThrow(cafeId, viewer);
  const combo = await getMenuItemOrThrow(cafeId, itemId);
  if (!combo.isCombo) throw new AppError('Món này không phải combo', 400, 'NOT_A_COMBO');

  return AppDataSource.transaction(async (manager) => {
    const itemRepo = manager.getRepository(MenuItem);

    if (body.name !== undefined) combo.name = body.name;
    if (body.description !== undefined) combo.description = body.description ?? null;
    if (body.price !== undefined) combo.price = body.price.toFixed(2);
    if (body.image_url !== undefined) combo.imageUrl = body.image_url ?? null;
    if (body.is_available !== undefined) combo.isAvailable = body.is_available;
    await itemRepo.save(combo);

    if (body.components !== undefined) {
      const componentIds = body.components.map((c) => c.item_id);
      const existingItems = await manager.getRepository(MenuItem).find({
        where: componentIds.map((id) => ({ id, cafeId })),
      });
      if (existingItems.length !== componentIds.length) {
        throw new AppError(
          'Một hoặc nhiều món trong combo không hợp lệ',
          400,
          'INVALID_COMBO_ITEMS',
        );
      }
      if (existingItems.some((i) => i.isCombo)) {
        throw new AppError('Không thể thêm combo vào trong combo', 400, 'COMBO_IN_COMBO');
      }

      const compRepo = manager.getRepository(MenuItemComponent);
      await compRepo.delete({ comboId: combo.id });
      await compRepo.save(
        body.components.map((c) =>
          compRepo.create({ comboId: combo.id, itemId: c.item_id, quantity: c.quantity }),
        ),
      );
    }

    const [result] = await attachComponents([combo]);
    return result;
  });
}

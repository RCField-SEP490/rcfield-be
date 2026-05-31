import { Not } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Promotion } from '../models/promotion.entity';
import { AppError, DiscountType, PromoApplicableTo, UserRole } from '../types';
import { getManagedCafeOrThrow } from './cafe.service';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface PromotionBody {
  code: string;
  description?: string | null;
  discount_type: DiscountType;
  discount_value: number;
  max_discount_amount?: number | null;
  min_order_amount?: number | null;
  max_uses?: number | null;
  max_uses_per_user?: number;
  applicable_to?: PromoApplicableTo;
  starts_at: Date;
  expires_at?: Date | null;
  is_active?: boolean;
}

export type UpdatePromotionBody = Partial<PromotionBody>;

function decimal(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}

async function assertUniqueActiveCode(
  cafeId: string,
  code: string,
  exceptId?: string,
): Promise<void> {
  const repo = AppDataSource.getRepository(Promotion);
  const existing = await repo.findOne({
    where: {
      cafeId,
      code,
      isActive: true,
      ...(exceptId ? { id: Not(exceptId) } : {}),
    },
  });

  if (existing) {
    throw new AppError('Mã ưu đãi đang được sử dụng', 409, 'PROMOTION_CODE_EXISTS');
  }
}

async function getOwnedPromotionOrThrow(
  cafeId: string,
  promotionId: string,
  viewer: Viewer,
): Promise<Promotion> {
  await getManagedCafeOrThrow(cafeId, viewer);
  const promotion = await AppDataSource.getRepository(Promotion).findOne({
    where: { id: promotionId, cafeId },
  });

  if (!promotion) {
    throw new AppError('Ưu đãi không tồn tại', 404, 'PROMOTION_NOT_FOUND');
  }

  return promotion;
}

export async function listPromotions(cafeId: string, viewer: Viewer): Promise<Promotion[]> {
  await getManagedCafeOrThrow(cafeId, viewer);
  return AppDataSource.getRepository(Promotion).find({
    where: { cafeId },
    order: { createdAt: 'DESC' },
  });
}

export async function createPromotion(
  cafeId: string,
  viewer: Viewer,
  body: PromotionBody,
): Promise<Promotion> {
  await getManagedCafeOrThrow(cafeId, viewer);
  await assertUniqueActiveCode(cafeId, body.code);

  const promotion = AppDataSource.getRepository(Promotion).create({
    code: body.code,
    description: body.description ?? null,
    discountType: body.discount_type,
    discountValue: decimal(body.discount_value)!,
    maxDiscountAmount: decimal(body.max_discount_amount),
    minOrderAmount: decimal(body.min_order_amount),
    maxUses: body.max_uses ?? null,
    maxUsesPerUser: body.max_uses_per_user ?? 1,
    applicableTo: body.applicable_to ?? PromoApplicableTo.ALL,
    cafeId,
    startsAt: body.starts_at,
    expiresAt: body.expires_at ?? null,
    isActive: body.is_active ?? true,
    createdBy: viewer.userId,
  });

  return AppDataSource.getRepository(Promotion).save(promotion);
}

export async function updatePromotion(
  cafeId: string,
  promotionId: string,
  viewer: Viewer,
  body: UpdatePromotionBody,
): Promise<Promotion> {
  const promotion = await getOwnedPromotionOrThrow(cafeId, promotionId, viewer);

  if (
    body.code !== undefined &&
    body.code !== promotion.code &&
    (body.is_active ?? promotion.isActive)
  ) {
    await assertUniqueActiveCode(cafeId, body.code, promotion.id);
  }

  if (body.code !== undefined) promotion.code = body.code;
  if (body.description !== undefined) promotion.description = body.description;
  if (body.discount_type !== undefined) promotion.discountType = body.discount_type;
  if (body.discount_value !== undefined) promotion.discountValue = decimal(body.discount_value)!;
  if (body.max_discount_amount !== undefined) {
    promotion.maxDiscountAmount = decimal(body.max_discount_amount);
  }
  if (body.min_order_amount !== undefined)
    promotion.minOrderAmount = decimal(body.min_order_amount);
  if (body.max_uses !== undefined) promotion.maxUses = body.max_uses;
  if (body.max_uses_per_user !== undefined) promotion.maxUsesPerUser = body.max_uses_per_user;
  if (body.applicable_to !== undefined) promotion.applicableTo = body.applicable_to;
  if (body.starts_at !== undefined) promotion.startsAt = body.starts_at;
  if (body.expires_at !== undefined) promotion.expiresAt = body.expires_at;
  if (body.is_active !== undefined) {
    if (body.is_active) await assertUniqueActiveCode(cafeId, promotion.code, promotion.id);
    promotion.isActive = body.is_active;
  }

  return AppDataSource.getRepository(Promotion).save(promotion);
}

export async function deletePromotion(
  cafeId: string,
  promotionId: string,
  viewer: Viewer,
): Promise<void> {
  const promotion = await getOwnedPromotionOrThrow(cafeId, promotionId, viewer);

  if (promotion.usesCount > 0) {
    throw new AppError(
      'Ưu đãi đã phát sinh lượt dùng, chỉ có thể tắt hoạt động',
      409,
      'PROMOTION_ALREADY_USED',
    );
  }

  await AppDataSource.getRepository(Promotion).delete(promotion.id);
}

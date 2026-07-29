import { AppDataSource } from '../config/database';
import { FeaturedPopup } from '../models/featured-popup.entity';
import { Contest } from '../models/contest.entity';
import { AppError, FeaturedPopupAudienceScope, FeaturedPopupPlacement, UserRole } from '../types';

type Viewer = {
  userId: string;
  role: UserRole;
};

type FeaturedPopupBody = {
  title?: string;
  subtitle?: string | null;
  image_url?: string | null;
  cta_label?: string;
  cta_url?: string | null;
  contest_id?: string | null;
  placement?: FeaturedPopupPlacement;
  audience_scope?: FeaturedPopupAudienceScope;
  starts_at?: Date;
  ends_at?: Date;
  is_active?: boolean;
  priority?: number;
};

type ListQuery = {
  placement?: FeaturedPopupPlacement;
  is_active?: boolean;
};

function mapFeaturedPopup(popup: FeaturedPopup) {
  return {
    id: popup.id,
    title: popup.title,
    subtitle: popup.subtitle,
    image_url: popup.imageUrl,
    cta_label: popup.ctaLabel,
    cta_url: popup.ctaUrl,
    contest_id: popup.contestId,
    placement: popup.placement,
    audience_scope: popup.audienceScope,
    starts_at: popup.startsAt,
    ends_at: popup.endsAt,
    is_active: popup.isActive,
    priority: popup.priority,
    created_by: popup.createdBy,
    updated_by: popup.updatedBy,
    created_at: popup.createdAt,
    updated_at: popup.updatedAt,
  };
}

async function assertContestExists(contestId?: string | null) {
  if (!contestId) return;
  const contest = await AppDataSource.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
}

export async function listFeaturedPopups(query?: ListQuery) {
  const repo = AppDataSource.getRepository(FeaturedPopup);
  const qb = repo
    .createQueryBuilder('popup')
    .orderBy('popup.priority', 'DESC')
    .addOrderBy('popup.starts_at', 'DESC');

  if (query?.placement) qb.andWhere('popup.placement = :placement', { placement: query.placement });
  if (query?.is_active !== undefined) {
    qb.andWhere('popup.is_active = :isActive', { isActive: query.is_active });
  }

  const rows = await qb.getMany();
  return rows.map(mapFeaturedPopup);
}

export async function createFeaturedPopup(viewer: Viewer, body: FeaturedPopupBody) {
  await assertContestExists(body.contest_id ?? null);
  const repo = AppDataSource.getRepository(FeaturedPopup);
  const created = await repo.save(
    repo.create({
      title: body.title!,
      subtitle: body.subtitle ?? null,
      imageUrl: body.image_url ?? null,
      ctaLabel: body.cta_label!,
      ctaUrl: body.cta_url ?? null,
      contestId: body.contest_id ?? null,
      placement: body.placement ?? FeaturedPopupPlacement.EXPLORE,
      audienceScope: body.audience_scope ?? FeaturedPopupAudienceScope.ALL,
      startsAt: body.starts_at!,
      endsAt: body.ends_at!,
      isActive: body.is_active ?? true,
      priority: body.priority ?? 100,
      createdBy: viewer.userId,
      updatedBy: viewer.userId,
    }),
  );
  return mapFeaturedPopup(created);
}

export async function updateFeaturedPopup(
  popupId: string,
  viewer: Viewer,
  body: FeaturedPopupBody,
) {
  const repo = AppDataSource.getRepository(FeaturedPopup);
  const popup = await repo.findOne({ where: { id: popupId } });
  if (!popup) throw new AppError('Featured popup không tồn tại', 404, 'FEATURED_POPUP_NOT_FOUND');

  await assertContestExists(body.contest_id ?? popup.contestId);

  if (body.title !== undefined) popup.title = body.title;
  if (body.subtitle !== undefined) popup.subtitle = body.subtitle ?? null;
  if (body.image_url !== undefined) popup.imageUrl = body.image_url ?? null;
  if (body.cta_label !== undefined) popup.ctaLabel = body.cta_label;
  if (body.cta_url !== undefined) popup.ctaUrl = body.cta_url ?? null;
  if (body.contest_id !== undefined) popup.contestId = body.contest_id ?? null;
  if (body.placement !== undefined) popup.placement = body.placement;
  if (body.audience_scope !== undefined) popup.audienceScope = body.audience_scope;
  if (body.starts_at !== undefined) popup.startsAt = body.starts_at;
  if (body.ends_at !== undefined) popup.endsAt = body.ends_at;
  if (body.is_active !== undefined) popup.isActive = body.is_active;
  if (body.priority !== undefined) popup.priority = body.priority;
  popup.updatedBy = viewer.userId;

  const saved = await repo.save(popup);
  return mapFeaturedPopup(saved);
}

export async function getActiveFeaturedPopup(placement = FeaturedPopupPlacement.EXPLORE) {
  const now = new Date();
  const popup = await AppDataSource.getRepository(FeaturedPopup)
    .createQueryBuilder('popup')
    .where('popup.placement = :placement', { placement })
    .andWhere('popup.is_active = TRUE')
    .andWhere('popup.starts_at <= :now', { now })
    .andWhere('popup.ends_at >= :now', { now })
    .orderBy('popup.priority', 'DESC')
    .addOrderBy('popup.starts_at', 'DESC')
    .getOne();

  return popup ? mapFeaturedPopup(popup) : null;
}

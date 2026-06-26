import { Brackets, EntityManager, In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Cafe } from '../models/cafe.entity';
import { Contest } from '../models/contest.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { writeContestAudit } from './contest-audit.service';
import {
  AppError,
  CafeStatus,
  ContestCafeRole,
  ContestRegistrationStatus,
  ContestStatus,
  UserRole,
} from '../types';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface ContestBody {
  name: string;
  description?: string | null;
  track_type_id: string;
  vehicle_rule?: Record<string, unknown>;
  starts_at: Date;
  ends_at: Date;
  registration_opens_at: Date;
  registration_closes_at: Date;
  capacity: number;
  entry_fee?: number;
  banner_image_url?: string | null;
  config?: Record<string, unknown>;
  participating_cafe_ids: string[];
}

export type UpdateContestBody = Partial<ContestBody>;

interface ListContestQuery {
  page: number;
  limit: number;
  status?: ContestStatus;
  upcoming?: boolean;
  notify_within_hours?: number;
}

interface CafeRow {
  id: string;
  name: string;
  slug: string;
  status: CafeStatus;
  city: string;
  district: string;
}

interface ContestRegistrationSummary {
  total: number;
  active: number;
  checked_in: number;
}

interface ContestDto {
  id: string;
  provider_id: string;
  name: string;
  description: string | null;
  track_type_id: string;
  vehicle_rule: Record<string, unknown>;
  starts_at: Date;
  ends_at: Date;
  registration_opens_at: Date;
  registration_closes_at: Date;
  capacity: number;
  entry_fee: number;
  status: ContestStatus;
  banner_image_url: string | null;
  config: Record<string, unknown>;
  participating_cafes: CafeRow[];
  registration_summary: ContestRegistrationSummary;
  remaining_capacity: number;
  is_registration_open: boolean;
  should_notify: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const PUBLIC_CONTEST_STATUSES = [
  ContestStatus.OPEN,
  ContestStatus.CLOSED,
  ContestStatus.RUNNING,
  ContestStatus.COMPLETED,
];

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function numberValue(value: number | string): number {
  return typeof value === 'string' ? Number(value) : value;
}

function assertContestTimeRange(
  contest: Pick<Contest, 'startsAt' | 'endsAt' | 'registrationOpensAt' | 'registrationClosesAt'>,
): void {
  if (contest.endsAt <= contest.startsAt) {
    throw new AppError(
      'Thời gian kết thúc contest phải sau thời gian bắt đầu',
      400,
      'CONTEST_TIME_INVALID',
    );
  }
  if (contest.registrationClosesAt <= contest.registrationOpensAt) {
    throw new AppError(
      'Thời gian đóng đăng ký phải sau thời gian mở đăng ký',
      400,
      'CONTEST_REGISTRATION_WINDOW_INVALID',
    );
  }
  if (contest.registrationClosesAt > contest.startsAt) {
    throw new AppError(
      'Thời gian đóng đăng ký không được sau thời gian bắt đầu contest',
      400,
      'CONTEST_REGISTRATION_WINDOW_INVALID',
    );
  }
}

function canViewerSeeContest(contest: Contest, viewer?: Viewer): boolean {
  if (PUBLIC_CONTEST_STATUSES.includes(contest.status)) return true;
  return Boolean(viewer?.role === UserRole.PROVIDER && viewer.userId === contest.providerId);
}

function isRegistrationOpen(contest: Contest): boolean {
  const now = new Date();
  return (
    contest.status === ContestStatus.OPEN &&
    contest.registrationOpensAt <= now &&
    contest.registrationClosesAt >= now
  );
}

function shouldNotify(contest: Contest, withinHours = 72): boolean {
  if (contest.status !== ContestStatus.OPEN) return false;
  const now = Date.now();
  const opensAt = contest.registrationOpensAt.getTime();
  const diffHours = (opensAt - now) / (1000 * 60 * 60);
  return diffHours >= 0 && diffHours <= withinHours;
}

async function assertProviderCafes(
  manager: EntityManager,
  providerId: string,
  cafeIds: string[],
): Promise<Cafe[]> {
  const ids = uniqueIds(cafeIds);
  const cafes = await manager.getRepository(Cafe).find({
    where: {
      id: In(ids),
      providerId,
      status: CafeStatus.ACTIVE,
    },
  });

  if (cafes.length !== ids.length) {
    throw new AppError(
      'Danh sách chi nhánh tham gia phải thuộc Provider hiện tại và đang ACTIVE',
      403,
      'CONTEST_CAFE_INVALID',
    );
  }

  return cafes;
}

async function assertTrackTypeExists(manager: EntityManager, trackTypeId: string): Promise<void> {
  const rows = await manager.query<{ id: string }[]>(
    `SELECT id FROM track_types WHERE id = $1 AND is_active = TRUE LIMIT 1`,
    [trackTypeId],
  );
  if (rows.length === 0) {
    throw new AppError('Loại đường đua không tồn tại hoặc đã tắt', 400, 'TRACK_TYPE_INVALID');
  }
}

async function getContestOrThrow(manager: EntityManager, contestId: string): Promise<Contest> {
  const contest = await manager.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  return contest;
}

function assertOwner(contest: Contest, providerId: string): void {
  if (contest.providerId !== providerId) {
    throw new AppError('Bạn không có quyền thao tác contest này', 403, 'CONTEST_FORBIDDEN');
  }
}

async function getRegistrationSummary(
  manager: EntityManager,
  contestId: string,
): Promise<ContestRegistrationSummary> {
  const rows = await manager
    .getRepository(ContestRegistration)
    .createQueryBuilder('registration')
    .select('registration.status', 'status')
    .addSelect('COUNT(*)', 'count')
    .where('registration.contestId = :contestId', { contestId })
    .groupBy('registration.status')
    .getRawMany<{ status: ContestRegistrationStatus; count: string }>();

  const summary = { total: 0, active: 0, checked_in: 0 };
  for (const row of rows) {
    const count = Number(row.count);
    summary.total += count;
    if (
      row.status === ContestRegistrationStatus.PENDING ||
      row.status === ContestRegistrationStatus.CONFIRMED ||
      row.status === ContestRegistrationStatus.CHECKED_IN
    ) {
      summary.active += count;
    }
    if (row.status === ContestRegistrationStatus.CHECKED_IN) summary.checked_in += count;
  }
  return summary;
}

async function getParticipatingCafes(
  manager: EntityManager,
  contestId: string,
): Promise<CafeRow[]> {
  const rows = await manager
    .getRepository(ContestCafe)
    .createQueryBuilder('contestCafe')
    .innerJoin(Cafe, 'cafe', 'cafe.id = contestCafe.cafeId')
    .select([
      'cafe.id AS id',
      'cafe.name AS name',
      'cafe.slug AS slug',
      'cafe.status AS status',
      'cafe.city AS city',
      'cafe.district AS district',
    ])
    .where('contestCafe.contestId = :contestId', { contestId })
    .orderBy('contestCafe.displayOrder', 'ASC')
    .addOrderBy('cafe.name', 'ASC')
    .getRawMany<CafeRow>();

  return rows;
}

async function toContestDto(
  manager: EntityManager,
  contest: Contest,
  notifyWithinHours?: number,
): Promise<ContestDto> {
  const [participatingCafes, registrationSummary] = await Promise.all([
    getParticipatingCafes(manager, contest.id),
    getRegistrationSummary(manager, contest.id),
  ]);

  return {
    id: contest.id,
    provider_id: contest.providerId,
    name: contest.name,
    description: contest.description,
    track_type_id: contest.trackTypeId,
    vehicle_rule: contest.vehicleRule,
    starts_at: contest.startsAt,
    ends_at: contest.endsAt,
    registration_opens_at: contest.registrationOpensAt,
    registration_closes_at: contest.registrationClosesAt,
    capacity: contest.capacity,
    entry_fee: numberValue(contest.entryFee),
    status: contest.status,
    banner_image_url: contest.bannerImageUrl,
    config: contest.config,
    participating_cafes: participatingCafes,
    registration_summary: registrationSummary,
    remaining_capacity: Math.max(contest.capacity - registrationSummary.active, 0),
    is_registration_open: isRegistrationOpen(contest),
    should_notify: shouldNotify(contest, notifyWithinHours),
    created_by: contest.createdBy,
    created_at: contest.createdAt,
    updated_at: contest.updatedAt,
  };
}

export async function createContest(providerId: string, body: ContestBody): Promise<ContestDto> {
  return AppDataSource.transaction(async (manager) => {
    await assertTrackTypeExists(manager, body.track_type_id);
    await assertProviderCafes(manager, providerId, body.participating_cafe_ids);

    const contest = manager.getRepository(Contest).create({
      providerId,
      name: body.name,
      description: body.description ?? null,
      trackTypeId: body.track_type_id,
      vehicleRule: body.vehicle_rule ?? {},
      startsAt: body.starts_at,
      endsAt: body.ends_at,
      registrationOpensAt: body.registration_opens_at,
      registrationClosesAt: body.registration_closes_at,
      capacity: body.capacity,
      entryFee: body.entry_fee ?? 0,
      status: ContestStatus.DRAFT,
      bannerImageUrl: body.banner_image_url ?? null,
      config: body.config ?? {},
      createdBy: providerId,
    });
    assertContestTimeRange(contest);

    const saved = await manager.getRepository(Contest).save(contest);
    const contestCafes = uniqueIds(body.participating_cafe_ids).map((cafeId, index) =>
      manager.getRepository(ContestCafe).create({
        contestId: saved.id,
        cafeId,
        role: index === 0 ? ContestCafeRole.HOST : ContestCafeRole.PARTICIPATING,
        displayOrder: index,
        checkInEnabled: true,
      }),
    );
    await manager.getRepository(ContestCafe).save(contestCafes);

    await writeContestAudit(manager, {
      contestId: saved.id,
      actorId: providerId,
      actorRole: UserRole.PROVIDER,
      eventType: 'contest.created',
      afterJson: {
        status: saved.status,
        capacity: saved.capacity,
        entry_fee: saved.entryFee,
        cafe_ids: uniqueIds(body.participating_cafe_ids),
      },
    });

    return toContestDto(manager, saved);
  });
}

export async function updateContest(
  contestId: string,
  providerId: string,
  body: UpdateContestBody,
): Promise<ContestDto> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    assertOwner(contest, providerId);
    const before = {
      name: contest.name,
      status: contest.status,
      capacity: contest.capacity,
      config: contest.config,
    };

    if (contest.status !== ContestStatus.DRAFT && body.participating_cafe_ids !== undefined) {
      throw new AppError(
        'Chỉ có thể đổi chi nhánh tham gia khi contest còn DRAFT',
        409,
        'CONTEST_NOT_EDITABLE',
      );
    }

    if (body.track_type_id !== undefined) {
      await assertTrackTypeExists(manager, body.track_type_id);
      contest.trackTypeId = body.track_type_id;
    }
    if (body.name !== undefined) contest.name = body.name;
    if (body.description !== undefined) contest.description = body.description;
    if (body.vehicle_rule !== undefined) contest.vehicleRule = body.vehicle_rule;
    if (body.starts_at !== undefined) contest.startsAt = body.starts_at;
    if (body.ends_at !== undefined) contest.endsAt = body.ends_at;
    if (body.registration_opens_at !== undefined)
      contest.registrationOpensAt = body.registration_opens_at;
    if (body.registration_closes_at !== undefined)
      contest.registrationClosesAt = body.registration_closes_at;
    if (body.capacity !== undefined) contest.capacity = body.capacity;
    if (body.entry_fee !== undefined) contest.entryFee = body.entry_fee;
    if (body.banner_image_url !== undefined) contest.bannerImageUrl = body.banner_image_url;
    if (body.config !== undefined) contest.config = body.config;

    assertContestTimeRange(contest);
    const saved = await manager.getRepository(Contest).save(contest);

    if (body.participating_cafe_ids !== undefined) {
      await assertProviderCafes(manager, providerId, body.participating_cafe_ids);
      await manager.getRepository(ContestCafe).delete({ contestId });
      const contestCafes = uniqueIds(body.participating_cafe_ids).map((cafeId, index) =>
        manager.getRepository(ContestCafe).create({
          contestId,
          cafeId,
          role: index === 0 ? ContestCafeRole.HOST : ContestCafeRole.PARTICIPATING,
          displayOrder: index,
          checkInEnabled: true,
        }),
      );
      await manager.getRepository(ContestCafe).save(contestCafes);
    }

    await writeContestAudit(manager, {
      contestId: saved.id,
      actorId: providerId,
      actorRole: UserRole.PROVIDER,
      eventType: 'contest.updated',
      beforeJson: before,
      afterJson: {
        name: saved.name,
        status: saved.status,
        capacity: saved.capacity,
        config: saved.config,
        changed_fields: Object.keys(body),
        cafe_ids: body.participating_cafe_ids ? uniqueIds(body.participating_cafe_ids) : undefined,
      },
    });

    return toContestDto(manager, saved);
  });
}

export async function openContest(contestId: string, providerId: string): Promise<ContestDto> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    assertOwner(contest, providerId);
    const before = { status: contest.status };
    if (contest.status !== ContestStatus.DRAFT) {
      throw new AppError('Chỉ contest DRAFT mới được mở đăng ký', 409, 'CONTEST_STATUS_INVALID');
    }
    assertContestTimeRange(contest);

    const cafeCount = await manager.getRepository(ContestCafe).count({ where: { contestId } });
    if (cafeCount === 0) {
      throw new AppError(
        'Contest cần ít nhất một chi nhánh tham gia',
        400,
        'CONTEST_CAFE_REQUIRED',
      );
    }

    contest.status = ContestStatus.OPEN;
    const saved = await manager.getRepository(Contest).save(contest);
    await writeContestAudit(manager, {
      contestId: saved.id,
      actorId: providerId,
      actorRole: UserRole.PROVIDER,
      eventType: 'contest.opened',
      beforeJson: before,
      afterJson: {
        status: saved.status,
        registration_opens_at: saved.registrationOpensAt,
        registration_closes_at: saved.registrationClosesAt,
      },
    });
    return toContestDto(manager, saved);
  });
}

export async function closeContest(contestId: string, providerId: string): Promise<ContestDto> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    assertOwner(contest, providerId);
    const before = { status: contest.status };
    if (contest.status !== ContestStatus.OPEN) {
      throw new AppError('Chỉ contest OPEN mới được đóng đăng ký', 409, 'CONTEST_STATUS_INVALID');
    }

    contest.status = ContestStatus.CLOSED;
    const saved = await manager.getRepository(Contest).save(contest);
    await writeContestAudit(manager, {
      contestId: saved.id,
      actorId: providerId,
      actorRole: UserRole.PROVIDER,
      eventType: 'contest.closed',
      beforeJson: before,
      afterJson: { status: saved.status },
    });
    return toContestDto(manager, saved);
  });
}

export async function cancelContest(contestId: string, providerId: string): Promise<ContestDto> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    assertOwner(contest, providerId);
    const before = { status: contest.status };
    if ([ContestStatus.CANCELLED, ContestStatus.COMPLETED].includes(contest.status)) {
      throw new AppError(
        'Contest không thể hủy ở trạng thái hiện tại',
        409,
        'CONTEST_STATUS_INVALID',
      );
    }
    contest.status = ContestStatus.CANCELLED;
    const cancelledRegistrations = await manager
      .getRepository(ContestRegistration)
      .createQueryBuilder()
      .update(ContestRegistration)
      .set({
        status: ContestRegistrationStatus.CANCELLED,
        cancelledBy: providerId,
        cancelledAt: new Date(),
        cancellationReason: 'Contest cancelled by provider',
      })
      .where('contest_id = :contestId', { contestId })
      .andWhere('status IN (:...statuses)', {
        statuses: [
          ContestRegistrationStatus.PENDING,
          ContestRegistrationStatus.CONFIRMED,
          ContestRegistrationStatus.CHECKED_IN,
        ],
      })
      .execute();
    const saved = await manager.getRepository(Contest).save(contest);
    await writeContestAudit(manager, {
      contestId: saved.id,
      actorId: providerId,
      actorRole: UserRole.PROVIDER,
      eventType: 'contest.cancelled',
      beforeJson: before,
      afterJson: {
        status: saved.status,
        cancelled_registration_count: cancelledRegistrations.affected ?? 0,
      },
      reason: 'Contest cancelled by provider',
    });
    return toContestDto(manager, saved);
  });
}

export async function getContestDetail(
  contestId: string,
  viewer?: Viewer,
  notifyWithinHours?: number,
): Promise<ContestDto> {
  const contest = await getContestOrThrow(AppDataSource.manager, contestId);
  if (!canViewerSeeContest(contest, viewer)) {
    throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  }
  return toContestDto(AppDataSource.manager, contest, notifyWithinHours);
}

export async function listContests(query: ListContestQuery, viewer?: Viewer) {
  const qb = AppDataSource.getRepository(Contest)
    .createQueryBuilder('contest')
    .orderBy('contest.startsAt', 'ASC')
    .skip((query.page - 1) * query.limit)
    .take(query.limit);

  if (viewer?.role === UserRole.PROVIDER) {
    qb.andWhere(
      new Brackets((where) => {
        where.where('contest.status IN (:...publicStatuses)', {
          publicStatuses: PUBLIC_CONTEST_STATUSES,
        });
        where.orWhere('contest.providerId = :providerId', { providerId: viewer.userId });
      }),
    );
  } else {
    qb.andWhere('contest.status IN (:...publicStatuses)', {
      publicStatuses: PUBLIC_CONTEST_STATUSES,
    });
  }

  if (query.status) {
    if (!PUBLIC_CONTEST_STATUSES.includes(query.status) && viewer?.role !== UserRole.PROVIDER) {
      qb.andWhere('1 = 0');
    } else {
      qb.andWhere('contest.status = :status', { status: query.status });
    }
  }

  if (query.upcoming) {
    qb.andWhere('contest.startsAt >= :now', { now: new Date() });
  }

  const [items, total] = await qb.getManyAndCount();
  return {
    data: await Promise.all(
      items.map((contest) =>
        toContestDto(AppDataSource.manager, contest, query.notify_within_hours),
      ),
    ),
    meta: { total, page: query.page, limit: query.limit },
  };
}

export async function listCafeContests(cafeId: string, query: ListContestQuery, viewer?: Viewer) {
  const cafeExists = await AppDataSource.getRepository(Cafe).exist({ where: { id: cafeId } });
  if (!cafeExists) throw new AppError('Cafe không tồn tại', 404, 'CAFE_NOT_FOUND');

  const qb = AppDataSource.getRepository(Contest)
    .createQueryBuilder('contest')
    .innerJoin(ContestCafe, 'contestCafe', 'contestCafe.contestId = contest.id')
    .where('contestCafe.cafeId = :cafeId', { cafeId })
    .orderBy('contest.startsAt', 'ASC')
    .skip((query.page - 1) * query.limit)
    .take(query.limit);

  if (viewer?.role === UserRole.PROVIDER) {
    qb.andWhere(
      new Brackets((where) => {
        where.where('contest.status IN (:...publicStatuses)', {
          publicStatuses: PUBLIC_CONTEST_STATUSES,
        });
        where.orWhere('contest.providerId = :providerId', { providerId: viewer.userId });
      }),
    );
  } else {
    qb.andWhere('contest.status IN (:...publicStatuses)', {
      publicStatuses: PUBLIC_CONTEST_STATUSES,
    });
  }

  if (query.status) {
    if (!PUBLIC_CONTEST_STATUSES.includes(query.status) && viewer?.role !== UserRole.PROVIDER) {
      qb.andWhere('1 = 0');
    } else {
      qb.andWhere('contest.status = :status', { status: query.status });
    }
  }

  if (query.upcoming) {
    qb.andWhere('contest.startsAt >= :now', { now: new Date() });
  }

  const [items, total] = await qb.getManyAndCount();
  return {
    data: await Promise.all(
      items.map((contest) =>
        toContestDto(AppDataSource.manager, contest, query.notify_within_hours),
      ),
    ),
    meta: { total, page: query.page, limit: query.limit },
  };
}

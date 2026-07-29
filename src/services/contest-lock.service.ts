import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Booking } from '../models/booking.entity';
import { CafeTrackConfig } from '../models/cafe-track-config.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { Contest } from '../models/contest.entity';
import { AppError, BookingStatus, ContestResourceScope, ContestStatus } from '../types';

export type ContestResourceLock = {
  cafe_id: string;
  scope: ContestResourceScope;
  track_config_ids: string[];
};

type ContestLockConflict = {
  contest_id: string;
  contest_name: string;
  cafe_id: string;
  scope: ContestResourceScope;
};

type BookingConflict = {
  booking_id: string;
  cafe_id: string;
  track_config_id: string | null;
  track_type_id: string;
  slot_start: Date;
  slot_end: Date;
  status: BookingStatus;
};

const ACTIVE_CONTEST_STATUSES = [
  ContestStatus.DRAFT,
  ContestStatus.OPEN,
  ContestStatus.CLOSED,
  ContestStatus.RUNNING,
];

const ACTIVE_BOOKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED];

function toResourceScope(value: unknown): ContestResourceScope {
  return value === ContestResourceScope.SELECTED_TRACKS
    ? ContestResourceScope.SELECTED_TRACKS
    : ContestResourceScope.FULL_BRANCH;
}

function parseResourceLocks(raw: unknown): ContestResourceLock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const value = item as Record<string, unknown>;
      if (typeof value.cafe_id !== 'string') return null;
      return {
        cafe_id: value.cafe_id,
        scope: toResourceScope(value.scope),
        track_config_ids: Array.isArray(value.track_config_ids)
          ? value.track_config_ids.filter(
              (trackId): trackId is string => typeof trackId === 'string',
            )
          : [],
      };
    })
    .filter((item): item is ContestResourceLock => Boolean(item));
}

export function getContestResourceLocks(config: Record<string, unknown> | null | undefined) {
  return parseResourceLocks(config?.resource_locks);
}

export async function resolveContestResourceLocks(
  participatingCafeIds: string[],
  config: Record<string, unknown> | null | undefined,
): Promise<ContestResourceLock[]> {
  const trackConfigs = participatingCafeIds.length
    ? await AppDataSource.getRepository(CafeTrackConfig).find({
        where: { cafeId: In(participatingCafeIds), isActive: true },
      })
    : [];

  const activeTrackConfigsByCafe = trackConfigs.reduce<Map<string, CafeTrackConfig[]>>(
    (map, item) => {
      const list = map.get(item.cafeId) ?? [];
      list.push(item);
      map.set(item.cafeId, list);
      return map;
    },
    new Map(),
  );

  const requestedLocks = new Map(
    getContestResourceLocks(config).map((lock) => [lock.cafe_id, lock]),
  );

  return participatingCafeIds.map((cafeId) => {
    const activeTrackConfigs = activeTrackConfigsByCafe.get(cafeId) ?? [];
    const requested = requestedLocks.get(cafeId);
    const activeTrackIds = activeTrackConfigs.map((item) => item.id);

    if (activeTrackConfigs.length <= 1) {
      return {
        cafe_id: cafeId,
        scope: ContestResourceScope.FULL_BRANCH,
        track_config_ids: activeTrackIds,
      };
    }

    if (requested?.scope === ContestResourceScope.SELECTED_TRACKS) {
      const selectedTrackIds = requested.track_config_ids.filter((trackId) =>
        activeTrackIds.includes(trackId),
      );
      if (selectedTrackIds.length > 0) {
        return {
          cafe_id: cafeId,
          scope: ContestResourceScope.SELECTED_TRACKS,
          track_config_ids: selectedTrackIds,
        };
      }
    }

    return {
      cafe_id: cafeId,
      scope: ContestResourceScope.FULL_BRANCH,
      track_config_ids: activeTrackIds,
    };
  });
}

export function mergeContestConfig(
  baseConfig: Record<string, unknown> | null | undefined,
  runtimeFormat: 'KNOCKOUT' | 'TIME_TRIAL',
  resourceLocks: ContestResourceLock[],
) {
  const nextConfig = {
    ...(baseConfig ?? {}),
    format: runtimeFormat,
    runtime_format: runtimeFormat,
    resource_locks: resourceLocks,
  } as Record<string, unknown>;

  if (runtimeFormat === 'KNOCKOUT') {
    nextConfig.leaderboard_mode = 'KNOCKOUT_WINS';
    if (typeof nextConfig.drivers_per_match !== 'number') nextConfig.drivers_per_match = 2;
  } else {
    if (nextConfig.leaderboard_mode === 'KNOCKOUT_WINS') {
      nextConfig.leaderboard_mode = 'BEST_LAP';
    }
    if (typeof nextConfig.drivers_per_match !== 'number') nextConfig.drivers_per_match = 1;
  }

  return nextConfig;
}

function contestLockBlocksTrack(
  lock: ContestResourceLock | undefined,
  trackConfigId?: string | null,
  trackTypeId?: string | null,
  contestTrackTypeId?: string | null,
) {
  if (!lock) return false;
  if (lock.scope === ContestResourceScope.FULL_BRANCH) return true;
  if (trackConfigId && lock.track_config_ids.includes(trackConfigId)) return true;
  return Boolean(trackTypeId && contestTrackTypeId && trackTypeId === contestTrackTypeId);
}

export async function findContestBookingConflicts(params: {
  startsAt: Date;
  endsAt: Date;
  trackTypeId: string;
  resourceLocks: ContestResourceLock[];
}) {
  const conflicts: BookingConflict[] = [];

  for (const lock of params.resourceLocks) {
    const qb = AppDataSource.getRepository(Booking)
      .createQueryBuilder('b')
      .select([
        'b.id AS booking_id',
        'b.cafe_id AS cafe_id',
        'b.track_config_id AS track_config_id',
        'b.track_type_id AS track_type_id',
        'b.slot_start AS slot_start',
        'b.slot_end AS slot_end',
        'b.status AS status',
      ])
      .where('b.cafe_id = :cafeId', { cafeId: lock.cafe_id })
      .andWhere('b.status IN (:...statuses)', { statuses: ACTIVE_BOOKING_STATUSES })
      .andWhere('b.slot_start < :endsAt', { endsAt: params.endsAt })
      .andWhere('b.slot_end > :startsAt', { startsAt: params.startsAt });

    if (lock.scope === ContestResourceScope.SELECTED_TRACKS) {
      qb.andWhere(
        '(b.track_config_id IN (:...trackConfigIds) OR (b.track_config_id IS NULL AND b.track_type_id = :trackTypeId))',
        {
          trackConfigIds: lock.track_config_ids,
          trackTypeId: params.trackTypeId,
        },
      );
    }

    const rows = await qb.getRawMany<BookingConflict>();
    conflicts.push(...rows);
  }

  return conflicts;
}

export async function assertNoContestBookingConflicts(params: {
  startsAt: Date;
  endsAt: Date;
  trackTypeId: string;
  resourceLocks: ContestResourceLock[];
}) {
  const conflicts = await findContestBookingConflicts(params);
  if (conflicts.length === 0) return;

  const sample = conflicts
    .slice(0, 3)
    .map(
      (item) =>
        `booking ${item.booking_id.slice(0, 8)} (${new Date(item.slot_start).toLocaleString('vi-VN')} - ${new Date(item.slot_end).toLocaleTimeString('vi-VN')})`,
    )
    .join(', ');

  throw new AppError(
    `Khung giờ hoặc sân đã có booking trùng với lịch tổ chức giải đấu${sample ? `: ${sample}` : ''}`,
    409,
    'CONTEST_BOOKING_CONFLICT',
  );
}

export async function findContestLockConflictForBooking(params: {
  cafeId: string;
  slotStart: Date;
  slotEnd: Date;
  trackConfigId?: string | null;
  trackTypeId?: string | null;
  contestId?: string | null;
}) {
  const contests = await AppDataSource.getRepository(Contest)
    .createQueryBuilder('contest')
    .innerJoin(ContestCafe, 'contestCafe', 'contestCafe.contest_id = contest.id')
    .where('contestCafe.cafe_id = :cafeId', { cafeId: params.cafeId })
    .andWhere('contest.status IN (:...statuses)', { statuses: ACTIVE_CONTEST_STATUSES })
    .andWhere('contest.starts_at < :slotEnd', { slotEnd: params.slotEnd })
    .andWhere('contest.ends_at > :slotStart', { slotStart: params.slotStart })
    .getMany();

  for (const contest of contests) {
    if (params.contestId && contest.id === params.contestId) continue;

    const locks = getContestResourceLocks(contest.config);
    const matchingLock = locks.find((item) => item.cafe_id === params.cafeId);
    if (
      contestLockBlocksTrack(
        matchingLock,
        params.trackConfigId,
        params.trackTypeId,
        contest.trackTypeId,
      )
    ) {
      return {
        contest_id: contest.id,
        contest_name: contest.name,
        cafe_id: params.cafeId,
        scope: matchingLock?.scope ?? ContestResourceScope.FULL_BRANCH,
      } satisfies ContestLockConflict;
    }
  }

  return null;
}

export async function assertBookingNotBlockedByContest(params: {
  cafeId: string;
  slotStart: Date;
  slotEnd: Date;
  trackConfigId?: string | null;
  trackTypeId?: string | null;
  contestId?: string | null;
}) {
  const conflict = await findContestLockConflictForBooking(params);
  if (!conflict) return;

  throw new AppError(
    `Khung giờ này đã được giữ riêng cho giải đấu "${conflict.contest_name}"`,
    409,
    'CONTEST_SLOT_LOCKED',
  );
}

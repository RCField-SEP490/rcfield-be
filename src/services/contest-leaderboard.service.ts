import { AppDataSource } from '../config/database';
import { IsNull } from 'typeorm';
import { Contest } from '../models/contest.entity';
import { ContestLeaderboardSnapshot } from '../models/contest-leaderboard-snapshot.entity';
import { ContestRewardClaim } from '../models/contest-reward-claim.entity';
import { ContestReward } from '../models/contest-reward.entity';
import {
  AppError,
  ContestResultStatus,
  ContestRewardClaimStatus,
  ContestRewardType,
} from '../types';

interface Standing {
  rank: number;
  registration_id: string;
  user_id: string;
  result_type: string;
  source_result_id: string;
  score_ms: number | null;
  finish_position: number | null;
}

export interface PublishLeaderboardBody {
  contest_class_id?: string | null;
  scope?: string;
}

export interface CreateContestRewardBody {
  contest_class_id?: string | null;
  title: string;
  description?: string | null;
  reward_type: ContestRewardType;
  position: number;
  quantity: number;
  is_published: boolean;
  metadata?: Record<string, unknown>;
}

async function getContestOrThrow(contestId: string): Promise<Contest> {
  const contest = await AppDataSource.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  return contest;
}

function assertContestOwner(contest: Contest, providerId: string): void {
  if (contest.providerId !== providerId) {
    throw new AppError('Bạn không có quyền thao tác contest này', 403, 'CONTEST_FORBIDDEN');
  }
}

export async function computeLeaderboard(
  contestId: string,
  contestClassId?: string | null,
): Promise<Standing[]> {
  await getContestOrThrow(contestId);
  const rows = await AppDataSource.query<
    {
      result_id: string;
      registration_id: string;
      user_id: string;
      result_type: string;
      best_lap_ms: number | null;
      total_time_ms: number | null;
      finish_position: number | null;
      penalty_ms: number;
    }[]
  >(
    `
      SELECT
        r.id AS result_id,
        r.registration_id,
        cr.user_id,
        r.result_type,
        r.best_lap_ms,
        r.total_time_ms,
        r.finish_position,
        r.penalty_ms
      FROM contest_results r
      JOIN contest_registrations cr ON cr.id = r.registration_id
      JOIN contest_heat_entries he ON he.id = r.heat_entry_id
      WHERE r.contest_id = $1
        AND r.status = $2
        AND ($3::uuid IS NULL OR he.contest_class_id = $3::uuid)
    `,
    [contestId, ContestResultStatus.VERIFIED, contestClassId ?? null],
  );

  const bestByRegistration = new Map<string, Standing>();
  for (const row of rows) {
    const score =
      row.result_type === 'TIME_ATTACK' && row.best_lap_ms !== null
        ? Number(row.best_lap_ms) + Number(row.penalty_ms)
        : row.finish_position !== null
          ? Number(row.finish_position)
          : Number.MAX_SAFE_INTEGER;
    const candidate: Standing = {
      rank: 0,
      registration_id: row.registration_id,
      user_id: row.user_id,
      result_type: row.result_type,
      source_result_id: row.result_id,
      score_ms: row.result_type === 'TIME_ATTACK' ? score : null,
      finish_position: row.result_type === 'RACE_FINAL' ? Number(row.finish_position) : null,
    };
    const existing = bestByRegistration.get(row.registration_id);
    const existingScore =
      existing?.score_ms ?? existing?.finish_position ?? Number.MAX_SAFE_INTEGER;
    if (!existing || score < existingScore) {
      bestByRegistration.set(row.registration_id, candidate);
    }
  }

  return Array.from(bestByRegistration.values())
    .sort((a, b) => {
      const aScore = a.score_ms ?? a.finish_position ?? Number.MAX_SAFE_INTEGER;
      const bScore = b.score_ms ?? b.finish_position ?? Number.MAX_SAFE_INTEGER;
      return aScore - bScore;
    })
    .map((standing, index) => ({ ...standing, rank: index + 1 }));
}

export async function publishLeaderboard(
  contestId: string,
  providerId: string,
  body: PublishLeaderboardBody,
): Promise<ContestLeaderboardSnapshot> {
  const contest = await getContestOrThrow(contestId);
  assertContestOwner(contest, providerId);
  const standings = await computeLeaderboard(contestId, body.contest_class_id);
  const standingsPayload = standings.map((standing) => ({ ...standing }));

  const snapshot = AppDataSource.getRepository(ContestLeaderboardSnapshot).create({
    contestId,
    contestClassId: body.contest_class_id ?? null,
    scope: body.scope ?? 'OVERALL',
    standings: standingsPayload,
    publishedBy: providerId,
    publishedAt: new Date(),
  });
  return AppDataSource.getRepository(ContestLeaderboardSnapshot).save(snapshot);
}

export async function createReward(
  contestId: string,
  providerId: string,
  body: CreateContestRewardBody,
): Promise<ContestReward> {
  const contest = await getContestOrThrow(contestId);
  assertContestOwner(contest, providerId);

  const reward = AppDataSource.getRepository(ContestReward).create({
    contestId,
    contestClassId: body.contest_class_id ?? null,
    title: body.title,
    description: body.description ?? null,
    rewardType: body.reward_type,
    position: body.position,
    quantity: body.quantity,
    isPublished: body.is_published,
    metadata: body.metadata ?? {},
    createdBy: providerId,
  });
  return AppDataSource.getRepository(ContestReward).save(reward);
}

export async function listRewards(contestId: string): Promise<ContestReward[]> {
  await getContestOrThrow(contestId);
  return AppDataSource.getRepository(ContestReward).find({
    where: { contestId, isPublished: true },
    order: { position: 'ASC', createdAt: 'ASC' },
  });
}

export async function issueRewardClaims(
  contestId: string,
  providerId: string,
  contestClassId?: string | null,
): Promise<ContestRewardClaim[]> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await manager.getRepository(Contest).findOne({ where: { id: contestId } });
    if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
    assertContestOwner(contest, providerId);

    const rewards = await manager.getRepository(ContestReward).find({
      where: {
        contestId,
        contestClassId: contestClassId ?? IsNull(),
        isPublished: true,
      },
      order: { position: 'ASC' },
    });
    if (rewards.length === 0) {
      throw new AppError('Contest chưa cấu hình reward', 409, 'CONTEST_REWARD_REQUIRED');
    }

    const standings = await computeLeaderboard(contestId, contestClassId);
    if (standings.length === 0) {
      throw new AppError('Leaderboard chưa có kết quả verified', 409, 'CONTEST_LEADERBOARD_EMPTY');
    }

    const rewardIds = rewards.map((reward) => reward.id);
    const existing = await manager
      .getRepository(ContestRewardClaim)
      .createQueryBuilder('claim')
      .where('claim.contestRewardId IN (:...rewardIds)', { rewardIds })
      .getCount();
    if (existing > 0) {
      throw new AppError(
        'Reward claims đã được phát trước đó',
        409,
        'CONTEST_REWARD_ALREADY_ISSUED',
      );
    }

    const claims: ContestRewardClaim[] = [];
    for (const reward of rewards) {
      const standing = standings.find((item) => item.rank === reward.position);
      if (!standing) continue;
      const claim = manager.getRepository(ContestRewardClaim).create({
        contestRewardId: reward.id,
        contestId,
        registrationId: standing.registration_id,
        userId: standing.user_id,
        sourceResultId: standing.source_result_id,
        status: ContestRewardClaimStatus.ISSUED,
        issuedBy: providerId,
        issuedAt: new Date(),
        metadata: {},
      });
      claims.push(await manager.getRepository(ContestRewardClaim).save(claim));
    }

    return claims;
  });
}

export async function listMyRewardClaims(userId: string): Promise<ContestRewardClaim[]> {
  return AppDataSource.getRepository(ContestRewardClaim).find({
    where: { userId },
    order: { issuedAt: 'DESC' },
  });
}

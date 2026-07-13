import { AppDataSource } from '../config/database';
import { ContestAuditLog } from '../models/contest-audit-log.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { Contest } from '../models/contest.entity';
import { AppError, UserRole } from '../types';
import { Viewer } from './cafe.service';

export function assertProviderViewer(viewer?: Viewer): asserts viewer is Viewer {
  if (!viewer || viewer.role !== UserRole.PROVIDER) {
    throw new AppError('Bạn không có quyền thao tác contest này', 403, 'FORBIDDEN');
  }
}

export async function getContestOrThrow(contestId: string): Promise<Contest> {
  const contest = await AppDataSource.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  return contest;
}

export async function assertContestOwner(contestId: string, viewer: Viewer): Promise<Contest> {
  const contest = await getContestOrThrow(contestId);
  if (viewer.role !== UserRole.PROVIDER || contest.providerId !== viewer.userId) {
    throw new AppError('Bạn không sở hữu contest này', 403, 'FORBIDDEN');
  }
  return contest;
}

export async function isStaffAssignedToContest(
  contestId: string,
  staffId: string,
): Promise<boolean> {
  const assigned = await AppDataSource.query(
    `SELECT 1
     FROM staff_cafe_assignments a
     JOIN contest_cafes cc ON cc.cafe_id = a.cafe_id
     WHERE a.staff_id = $1 AND cc.contest_id = $2
     LIMIT 1`,
    [staffId, contestId],
  );
  return assigned.length > 0;
}

export async function isStaffAssignedToCafe(staffId: string, cafeId: string): Promise<boolean> {
  const assigned = await AppDataSource.query(
    `SELECT 1
     FROM staff_cafe_assignments
     WHERE staff_id = $1 AND cafe_id = $2
     LIMIT 1`,
    [staffId, cafeId],
  );
  return assigned.length > 0;
}

export async function listContestCafeIds(contestId: string): Promise<string[]> {
  const rows = await AppDataSource.getRepository(ContestCafe).find({
    where: { contestId },
    order: { displayOrder: 'ASC' },
  });
  return rows.map((item) => item.cafeId);
}

export async function writeContestAudit(
  payload: Partial<ContestAuditLog> & { contestId: string; eventType: string },
): Promise<void> {
  const repo = AppDataSource.getRepository(ContestAuditLog);
  const audit = repo.create({
    contestId: payload.contestId,
    registrationId: payload.registrationId ?? null,
    matchId: payload.matchId ?? null,
    actorId: payload.actorId ?? null,
    actorRole: payload.actorRole ?? null,
    eventType: payload.eventType,
    beforeJson: payload.beforeJson ?? null,
    afterJson: payload.afterJson ?? null,
    reason: payload.reason ?? null,
    metadata: payload.metadata ?? {},
  });
  await repo.save(audit);
}

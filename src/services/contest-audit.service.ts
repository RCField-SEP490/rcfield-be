import { EntityManager } from 'typeorm';
import { logger } from '../config/logger';
import { ContestAuditLog } from '../models/contest-audit-log.entity';
import { AppError, ContestRegistrationStatus, UserRole } from '../types';
import { AppDataSource } from '../config/database';
import { Contest } from '../models/contest.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { ContestMatch } from '../models/contest-match.entity';

interface ContestAuditInput {
  contestId: string;
  registrationId?: string | null;
  matchId?: string | null;
  actorId?: string | null;
  actorRole?: UserRole | string | null;
  eventType: string;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Viewer {
  userId: string;
  role: UserRole;
}

async function assertOperator(
  manager: EntityManager,
  contestId: string,
  viewer: Viewer,
): Promise<void> {
  const contest = await manager.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');

  if (viewer.role === UserRole.PROVIDER && contest.providerId === viewer.userId) return;
  if (viewer.role === UserRole.STAFF) {
    const row = await manager
      .getRepository(ContestCafe)
      .createQueryBuilder('contestCafe')
      .innerJoin(
        'staff_cafe_assignments',
        'assignment',
        'assignment.cafe_id = contestCafe.cafeId AND assignment.staff_id = :staffId',
        { staffId: viewer.userId },
      )
      .where('contestCafe.contestId = :contestId', { contestId })
      .getOne();
    if (row) return;
  }
  throw new AppError(
    'Bạn không có quyền xem thông tin vận hành contest này',
    403,
    'CONTEST_OPERATOR_FORBIDDEN',
  );
}

export async function writeContestAudit(
  manager: EntityManager,
  input: ContestAuditInput,
): Promise<ContestAuditLog> {
  const row = manager.getRepository(ContestAuditLog).create({
    contestId: input.contestId,
    registrationId: input.registrationId ?? null,
    matchId: input.matchId ?? null,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    eventType: input.eventType,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  });
  const saved = await manager.getRepository(ContestAuditLog).save(row);
  logger.info('ContestAudit', input.eventType, {
    auditLogId: saved.id,
    contestId: input.contestId,
    registrationId: input.registrationId ?? undefined,
    matchId: input.matchId ?? undefined,
    actorId: input.actorId ?? undefined,
    actorRole: input.actorRole ?? undefined,
    reason: input.reason ?? undefined,
    metadata: input.metadata ?? {},
  });
  return saved;
}

export async function listContestAuditLogs(
  contestId: string,
  viewer: Viewer,
): Promise<ContestAuditLog[]> {
  return AppDataSource.transaction(async (manager) => {
    await assertOperator(manager, contestId, viewer);
    return manager.getRepository(ContestAuditLog).find({
      where: { contestId },
      order: { createdAt: 'DESC' },
    });
  });
}

export async function getContestMetrics(
  contestId: string,
  viewer: Viewer,
): Promise<Record<string, unknown>> {
  return AppDataSource.transaction(async (manager) => {
    await assertOperator(manager, contestId, viewer);

    const registrations = await manager.getRepository(ContestRegistration).find({
      where: { contestId },
    });

    const regStats = {
      total: registrations.length,
      pending: registrations.filter((r) => r.status === ContestRegistrationStatus.PENDING).length,
      confirmed: registrations.filter((r) => r.status === ContestRegistrationStatus.CONFIRMED)
        .length,
      checkedIn: registrations.filter((r) => r.status === ContestRegistrationStatus.CHECKED_IN)
        .length,
      cancelled: registrations.filter((r) => r.status === ContestRegistrationStatus.CANCELLED)
        .length,
    };

    const matches = await manager.getRepository(ContestMatch).find({
      where: { contestId },
    });

    const matchStats = {
      total: matches.length,
      draft: matches.filter((m) => m.status === 'DRAFT').length,
      ready: matches.filter((m) => m.status === 'READY').length,
      completed: matches.filter((m) => m.status === 'COMPLETED').length,
      cancelled: matches.filter((m) => m.status === 'CANCELLED').length,
    };

    return {
      registration_stats: regStats,
      match_stats: matchStats,
    };
  });
}

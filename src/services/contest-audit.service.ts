import { EntityManager } from 'typeorm';
import { logger } from '../config/logger';
import { ContestAuditLog } from '../models/contest-audit-log.entity';
import { UserRole } from '../types';

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

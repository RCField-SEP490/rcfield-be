import { EntityManager } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Contest } from '../models/contest.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestClass } from '../models/contest-class.entity';
import { ContestHeatEntry } from '../models/contest-heat-entry.entity';
import { ContestHeat } from '../models/contest-heat.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { ContestResult } from '../models/contest-result.entity';
import { ContestRound } from '../models/contest-round.entity';
import {
  AppError,
  ContestRegistrationStatus,
  ContestResultStatus,
  ContestResultType,
  ContestRoundType,
  UserRole,
} from '../types';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface CreateContestClassBody {
  code: string;
  name: string;
  track_type_id?: string | null;
  rules?: Record<string, unknown>;
  capacity?: number | null;
  display_order?: number;
  is_active?: boolean;
}

export interface CreateContestRoundBody {
  contest_class_id: string;
  round_type: ContestRoundType;
  round_no: number;
  name?: string | null;
  scheduled_at?: Date | null;
  rules?: Record<string, unknown>;
}

export interface CreateContestHeatBody {
  heat_no: number;
  scheduled_at?: Date | null;
  config?: Record<string, unknown>;
}

export interface AddContestHeatEntryBody {
  registration_id: string;
  contest_class_id?: string | null;
  grid_position?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ContestResultItemBody {
  heat_entry_id: string;
  best_lap_ms?: number | null;
  total_time_ms?: number | null;
  finish_position?: number | null;
  laps_completed?: number | null;
  penalty_ms?: number;
  dnf?: boolean;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SubmitContestHeatResultsBody {
  result_type: ContestResultType;
  results: ContestResultItemBody[];
}

function assertProviderOwner(contest: Contest, providerId: string): void {
  if (contest.providerId !== providerId) {
    throw new AppError('Bạn không có quyền thao tác contest này', 403, 'CONTEST_FORBIDDEN');
  }
}

async function getContestOrThrow(manager: EntityManager, contestId: string): Promise<Contest> {
  const contest = await manager.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  return contest;
}

async function assertOperator(
  manager: EntityManager,
  contest: Contest,
  viewer: Viewer,
): Promise<void> {
  if (viewer.role === UserRole.PROVIDER) {
    assertProviderOwner(contest, viewer.userId);
    return;
  }
  if (viewer.role !== UserRole.STAFF) {
    throw new AppError(
      'Role hiện tại không được vận hành contest',
      403,
      'CONTEST_OPERATOR_FORBIDDEN',
    );
  }

  const row = await manager
    .getRepository(ContestCafe)
    .createQueryBuilder('contestCafe')
    .innerJoin(
      'staff_cafe_assignments',
      'assignment',
      'assignment.cafe_id = contestCafe.cafeId AND assignment.staff_id = :staffId',
      { staffId: viewer.userId },
    )
    .where('contestCafe.contestId = :contestId', { contestId: contest.id })
    .getOne();

  if (!row) {
    throw new AppError(
      'Staff không thuộc chi nhánh tham gia contest',
      403,
      'CONTEST_OPERATOR_FORBIDDEN',
    );
  }
}

async function getRoundOrThrow(manager: EntityManager, roundId: string): Promise<ContestRound> {
  const round = await manager.getRepository(ContestRound).findOne({ where: { id: roundId } });
  if (!round) throw new AppError('Round không tồn tại', 404, 'CONTEST_ROUND_NOT_FOUND');
  return round;
}

async function getHeatOrThrow(manager: EntityManager, heatId: string): Promise<ContestHeat> {
  const heat = await manager.getRepository(ContestHeat).findOne({ where: { id: heatId } });
  if (!heat) throw new AppError('Heat không tồn tại', 404, 'CONTEST_HEAT_NOT_FOUND');
  return heat;
}

async function getHeatEntryOrThrow(
  manager: EntityManager,
  heatEntryId: string,
): Promise<ContestHeatEntry> {
  const entry = await manager
    .getRepository(ContestHeatEntry)
    .findOne({ where: { id: heatEntryId } });
  if (!entry) throw new AppError('Heat entry không tồn tại', 404, 'CONTEST_HEAT_ENTRY_NOT_FOUND');
  return entry;
}

async function getResultOrThrow(manager: EntityManager, resultId: string): Promise<ContestResult> {
  const result = await manager.getRepository(ContestResult).findOne({ where: { id: resultId } });
  if (!result) throw new AppError('Result không tồn tại', 404, 'CONTEST_RESULT_NOT_FOUND');
  return result;
}

function assertResultFields(resultType: ContestResultType, item: ContestResultItemBody): void {
  if (resultType === ContestResultType.TIME_ATTACK && !item.best_lap_ms) {
    throw new AppError('TIME_ATTACK cần best_lap_ms', 400, 'CONTEST_RESULT_INVALID');
  }
  if (resultType === ContestResultType.RACE_FINAL && !item.finish_position) {
    throw new AppError('RACE_FINAL cần finish_position', 400, 'CONTEST_RESULT_INVALID');
  }
}

export async function createContestClass(
  contestId: string,
  providerId: string,
  body: CreateContestClassBody,
): Promise<ContestClass> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    assertProviderOwner(contest, providerId);

    if (body.track_type_id) {
      const rows = await manager.query<{ id: string }[]>(
        `SELECT id FROM track_types WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [body.track_type_id],
      );
      if (rows.length === 0) {
        throw new AppError('Loại đường đua không tồn tại hoặc đã tắt', 400, 'TRACK_TYPE_INVALID');
      }
    }

    const entity = manager.getRepository(ContestClass).create({
      contestId,
      code: body.code,
      name: body.name,
      trackTypeId: body.track_type_id ?? null,
      rules: body.rules ?? {},
      capacity: body.capacity ?? null,
      displayOrder: body.display_order ?? 0,
      isActive: body.is_active ?? true,
    });
    return manager.getRepository(ContestClass).save(entity);
  });
}

export async function createContestRound(
  contestId: string,
  providerId: string,
  body: CreateContestRoundBody,
): Promise<ContestRound> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    assertProviderOwner(contest, providerId);

    const contestClass = await manager
      .getRepository(ContestClass)
      .findOne({ where: { id: body.contest_class_id, contestId } });
    if (!contestClass)
      throw new AppError('Contest class không tồn tại', 404, 'CONTEST_CLASS_NOT_FOUND');

    const entity = manager.getRepository(ContestRound).create({
      contestId,
      contestClassId: body.contest_class_id,
      roundType: body.round_type,
      roundNo: body.round_no,
      name: body.name ?? null,
      scheduledAt: body.scheduled_at ?? null,
      rules: body.rules ?? {},
    });
    return manager.getRepository(ContestRound).save(entity);
  });
}

export async function createContestHeat(
  roundId: string,
  viewer: Viewer,
  body: CreateContestHeatBody,
): Promise<ContestHeat> {
  return AppDataSource.transaction(async (manager) => {
    const round = await getRoundOrThrow(manager, roundId);
    const contest = await getContestOrThrow(manager, round.contestId);
    await assertOperator(manager, contest, viewer);

    const entity = manager.getRepository(ContestHeat).create({
      contestId: round.contestId,
      contestRoundId: round.id,
      heatNo: body.heat_no,
      scheduledAt: body.scheduled_at ?? null,
      config: body.config ?? {},
    });
    return manager.getRepository(ContestHeat).save(entity);
  });
}

export async function addContestHeatEntry(
  heatId: string,
  viewer: Viewer,
  body: AddContestHeatEntryBody,
): Promise<ContestHeatEntry> {
  return AppDataSource.transaction(async (manager) => {
    const heat = await getHeatOrThrow(manager, heatId);
    const contest = await getContestOrThrow(manager, heat.contestId);
    await assertOperator(manager, contest, viewer);

    const registration = await manager
      .getRepository(ContestRegistration)
      .findOne({ where: { id: body.registration_id, contestId: contest.id } });
    if (!registration) {
      throw new AppError(
        'Registration không thuộc contest này',
        404,
        'CONTEST_REGISTRATION_NOT_FOUND',
      );
    }
    if (registration.status !== ContestRegistrationStatus.CHECKED_IN) {
      throw new AppError(
        'Chỉ participant đã check-in mới được thêm vào heat',
        409,
        'CONTEST_REGISTRATION_STATUS_INVALID',
      );
    }

    if (body.contest_class_id) {
      const contestClass = await manager
        .getRepository(ContestClass)
        .findOne({ where: { id: body.contest_class_id, contestId: contest.id } });
      if (!contestClass)
        throw new AppError('Contest class không tồn tại', 404, 'CONTEST_CLASS_NOT_FOUND');
    }

    const entity = manager.getRepository(ContestHeatEntry).create({
      heatId,
      registrationId: registration.id,
      contestClassId: body.contest_class_id ?? null,
      gridPosition: body.grid_position ?? null,
      metadata: body.metadata ?? {},
    });
    return manager.getRepository(ContestHeatEntry).save(entity);
  });
}

export async function submitContestHeatResults(
  heatId: string,
  viewer: Viewer,
  body: SubmitContestHeatResultsBody,
): Promise<ContestResult[]> {
  return AppDataSource.transaction(async (manager) => {
    const heat = await getHeatOrThrow(manager, heatId);
    const contest = await getContestOrThrow(manager, heat.contestId);
    await assertOperator(manager, contest, viewer);

    const savedResults: ContestResult[] = [];
    for (const item of body.results) {
      assertResultFields(body.result_type, item);
      const entry = await getHeatEntryOrThrow(manager, item.heat_entry_id);
      if (entry.heatId !== heatId) {
        throw new AppError('Heat entry không thuộc heat này', 400, 'CONTEST_HEAT_ENTRY_INVALID');
      }

      const existing = await manager
        .getRepository(ContestResult)
        .findOne({ where: { heatEntryId: entry.id } });
      if (existing?.status === ContestResultStatus.VERIFIED) {
        throw new AppError(
          'Result đã verify không thể chỉnh sửa',
          409,
          'CONTEST_RESULT_ALREADY_VERIFIED',
        );
      }

      const result =
        existing ??
        manager.getRepository(ContestResult).create({
          contestId: contest.id,
          heatId,
          heatEntryId: entry.id,
          registrationId: entry.registrationId,
          submittedBy: viewer.userId,
        });

      result.resultType = body.result_type;
      result.bestLapMs = item.best_lap_ms ?? null;
      result.totalTimeMs = item.total_time_ms ?? null;
      result.finishPosition = item.finish_position ?? null;
      result.lapsCompleted = item.laps_completed ?? null;
      result.penaltyMs = item.penalty_ms ?? 0;
      result.dnf = item.dnf ?? false;
      result.notes = item.notes ?? null;
      result.metadata = item.metadata ?? {};
      result.status = ContestResultStatus.SUBMITTED;

      savedResults.push(await manager.getRepository(ContestResult).save(result));
    }
    return savedResults;
  });
}

export async function verifyContestResult(
  resultId: string,
  viewer: Viewer,
): Promise<ContestResult> {
  return AppDataSource.transaction(async (manager) => {
    const result = await getResultOrThrow(manager, resultId);
    const contest = await getContestOrThrow(manager, result.contestId);
    await assertOperator(manager, contest, viewer);

    result.status = ContestResultStatus.VERIFIED;
    result.verifiedBy = viewer.userId;
    result.verifiedAt = new Date();
    return manager.getRepository(ContestResult).save(result);
  });
}

import { EntityManager, In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Contest } from '../models/contest.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestMatchParticipant } from '../models/contest-match-participant.entity';
import { ContestMatch } from '../models/contest-match.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import {
  AppError,
  ContestMatchParticipantStatus,
  ContestMatchStatus,
  ContestMatchType,
  ContestRegistrationStatus,
  ContestScheduleFormat,
  ContestSeedingMode,
  ContestStatus,
  UserRole,
} from '../types';
import { writeContestAudit } from './contest-audit.service';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface GenerateContestMatchesBody {
  format: ContestScheduleFormat;
  drivers_per_match: number;
  registration_ids: string[];
  seeding_mode: ContestSeedingMode;
  advancement_rule?: Record<string, unknown>;
  cafe_id?: string | null;
  track_config_id?: string | null;
}

export interface UpdateContestMatchParticipantsBody {
  participants: Array<{
    registration_id: string;
    slot_no: number;
    lane?: string | null;
    grid_position?: number | null;
    seed_no?: number | null;
    metadata?: Record<string, unknown>;
  }>;
}

export interface SubmitContestMatchResultsBody {
  results: Array<{
    registration_id: string;
    finish_position?: number | null;
    score?: number | null;
    best_lap_ms?: number | null;
    total_time_ms?: number | null;
    is_winner?: boolean;
    result_note?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  reason?: string;
}

export interface AdvanceContestMatchBody {
  next_match_id?: string | null;
  top_n?: number;
  reason?: string;
}

export interface PublishContestLeaderboardBody {
  reason?: string;
}

interface ParticipantDto {
  id: string;
  match_id: string;
  registration_id: string;
  slot_no: number;
  lane: string | null;
  grid_position: number | null;
  seed_no: number | null;
  status: ContestMatchParticipantStatus;
  score: number | null;
  finish_position: number | null;
  best_lap_ms: number | null;
  total_time_ms: number | null;
  is_winner: boolean;
  result_note: string | null;
  metadata: Record<string, unknown>;
  registration?: {
    id: string;
    user_id: string;
    status: ContestRegistrationStatus;
    check_in_code: string;
    user: {
      id: string;
      fullName: string;
      email: string;
      avatarUrl: string | null;
    } | null;
  };
}

interface MatchDto {
  id: string;
  contest_id: string;
  round_no: number;
  match_no: number;
  name: string | null;
  match_type: ContestMatchType;
  status: ContestMatchStatus;
  cafe_id: string | null;
  track_config_id: string | null;
  scheduled_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  next_match_id: string | null;
  advancement_rule: Record<string, unknown>;
  result_summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  participants: ParticipantDto[];
  created_by: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const ALLOWED_SCHEDULE_REGISTRATION_STATUSES = [
  ContestRegistrationStatus.CONFIRMED,
  ContestRegistrationStatus.CHECKED_IN,
];

function scoreValue(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === 'string' ? Number(value) : value;
}

function getTopN(rule: Record<string, unknown>, fallback = 1): number {
  const value = rule.top_n;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

async function getContestOrThrow(manager: EntityManager, contestId: string): Promise<Contest> {
  const contest = await manager.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  return contest;
}

async function getMatchOrThrow(manager: EntityManager, matchId: string): Promise<ContestMatch> {
  const match = await manager.getRepository(ContestMatch).findOne({ where: { id: matchId } });
  if (!match) throw new AppError('Match không tồn tại', 404, 'CONTEST_MATCH_NOT_FOUND');
  return match;
}

async function assertOperator(
  manager: EntityManager,
  contest: Contest,
  viewer: Viewer,
): Promise<void> {
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
      .where('contestCafe.contestId = :contestId', { contestId: contest.id })
      .getOne();
    if (row) return;
  }
  throw new AppError('Bạn không có quyền vận hành contest này', 403, 'CONTEST_OPERATOR_FORBIDDEN');
}

async function getRegistrationsForSchedule(
  manager: EntityManager,
  contestId: string,
  registrationIds: string[],
): Promise<ContestRegistration[]> {
  const ids = uniqueIds(registrationIds);
  const registrations = await manager.getRepository(ContestRegistration).find({
    where: { id: In(ids), contestId },
    order: { createdAt: 'ASC' },
  });
  if (registrations.length !== ids.length) {
    throw new AppError(
      'Danh sách registration không thuộc contest này',
      400,
      'CONTEST_REGISTRATION_INVALID',
    );
  }
  const invalid = registrations.find(
    (registration) => !ALLOWED_SCHEDULE_REGISTRATION_STATUSES.includes(registration.status),
  );
  if (invalid) {
    throw new AppError(
      'Chỉ registration CONFIRMED hoặc CHECKED_IN mới được xếp lịch thi đấu',
      409,
      'CONTEST_REGISTRATION_STATUS_INVALID',
    );
  }
  return registrations;
}

function toParticipantDto(participant: ContestMatchParticipant): ParticipantDto {
  return {
    id: participant.id,
    match_id: participant.matchId,
    registration_id: participant.registrationId,
    slot_no: participant.slotNo,
    lane: participant.lane,
    grid_position: participant.gridPosition,
    seed_no: participant.seedNo,
    status: participant.status,
    score: scoreValue(participant.score),
    finish_position: participant.finishPosition,
    best_lap_ms: participant.bestLapMs,
    total_time_ms: participant.totalTimeMs,
    is_winner: participant.isWinner,
    result_note: participant.resultNote,
    metadata: participant.metadata,
  };
}

async function attachRegistrationSummaries(
  manager: EntityManager,
  participants: ParticipantDto[],
): Promise<void> {
  if (participants.length === 0) return;
  const ids = uniqueIds(participants.map((participant) => participant.registration_id));
  const rows = await manager.query<
    Array<{
      id: string;
      user_id: string;
      status: ContestRegistrationStatus;
      check_in_code: string;
      full_name: string | null;
      email: string | null;
      avatar_url: string | null;
    }>
  >(
    `SELECT r.id, r.user_id, r.status, r.check_in_code,
            u.full_name, u.email, u.avatar_url
       FROM contest_registrations r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = ANY($1::uuid[])`,
    [ids],
  );
  const map = new Map(rows.map((row) => [row.id, row]));
  for (const participant of participants) {
    const row = map.get(participant.registration_id);
    if (!row) continue;
    participant.registration = {
      id: row.id,
      user_id: row.user_id,
      status: row.status,
      check_in_code: row.check_in_code,
      user: row.email
        ? {
            id: row.user_id,
            fullName: row.full_name ?? '',
            email: row.email,
            avatarUrl: row.avatar_url,
          }
        : null,
    };
  }
}

async function toMatchDto(manager: EntityManager, match: ContestMatch): Promise<MatchDto> {
  const participants = (
    await manager.getRepository(ContestMatchParticipant).find({
      where: { matchId: match.id },
      order: { slotNo: 'ASC' },
    })
  ).map(toParticipantDto);
  await attachRegistrationSummaries(manager, participants);
  return {
    id: match.id,
    contest_id: match.contestId,
    round_no: match.roundNo,
    match_no: match.matchNo,
    name: match.name,
    match_type: match.matchType,
    status: match.status,
    cafe_id: match.cafeId,
    track_config_id: match.trackConfigId,
    scheduled_at: match.scheduledAt,
    started_at: match.startedAt,
    ended_at: match.endedAt,
    next_match_id: match.nextMatchId,
    advancement_rule: match.advancementRule,
    result_summary: match.resultSummary,
    metadata: match.metadata,
    participants,
    created_by: match.createdBy,
    decided_by: match.decidedBy,
    decided_at: match.decidedAt,
    created_at: match.createdAt,
    updated_at: match.updatedAt,
  };
}

export async function listContestMatches(contestId: string, viewer?: Viewer): Promise<MatchDto[]> {
  const contest = await getContestOrThrow(AppDataSource.manager, contestId);
  if (viewer) await assertOperator(AppDataSource.manager, contest, viewer);
  if (
    !viewer &&
    ![ContestStatus.CLOSED, ContestStatus.RUNNING, ContestStatus.COMPLETED].includes(contest.status)
  ) {
    throw new AppError('Contest chưa công bố lịch thi đấu', 404, 'CONTEST_MATCHES_NOT_FOUND');
  }

  const matches = await AppDataSource.getRepository(ContestMatch).find({
    where: { contestId },
    order: { roundNo: 'ASC', matchNo: 'ASC' },
  });
  return Promise.all(matches.map((match) => toMatchDto(AppDataSource.manager, match)));
}

function matchTypeFor(
  format: ContestScheduleFormat,
  driversPerMatch: number,
  isFinal: boolean,
): ContestMatchType {
  if (isFinal) return ContestMatchType.FINAL;
  if (format === ContestScheduleFormat.TIME_ATTACK) return ContestMatchType.TIME_ATTACK;
  if (driversPerMatch === 2) return ContestMatchType.HEAD_TO_HEAD;
  return ContestMatchType.MULTI_DRIVER;
}

async function createParticipants(
  manager: EntityManager,
  matchId: string,
  registrations: ContestRegistration[],
  offset = 0,
): Promise<void> {
  const rows = registrations.map((registration, index) =>
    manager.getRepository(ContestMatchParticipant).create({
      matchId,
      registrationId: registration.id,
      slotNo: offset + index + 1,
      lane: String.fromCharCode(65 + offset + index),
      gridPosition: offset + index + 1,
      seedNo: offset + index + 1,
      status: ContestMatchParticipantStatus.READY,
      metadata: {},
    }),
  );
  if (rows.length > 0) await manager.getRepository(ContestMatchParticipant).save(rows);
}

async function generateKnockout(
  manager: EntityManager,
  contest: Contest,
  viewer: Viewer,
  registrations: ContestRegistration[],
  driversPerMatch: number,
  advancementRule: Record<string, unknown>,
  cafeId: string | null = null,
  trackConfigId: string | null = null,
): Promise<ContestMatch[]> {
  if (driversPerMatch < 2) {
    throw new AppError('Knockout cần ít nhất 2 người mỗi match', 400, 'CONTEST_MATCH_SIZE_INVALID');
  }
  const roundCount = Math.ceil(Math.log(registrations.length) / Math.log(driversPerMatch));
  const matchesByRound = new Map<number, ContestMatch[]>();

  for (let roundNo = 1; roundNo <= Math.max(roundCount, 1); roundNo += 1) {
    const matchCount =
      roundNo === 1
        ? Math.ceil(registrations.length / driversPerMatch)
        : Math.ceil((matchesByRound.get(roundNo - 1)?.length ?? 1) / driversPerMatch);
    const matches: ContestMatch[] = [];
    for (let matchNo = 1; matchNo <= matchCount; matchNo += 1) {
      const isFinal = matchCount === 1 && roundNo > 1;
      matches.push(
        manager.getRepository(ContestMatch).create({
          contestId: contest.id,
          roundNo,
          matchNo,
          name: isFinal ? 'Final' : `Round ${roundNo} - Match ${matchNo}`,
          matchType: matchTypeFor(ContestScheduleFormat.KNOCKOUT, driversPerMatch, isFinal),
          status: roundNo === 1 ? ContestMatchStatus.READY : ContestMatchStatus.DRAFT,
          cafeId,
          trackConfigId,
          nextMatchId: null,
          advancementRule: { top_n: 1, ...advancementRule },
          resultSummary: {},
          metadata: {},
          createdBy: viewer.userId,
        }),
      );
    }
    matchesByRound.set(roundNo, await manager.getRepository(ContestMatch).save(matches));
  }

  const allMatches = Array.from(matchesByRound.values()).flat();
  for (let roundNo = 1; roundNo < Math.max(roundCount, 1); roundNo += 1) {
    const current = matchesByRound.get(roundNo) ?? [];
    const next = matchesByRound.get(roundNo + 1) ?? [];
    for (const match of current) {
      match.nextMatchId = next[Math.floor((match.matchNo - 1) / driversPerMatch)]?.id ?? null;
    }
    await manager.getRepository(ContestMatch).save(current);
  }

  const firstRound = matchesByRound.get(1) ?? [];
  for (const match of firstRound) {
    const start = (match.matchNo - 1) * driversPerMatch;
    await createParticipants(
      manager,
      match.id,
      registrations.slice(start, start + driversPerMatch),
    );
  }
  return allMatches;
}

async function generateGroupedMatches(
  manager: EntityManager,
  contest: Contest,
  viewer: Viewer,
  registrations: ContestRegistration[],
  format: ContestScheduleFormat,
  driversPerMatch: number,
  advancementRule: Record<string, unknown>,
  cafeId: string | null = null,
  trackConfigId: string | null = null,
): Promise<ContestMatch[]> {
  const matches: ContestMatch[] = [];
  for (let index = 0; index < registrations.length; index += driversPerMatch) {
    const group = registrations.slice(index, index + driversPerMatch);
    const matchNo = Math.floor(index / driversPerMatch) + 1;
    const match = await manager.getRepository(ContestMatch).save(
      manager.getRepository(ContestMatch).create({
        contestId: contest.id,
        roundNo: 1,
        matchNo,
        name: format === ContestScheduleFormat.TIME_ATTACK ? `Run ${matchNo}` : `Heat ${matchNo}`,
        matchType: matchTypeFor(
          format,
          driversPerMatch,
          matches.length === 0 && registrations.length <= driversPerMatch,
        ),
        status: ContestMatchStatus.READY,
        cafeId,
        trackConfigId,
        nextMatchId: null,
        advancementRule: { top_n: 1, ...advancementRule },
        resultSummary: {},
        metadata: {},
        createdBy: viewer.userId,
      }),
    );
    await createParticipants(manager, match.id, group);
    matches.push(match);
  }
  return matches;
}

export async function generateContestMatches(
  contestId: string,
  viewer: Viewer,
  body: GenerateContestMatchesBody,
): Promise<MatchDto[]> {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    await assertOperator(manager, contest, viewer);
    if (![ContestStatus.CLOSED, ContestStatus.RUNNING].includes(contest.status)) {
      throw new AppError(
        'Chỉ xếp lịch sau khi contest CLOSED hoặc RUNNING',
        409,
        'CONTEST_STATUS_INVALID',
      );
    }

    const existingCount = await manager.getRepository(ContestMatch).count({ where: { contestId } });
    if (existingCount > 0) {
      throw new AppError('Contest đã có lịch thi đấu', 409, 'CONTEST_MATCHES_ALREADY_GENERATED');
    }

    const registrations = await getRegistrationsForSchedule(
      manager,
      contestId,
      body.registration_ids,
    );
    const sortedRegistrations =
      body.seeding_mode === ContestSeedingMode.CHECK_IN_ORDER
        ? [...registrations].sort(
            (a, b) => (a.checkedInAt?.getTime() ?? 0) - (b.checkedInAt?.getTime() ?? 0),
          )
        : registrations;
    const config = {
      ...(contest.config ?? {}),
      format: body.format,
      drivers_per_match: body.drivers_per_match,
      seeding_mode: body.seeding_mode,
    };
    contest.config = config;
    const matches =
      body.format === ContestScheduleFormat.KNOCKOUT
        ? await generateKnockout(
            manager,
            contest,
            viewer,
            sortedRegistrations,
            body.drivers_per_match,
            body.advancement_rule ?? {},
            body.cafe_id ?? null,
            body.track_config_id ?? null,
          )
        : await generateGroupedMatches(
            manager,
            contest,
            viewer,
            sortedRegistrations,
            body.format,
            body.drivers_per_match,
            body.advancement_rule ?? {},
            body.cafe_id ?? null,
            body.track_config_id ?? null,
          );
    await manager.getRepository(Contest).save(contest);
    await writeContestAudit(manager, {
      contestId,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'match.schedule_generated',
      afterJson: {
        format: body.format,
        drivers_per_match: body.drivers_per_match,
        registration_ids: sortedRegistrations.map((registration) => registration.id),
        match_count: matches.length,
      },
    });

    await autoAdvanceByeMatches(manager, contestId, viewer.userId);

    const finalMatches = await manager.getRepository(ContestMatch).find({
      where: { contestId },
      order: { roundNo: 'ASC', matchNo: 'ASC' },
    });
    return Promise.all(finalMatches.map((match) => toMatchDto(manager, match)));
  });
}

export async function updateMatchParticipants(
  matchId: string,
  viewer: Viewer,
  body: UpdateContestMatchParticipantsBody,
): Promise<MatchDto> {
  return AppDataSource.transaction(async (manager) => {
    const match = await getMatchOrThrow(manager, matchId);
    const contest = await getContestOrThrow(manager, match.contestId);
    await assertOperator(manager, contest, viewer);
    if (match.status === ContestMatchStatus.COMPLETED) {
      throw new AppError(
        'Không thể đổi participants của match đã hoàn tất',
        409,
        'CONTEST_MATCH_COMPLETED',
      );
    }
    await getRegistrationsForSchedule(
      manager,
      contest.id,
      body.participants.map((item) => item.registration_id),
    );
    const before = (
      await manager.getRepository(ContestMatchParticipant).find({ where: { matchId } })
    ).map(toParticipantDto);
    await manager.getRepository(ContestMatchParticipant).delete({ matchId });
    const rows = body.participants.map((item) =>
      manager.getRepository(ContestMatchParticipant).create({
        matchId,
        registrationId: item.registration_id,
        slotNo: item.slot_no,
        lane: item.lane ?? null,
        gridPosition: item.grid_position ?? null,
        seedNo: item.seed_no ?? null,
        status: ContestMatchParticipantStatus.READY,
        metadata: item.metadata ?? {},
      }),
    );
    await manager.getRepository(ContestMatchParticipant).save(rows);
    match.status = ContestMatchStatus.READY;
    const savedMatch = await manager.getRepository(ContestMatch).save(match);
    await writeContestAudit(manager, {
      contestId: contest.id,
      matchId,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'match.participants_updated',
      beforeJson: { participants: before },
      afterJson: { participants: body.participants },
    });
    return toMatchDto(manager, savedMatch);
  });
}

export async function submitMatchResults(
  matchId: string,
  viewer: Viewer,
  body: SubmitContestMatchResultsBody,
): Promise<MatchDto> {
  return AppDataSource.transaction(async (manager) => {
    const match = await getMatchOrThrow(manager, matchId);
    const contest = await getContestOrThrow(manager, match.contestId);
    await assertOperator(manager, contest, viewer);
    if (match.status === ContestMatchStatus.CANCELLED) {
      throw new AppError('Match đã bị hủy', 409, 'CONTEST_MATCH_CANCELLED');
    }
    const participants = await manager
      .getRepository(ContestMatchParticipant)
      .find({ where: { matchId } });
    const participantByRegistration = new Map(
      participants.map((participant) => [participant.registrationId, participant]),
    );
    const missing = body.results.find(
      (result) => !participantByRegistration.has(result.registration_id),
    );
    if (missing) {
      throw new AppError(
        'Result chứa registration không thuộc match',
        400,
        'CONTEST_MATCH_RESULT_INVALID',
      );
    }
    const winnerCount = body.results.filter((result) => result.is_winner).length;
    if (match.matchType === ContestMatchType.HEAD_TO_HEAD && winnerCount > 1) {
      throw new AppError('Head-to-head chỉ có một winner', 400, 'CONTEST_MATCH_RESULT_INVALID');
    }

    const before = participants.map(toParticipantDto);
    for (const result of body.results) {
      const participant = participantByRegistration.get(result.registration_id)!;
      participant.finishPosition = result.finish_position ?? null;
      participant.score = result.score ?? null;
      participant.bestLapMs = result.best_lap_ms ?? null;
      participant.totalTimeMs = result.total_time_ms ?? null;
      participant.isWinner = result.is_winner ?? result.finish_position === 1;
      participant.resultNote = result.result_note ?? null;
      participant.status = ContestMatchParticipantStatus.FINISHED;
      participant.metadata = { ...(participant.metadata ?? {}), ...(result.metadata ?? {}) };
    }
    await manager.getRepository(ContestMatchParticipant).save(participants);

    match.status = ContestMatchStatus.COMPLETED;
    match.endedAt = new Date();
    match.decidedBy = viewer.userId;
    match.decidedAt = match.endedAt;
    match.resultSummary = { results: body.results, reason: body.reason ?? null };
    const savedMatch = await manager.getRepository(ContestMatch).save(match);
    await writeContestAudit(manager, {
      contestId: contest.id,
      matchId,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'match.result_submitted',
      beforeJson: { participants: before, status: match.status },
      afterJson: { results: body.results, status: savedMatch.status },
      reason: body.reason ?? null,
    });
    return toMatchDto(manager, savedMatch);
  });
}

function rankParticipants(participants: ContestMatchParticipant[]): ContestMatchParticipant[] {
  return [...participants].sort((a, b) => {
    if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
    if (a.finishPosition && b.finishPosition) return a.finishPosition - b.finishPosition;
    if (a.finishPosition) return -1;
    if (b.finishPosition) return 1;
    if (a.score !== null && b.score !== null) return Number(b.score) - Number(a.score);
    if (a.bestLapMs && b.bestLapMs) return a.bestLapMs - b.bestLapMs;
    return a.slotNo - b.slotNo;
  });
}

async function invalidateDescendants(manager: EntityManager, matchId: string): Promise<void> {
  const match = await manager.getRepository(ContestMatch).findOne({ where: { id: matchId } });
  if (!match) return;

  const sourceMatches = await manager.getRepository(ContestMatch).find({
    where: { nextMatchId: match.id },
  });
  const allSourcesCompleted =
    sourceMatches.length > 0 &&
    sourceMatches.every((sm) => sm.status === ContestMatchStatus.COMPLETED);

  match.status = allSourcesCompleted ? ContestMatchStatus.READY : ContestMatchStatus.DRAFT;
  match.endedAt = null;
  match.decidedBy = null;
  match.decidedAt = null;
  match.resultSummary = {};
  await manager.getRepository(ContestMatch).save(match);

  const participants = await manager.getRepository(ContestMatchParticipant).find({
    where: { matchId: match.id },
  });
  for (const p of participants) {
    p.status = ContestMatchParticipantStatus.READY;
    p.score = null;
    p.finishPosition = null;
    p.bestLapMs = null;
    p.totalTimeMs = null;
    p.isWinner = false;
    p.resultNote = null;
    await manager.getRepository(ContestMatchParticipant).save(p);
  }

  if (match.nextMatchId) {
    await invalidateDescendants(manager, match.nextMatchId);
  }
}

async function autoAdvanceByeMatches(
  manager: EntityManager,
  contestId: string,
  createdBy: string | null,
): Promise<void> {
  let foundBye = true;
  while (foundBye) {
    foundBye = false;
    const matches = await manager.getRepository(ContestMatch).find({
      where: { contestId },
      order: { roundNo: 'ASC', matchNo: 'ASC' },
    });

    for (const match of matches) {
      if (
        match.status === ContestMatchStatus.COMPLETED ||
        match.status === ContestMatchStatus.CANCELLED
      ) {
        continue;
      }
      const participants = await manager.getRepository(ContestMatchParticipant).find({
        where: { matchId: match.id },
      });

      if (match.status === ContestMatchStatus.READY && participants.length === 1) {
        const participant = participants[0];

        participant.isWinner = true;
        participant.status = ContestMatchParticipantStatus.FINISHED;
        participant.finishPosition = 1;
        await manager.getRepository(ContestMatchParticipant).save(participant);

        match.status = ContestMatchStatus.COMPLETED;
        match.endedAt = new Date();
        match.decidedBy = createdBy;
        match.decidedAt = match.endedAt;
        match.resultSummary = { note: 'Bye-round auto advancement' };
        await manager.getRepository(ContestMatch).save(match);

        if (match.nextMatchId) {
          const nextMatch = await manager.getRepository(ContestMatch).findOne({
            where: { id: match.nextMatchId },
          });
          if (nextMatch) {
            const existingParticipants = await manager.getRepository(ContestMatchParticipant).find({
              where: { matchId: nextMatch.id },
            });
            const alreadyIn = existingParticipants.some(
              (p) => p.registrationId === participant.registrationId,
            );
            if (!alreadyIn) {
              const newSlot = existingParticipants.length + 1;
              const nextParticipant = manager.getRepository(ContestMatchParticipant).create({
                matchId: nextMatch.id,
                registrationId: participant.registrationId,
                slotNo: newSlot,
                lane: String.fromCharCode(65 + existingParticipants.length),
                gridPosition: newSlot,
                seedNo: participant.seedNo,
                status: ContestMatchParticipantStatus.READY,
                metadata: { advanced_from_match_id: match.id, is_bye_advanced: true },
              });
              await manager.getRepository(ContestMatchParticipant).save(nextParticipant);
            }

            const sourceMatches = await manager.getRepository(ContestMatch).find({
              where: { nextMatchId: nextMatch.id },
            });
            const allSourcesCompleted = sourceMatches.every(
              (sm) => sm.status === ContestMatchStatus.COMPLETED,
            );
            if (allSourcesCompleted) {
              nextMatch.status = ContestMatchStatus.READY;
              await manager.getRepository(ContestMatch).save(nextMatch);
            }
          }
        }
        foundBye = true;
      }
    }
  }
}

export async function advanceContestMatch(
  matchId: string,
  viewer: Viewer,
  body: AdvanceContestMatchBody,
): Promise<MatchDto> {
  return AppDataSource.transaction(async (manager) => {
    const match = await getMatchOrThrow(manager, matchId);
    const contest = await getContestOrThrow(manager, match.contestId);
    await assertOperator(manager, contest, viewer);
    if (match.status !== ContestMatchStatus.COMPLETED) {
      throw new AppError(
        'Chỉ match COMPLETED mới được advance',
        409,
        'CONTEST_MATCH_STATUS_INVALID',
      );
    }
    const participants = await manager
      .getRepository(ContestMatchParticipant)
      .find({ where: { matchId } });
    const topN = body.top_n ?? getTopN(match.advancementRule, 1);
    const advancing = rankParticipants(participants).slice(0, topN);
    if (advancing.length === 0) {
      throw new AppError(
        'Match chưa có participant đủ điều kiện advance',
        409,
        'CONTEST_MATCH_ADVANCE_EMPTY',
      );
    }

    const nextMatchId = body.next_match_id ?? match.nextMatchId;
    let nextMatch: ContestMatch | null = null;
    if (nextMatchId) {
      nextMatch = await getMatchOrThrow(manager, nextMatchId);
      if (nextMatch.contestId !== contest.id) {
        throw new AppError('Next match không thuộc contest này', 400, 'CONTEST_MATCH_INVALID');
      }
    } else {
      const existingCount = await manager.getRepository(ContestMatch).count({
        where: { contestId: contest.id, roundNo: match.roundNo + 1 },
      });
      nextMatch = await manager.getRepository(ContestMatch).save(
        manager.getRepository(ContestMatch).create({
          contestId: contest.id,
          roundNo: match.roundNo + 1,
          matchNo: existingCount + 1,
          name: `Round ${match.roundNo + 1} - Match ${existingCount + 1}`,
          matchType: ContestMatchType.FINAL,
          status: ContestMatchStatus.DRAFT,
          nextMatchId: null,
          advancementRule: match.advancementRule,
          resultSummary: {},
          metadata: {},
          createdBy: viewer.userId,
        }),
      );
    }

    const existingParticipants = await manager.getRepository(ContestMatchParticipant).find({
      where: { matchId: nextMatch.id },
      order: { slotNo: 'ASC' },
    });
    const existingRegistrationIds = new Set(
      existingParticipants.map((participant) => participant.registrationId),
    );
    const newRows = advancing
      .filter((participant) => !existingRegistrationIds.has(participant.registrationId))
      .map((participant, index) =>
        manager.getRepository(ContestMatchParticipant).create({
          matchId: nextMatch!.id,
          registrationId: participant.registrationId,
          slotNo: existingParticipants.length + index + 1,
          lane: String.fromCharCode(65 + existingParticipants.length + index),
          gridPosition: existingParticipants.length + index + 1,
          seedNo: participant.seedNo,
          status: ContestMatchParticipantStatus.READY,
          metadata: { advanced_from_match_id: match.id },
        }),
      );
    if (newRows.length > 0) await manager.getRepository(ContestMatchParticipant).save(newRows);
    nextMatch.status = ContestMatchStatus.READY;
    const savedNextMatch = await manager.getRepository(ContestMatch).save(nextMatch);
    if (match.nextMatchId !== savedNextMatch.id) {
      match.nextMatchId = savedNextMatch.id;
      await manager.getRepository(ContestMatch).save(match);
    }
    await writeContestAudit(manager, {
      contestId: contest.id,
      matchId: match.id,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'match.advanced',
      afterJson: {
        next_match_id: savedNextMatch.id,
        registration_ids: advancing.map((participant) => participant.registrationId),
        top_n: topN,
      },
      reason: body.reason ?? null,
    });

    await autoAdvanceByeMatches(manager, contest.id, viewer.userId);

    const updatedNextMatch = await manager.getRepository(ContestMatch).findOne({
      where: { id: nextMatch.id },
    });
    return toMatchDto(manager, updatedNextMatch ?? savedNextMatch);
  });
}

export async function correctMatchResult(
  matchId: string,
  viewer: Viewer,
  body: SubmitContestMatchResultsBody,
): Promise<MatchDto> {
  return AppDataSource.transaction(async (manager) => {
    const match = await getMatchOrThrow(manager, matchId);
    const contest = await getContestOrThrow(manager, match.contestId);
    await assertOperator(manager, contest, viewer);

    const prevParticipants = await manager.getRepository(ContestMatchParticipant).find({
      where: { matchId },
    });
    const before = prevParticipants.map(toParticipantDto);

    const participantByRegistration = new Map(
      prevParticipants.map((participant) => [participant.registrationId, participant]),
    );
    const missing = body.results.find(
      (result) => !participantByRegistration.has(result.registration_id),
    );
    if (missing) {
      throw new AppError(
        'Result chứa registration không thuộc match',
        400,
        'CONTEST_MATCH_RESULT_INVALID',
      );
    }

    for (const result of body.results) {
      const participant = participantByRegistration.get(result.registration_id)!;
      participant.finishPosition = result.finish_position ?? null;
      participant.score = result.score ?? null;
      participant.bestLapMs = result.best_lap_ms ?? null;
      participant.totalTimeMs = result.total_time_ms ?? null;
      participant.isWinner = result.is_winner ?? result.finish_position === 1;
      participant.resultNote = result.result_note ?? null;
      participant.status = ContestMatchParticipantStatus.FINISHED;
      participant.metadata = { ...(participant.metadata ?? {}), ...(result.metadata ?? {}) };
      await manager.getRepository(ContestMatchParticipant).save(participant);
    }

    match.status = ContestMatchStatus.COMPLETED;
    match.endedAt = new Date();
    match.decidedBy = viewer.userId;
    match.decidedAt = match.endedAt;
    match.resultSummary = { results: body.results, reason: body.reason ?? 'Corrected result' };
    const savedMatch = await manager.getRepository(ContestMatch).save(match);

    await writeContestAudit(manager, {
      contestId: contest.id,
      matchId,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'match.result_corrected',
      beforeJson: { participants: before, status: ContestMatchStatus.COMPLETED },
      afterJson: { results: body.results, status: savedMatch.status },
      reason: body.reason ?? 'Corrected result',
    });

    if (match.nextMatchId) {
      const nextMatch = await manager.getRepository(ContestMatch).findOne({
        where: { id: match.nextMatchId },
      });
      if (nextMatch) {
        const topN = getTopN(match.advancementRule, 1);
        const newWinners = rankParticipants(prevParticipants).slice(0, topN);

        const oldWinnerIds = before.filter((p) => p.is_winner).map((p) => p.registration_id);

        await manager.getRepository(ContestMatchParticipant).delete({
          matchId: nextMatch.id,
          registrationId: In(oldWinnerIds),
        });

        const remainingParticipants = await manager.getRepository(ContestMatchParticipant).find({
          where: { matchId: nextMatch.id },
          order: { slotNo: 'ASC' },
        });

        const newRows = newWinners.map((participant, index) =>
          manager.getRepository(ContestMatchParticipant).create({
            matchId: nextMatch.id,
            registrationId: participant.registrationId,
            slotNo: remainingParticipants.length + index + 1,
            lane: String.fromCharCode(65 + remainingParticipants.length + index),
            gridPosition: remainingParticipants.length + index + 1,
            seedNo: participant.seedNo,
            status: ContestMatchParticipantStatus.READY,
            metadata: { advanced_from_match_id: match.id },
          }),
        );
        if (newRows.length > 0) {
          await manager.getRepository(ContestMatchParticipant).save(newRows);
        }

        await invalidateDescendants(manager, nextMatch.id);
      }
    }

    await autoAdvanceByeMatches(manager, contest.id, viewer.userId);

    const updatedMatch = await manager
      .getRepository(ContestMatch)
      .findOne({ where: { id: matchId } });
    return toMatchDto(manager, updatedMatch ?? savedMatch);
  });
}

export async function publishLeaderboard(
  contestId: string,
  viewer: Viewer,
  body: PublishContestLeaderboardBody,
) {
  return AppDataSource.transaction(async (manager) => {
    const contest = await getContestOrThrow(manager, contestId);
    await assertOperator(manager, contest, viewer);
    const completedMatches = await manager.getRepository(ContestMatch).find({
      where: { contestId, status: ContestMatchStatus.COMPLETED },
      order: { roundNo: 'DESC', matchNo: 'ASC' },
    });
    if (completedMatches.length === 0) {
      throw new AppError(
        'Chưa có match hoàn tất để publish leaderboard',
        409,
        'CONTEST_LEADERBOARD_EMPTY',
      );
    }
    const sourceRoundNo = completedMatches[0].roundNo;
    const sourceMatchIds = completedMatches
      .filter((match) => match.roundNo === sourceRoundNo)
      .map((match) => match.id);
    const participants = await manager.getRepository(ContestMatchParticipant).find({
      where: { matchId: In(sourceMatchIds) },
    });
    const ranked = rankParticipants(participants).filter(
      (participant) => participant.status === ContestMatchParticipantStatus.FINISHED,
    );
    if (ranked.length === 0) {
      throw new AppError(
        'Chưa có result hoàn tất để publish leaderboard',
        409,
        'CONTEST_LEADERBOARD_EMPTY',
      );
    }

    const rows = await manager.query<
      Array<{
        registration_id: string;
        user_id: string;
        full_name: string | null;
        email: string | null;
      }>
    >(
      `SELECT r.id AS registration_id, r.user_id, u.full_name, u.email
         FROM contest_registrations r
         LEFT JOIN users u ON u.id = r.user_id
        WHERE r.id = ANY($1::uuid[])`,
      [ranked.map((participant) => participant.registrationId)],
    );
    const registrationMap = new Map(rows.map((row) => [row.registration_id, row]));
    const standings = ranked.map((participant, index) => {
      const registration = registrationMap.get(participant.registrationId);
      return {
        rank: index + 1,
        registration_id: participant.registrationId,
        user_id: registration?.user_id ?? null,
        fullName: registration?.full_name ?? '',
        email: registration?.email ?? '',
        score: scoreValue(participant.score),
        best_lap_ms: participant.bestLapMs,
        source_match_id: participant.matchId,
      };
    });

    const before = { leaderboard: contest.config?.leaderboard ?? [] };
    contest.status = ContestStatus.COMPLETED;
    contest.config = { ...(contest.config ?? {}), leaderboard: standings };
    await manager.getRepository(Contest).save(contest);
    await writeContestAudit(manager, {
      contestId,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'leaderboard.published',
      beforeJson: before,
      afterJson: { leaderboard: standings },
      reason: body.reason ?? null,
    });
    return { standings };
  });
}

import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { ContestAuditLog } from '../models/contest-audit-log.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestMatchParticipant } from '../models/contest-match-participant.entity';
import { ContestMatch } from '../models/contest-match.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { Contest } from '../models/contest.entity';
import { RaceRecord } from '../models/race-record.entity';
import { User } from '../models/user.entity';
import {
  AppError,
  ContestMatchStatus,
  ContestParticipantStatus,
  ContestRegistrationStatus,
  ContestStatus,
  RaceRecordVerificationStatus,
  UserRole,
} from '../types';
import { Viewer } from './cafe.service';
import {
  assertContestOperator,
  getContestOrThrow,
  isStaffAssignedToCafe,
  isStaffAssignedToContest,
  writeContestAudit,
} from './contest.helpers';
import { ContestFormatEngine, getContestFormatEngine } from './contest-format.engine';

type GenerateMatchesBody = {
  cafe_id: string;
  track_config_id?: string | null;
  registration_ids: string[];
  drivers_per_match?: number;
  seeding_mode?: 'MANUAL' | 'CHECK_IN_ORDER';
};

type MatchParticipantUpdateBody = {
  participants: Array<{
    registration_id: string;
    slot_no: number;
    lane?: string | null;
    grid_position?: number | null;
    seed_no?: number | null;
  }>;
};

type SubmitResultsBody = {
  results: Array<{
    registration_id: string;
    finish_position?: number | null;
    score?: number | null;
    best_lap_seconds?: number | null;
    total_time_seconds?: number | null;
    is_winner?: boolean;
    result_note?: string | null;
    status?: ContestParticipantStatus;
  }>;
  reason: string;
};

type CorrectResultsBody = SubmitResultsBody & {
  force_cascade?: boolean;
};

type ContestMatchesQuery = {
  round_no?: number;
  status?: 'DRAFT' | 'READY' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';
  cafe_id?: string;
  participant_query?: string;
};

function getDriversPerMatch(contest: Contest, override?: number): number {
  if (override) return override;
  const configValue = contest.config?.drivers_per_match;
  return typeof configValue === 'number' && Number.isFinite(configValue) ? configValue : 2;
}

function getSeedingMode(
  contest: Contest,
  override?: 'MANUAL' | 'CHECK_IN_ORDER',
): 'MANUAL' | 'CHECK_IN_ORDER' {
  if (override) return override;
  return contest.config?.seeding_mode === 'MANUAL' ? 'MANUAL' : 'CHECK_IN_ORDER';
}

function getLeaderboardMode(contest: Contest): 'BEST_LAP' | 'TOTAL_TIME' | 'KNOCKOUT_WINS' {
  const mode = contest.config?.leaderboard_mode;
  if (mode === 'TOTAL_TIME') return 'TOTAL_TIME';
  if (mode === 'KNOCKOUT_WINS') return 'KNOCKOUT_WINS';
  return 'BEST_LAP';
}

function getEngine(contest: Contest): ContestFormatEngine {
  return getContestFormatEngine(contest);
}

async function validateContestCafe(contestId: string, cafeId: string): Promise<ContestCafe> {
  const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
    where: { contestId, cafeId },
  });
  if (!contestCafe) {
    throw new AppError('Chi nhánh không thuộc contest', 400, 'CONTEST_CAFE_INVALID');
  }
  return contestCafe;
}

async function loadEligibleRegistrations(contestId: string, registrationIds: string[]) {
  const registrations = await AppDataSource.getRepository(ContestRegistration).findBy({
    id: In(registrationIds),
    contestId,
  });
  if (registrations.length !== registrationIds.length) {
    throw new AppError('Có registration không thuộc contest', 400, 'REGISTRATION_CONTEST_MISMATCH');
  }
  for (const registration of registrations) {
    if (registration.status !== ContestRegistrationStatus.CHECKED_IN) {
      throw new AppError(
        'Chỉ người chơi đã check-in mới được đưa vào thi đấu',
        400,
        'REGISTRATION_NOT_RUNTIME_READY',
      );
    }
  }
  return registrations;
}

async function loadMatchBundle(matchId: string) {
  const match = await AppDataSource.getRepository(ContestMatch).findOne({ where: { id: matchId } });
  if (!match) throw new AppError('Match không tồn tại', 404, 'MATCH_NOT_FOUND');
  const participants = await AppDataSource.getRepository(ContestMatchParticipant).find({
    where: { matchId },
    order: { slotNo: 'ASC' },
  });
  return { match, participants };
}

async function loadContestRegistrationsMap(registrationIds: string[]) {
  if (registrationIds.length === 0) return new Map<string, ContestRegistration>();
  const registrations = await AppDataSource.getRepository(ContestRegistration).findBy({
    id: In(registrationIds),
  });
  return new Map(registrations.map((item) => [item.id, item]));
}

async function loadUsersMap(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, User>();
  const users = await AppDataSource.getRepository(User).findBy({ id: In(userIds) });
  return new Map(users.map((item) => [item.id, item]));
}

function getUserRacingProfile(user?: User | null) {
  const profile = (user?.racing_profile ?? {}) as Record<string, unknown>;
  return {
    driverHandle: typeof profile.driver_handle === 'string' ? profile.driver_handle : null,
    titleLabel:
      typeof profile.current_title_label === 'string' ? profile.current_title_label : null,
  };
}

async function loadContestMatches(contestId: string) {
  return AppDataSource.getRepository(ContestMatch).find({
    where: { contestId },
    order: { roundNo: 'ASC', matchNo: 'ASC', createdAt: 'ASC' },
  });
}

async function loadContestMatchParticipantsByMatch(matchIds: string[]) {
  if (matchIds.length === 0) return new Map<string, ContestMatchParticipant[]>();
  const participants = await AppDataSource.getRepository(ContestMatchParticipant).find({
    where: { matchId: In(matchIds) },
    order: { slotNo: 'ASC', createdAt: 'ASC' },
  });
  return participants.reduce<Map<string, ContestMatchParticipant[]>>((map, participant) => {
    const list = map.get(participant.matchId) ?? [];
    list.push(participant);
    map.set(participant.matchId, list);
    return map;
  }, new Map());
}

async function assertViewerCanViewContestMatches(contestId: string, viewer?: Viewer) {
  const contest = await getContestOrThrow(contestId);
  const isPublicContest = ![ContestStatus.DRAFT, ContestStatus.CANCELLED].includes(contest.status);

  if (!viewer) {
    if (!isPublicContest) {
      throw new AppError('Contest chưa được công khai', 404, 'CONTEST_NOT_PUBLIC');
    }
    return contest;
  }

  if (viewer.role === UserRole.PROVIDER && contest.providerId === viewer.userId) return contest;

  if (viewer.role === UserRole.STAFF) {
    const assigned = await isStaffAssignedToContest(contestId, viewer.userId);
    if (assigned) return contest;
  }

  if (viewer.role === UserRole.CUSTOMER) {
    const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
      where: { contestId, userId: viewer.userId },
    });
    if (registration) return contest;
  }

  if (isPublicContest) return contest;

  throw new AppError('Bạn không có quyền xem bracket của contest này', 403, 'FORBIDDEN');
}

async function assertViewerCanOperateMatch(match: ContestMatch, viewer: Viewer) {
  if (viewer.role === UserRole.PROVIDER) {
    await assertContestOperator(match.contestId, viewer);
    return;
  }

  if (viewer.role === UserRole.STAFF) {
    const assignedToContest = await isStaffAssignedToContest(match.contestId, viewer.userId);
    const assignedToCafe = await isStaffAssignedToCafe(viewer.userId, match.cafeId);
    if (!assignedToContest || !assignedToCafe) {
      throw new AppError('Staff không được thao tác match ở chi nhánh này', 403, 'FORBIDDEN');
    }
    return;
  }

  throw new AppError('Forbidden', 403, 'FORBIDDEN');
}

async function mapMatchesPayload(contestId: string, viewer?: Viewer) {
  const matches = await loadContestMatches(contestId);
  const participantsByMatch = await loadContestMatchParticipantsByMatch(
    matches.map((item) => item.id),
  );
  const registrationIds = Array.from(
    new Set([...participantsByMatch.values()].flat().map((item) => item.registrationId)),
  );
  const registrationMap = await loadContestRegistrationsMap(registrationIds);
  const usersMap = await loadUsersMap(
    Array.from(new Set(Array.from(registrationMap.values()).map((item) => item.userId))),
  );

  return matches.map((match) => ({
    id: match.id,
    contest_id: match.contestId,
    cafe_id: match.cafeId,
    track_config_id: match.trackConfigId,
    round_no: match.roundNo,
    match_no: match.matchNo,
    name: match.name,
    match_type: match.matchType,
    status: match.status,
    scheduled_at: match.scheduledAt,
    started_at: match.startedAt,
    ended_at: match.endedAt,
    next_match_id: match.nextMatchId,
    advancement_rule: match.advancementRule,
    result_summary: match.resultSummary,
    metadata: match.metadata,
    decided_by: match.decidedBy,
    decided_at: match.decidedAt,
    participants: (participantsByMatch.get(match.id) ?? []).map((participant) => {
      const registration = registrationMap.get(participant.registrationId);
      const user = registration ? (usersMap.get(registration.userId) ?? null) : null;
      return {
        id: participant.id,
        registration_id: participant.registrationId,
        slot_no: participant.slotNo,
        lane: participant.lane,
        grid_position: participant.gridPosition,
        seed_no: participant.seedNo,
        status: participant.status,
        score: participant.score,
        finish_position: participant.finishPosition,
        best_lap_seconds: normalizeContestTimeSeconds(participant.bestLapSeconds),
        total_time_seconds: normalizeContestTimeSeconds(participant.totalTimeSeconds),
        is_winner: participant.isWinner,
        result_note: participant.resultNote,
        metadata: participant.metadata,
        registration: registration
          ? {
              id: registration.id,
              user_id: registration.userId,
              participant_name: user?.full_name ?? null,
              participant_email: user?.email ?? null,
              participant_avatar_url: user?.avatar_url ?? null,
              driver_handle: getUserRacingProfile(user).driverHandle,
              driver_title_label: getUserRacingProfile(user).titleLabel,
              status: registration.status,
              check_in_code: registration.checkInCode,
              checked_in_at: registration.checkedInAt,
              is_my_registration:
                viewer?.role === UserRole.CUSTOMER && registration.userId === viewer.userId,
            }
          : null,
      };
    }),
  }));
}

function buildHighlightRounds(matches: Awaited<ReturnType<typeof mapMatchesPayload>>) {
  const rounds = matches.reduce<
    Array<{
      round_no: number;
      label: string;
      match_count: number;
      completed_match_count: number;
      winners: Array<{
        registration_id: string;
        participant_name: string | null;
        participant_email: string | null;
        driver_handle: string | null;
        source_match_id: string;
        source_match_name: string | null;
      }>;
    }>
  >((acc, match) => {
    const existing = acc.find((item) => item.round_no === match.round_no);
    const target =
      existing ??
      (() => {
        const created = {
          round_no: match.round_no,
          label: match.name?.trim() || `Round ${match.round_no}`,
          match_count: 0,
          completed_match_count: 0,
          winners: [] as Array<{
            registration_id: string;
            participant_name: string | null;
            participant_email: string | null;
            driver_handle: string | null;
            source_match_id: string;
            source_match_name: string | null;
          }>,
        };
        acc.push(created);
        return created;
      })();

    target.match_count += 1;
    if (match.status === ContestMatchStatus.COMPLETED) target.completed_match_count += 1;
    for (const participant of match.participants.filter((item) => item.is_winner)) {
      target.winners.push({
        registration_id: participant.registration_id,
        participant_name: participant.registration?.participant_name ?? null,
        participant_email: participant.registration?.participant_email ?? null,
        driver_handle: participant.registration?.driver_handle ?? null,
        source_match_id: match.id,
        source_match_name: match.name ?? null,
      });
    }
    return acc;
  }, []);

  return rounds.sort((a, b) => a.round_no - b.round_no);
}

export async function getContestPublicRuntimeSummary(contestId: string, viewer?: Viewer) {
  await assertViewerCanViewContestMatches(contestId, viewer);
  const matches = await mapMatchesPayload(contestId, viewer);
  const rounds = Array.from(new Set(matches.map((item) => item.round_no))).sort((a, b) => a - b);
  const currentRound =
    matches.find((item) =>
      [ContestMatchStatus.RUNNING, ContestMatchStatus.READY].includes(item.status),
    )?.round_no ??
    matches.find((item) => item.status === ContestMatchStatus.COMPLETED)?.round_no ??
    null;
  const liveMatch = matches.find((item) => item.status === ContestMatchStatus.RUNNING) ?? null;

  return {
    total_matches: matches.length,
    total_rounds: rounds.length,
    current_round_no: currentRound,
    has_live_matches: Boolean(liveMatch),
    live_match_id: liveMatch?.id ?? null,
    completed_matches: matches.filter((item) => item.status === ContestMatchStatus.COMPLETED)
      .length,
    highlight_rounds: buildHighlightRounds(matches),
  };
}

async function clearExistingRuntime(contestId: string) {
  const matchRepo = AppDataSource.getRepository(ContestMatch);
  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const matches = await matchRepo.find({ where: { contestId } });
  if (matches.length === 0) return;
  await participantRepo.delete({ matchId: In(matches.map((item) => item.id)) });
  await matchRepo.delete({ contestId });
}

async function ensureContestRuntimeEditable(contest: Contest) {
  if (![ContestStatus.OPEN, ContestStatus.CLOSED, ContestStatus.RUNNING].includes(contest.status)) {
    throw new AppError(
      'Contest phải ở trạng thái OPEN, CLOSED hoặc RUNNING để thao tác runtime',
      400,
      'CONTEST_RUNTIME_NOT_READY',
    );
  }
}

async function protectDownstreamCorrection(match: ContestMatch, forceCascade: boolean) {
  const matchRepo = AppDataSource.getRepository(ContestMatch);
  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);

  // Walk the entire downstream chain (next_match_id -> next_match_id -> ...).
  const downstreamChain: ContestMatch[] = [];
  let currentId: string | null = match.nextMatchId;
  while (currentId) {
    const current = await matchRepo.findOne({ where: { id: currentId } });
    if (!current) break;
    downstreamChain.push(current);
    currentId = current.nextMatchId;
  }

  if (downstreamChain.length === 0) return;

  const hasLinkedParticipants = await participantRepo
    .createQueryBuilder('participant')
    .where('participant.match_id IN (:...matchIds)', {
      matchIds: downstreamChain.map((item) => item.id),
    })
    .andWhere("participant.metadata ->> 'source_match_id' = :sourceMatchId", {
      sourceMatchId: match.id,
    })
    .getExists();

  if (!hasLinkedParticipants) return;

  if (!forceCascade) {
    throw new AppError(
      'Match này đã advance participant sang round sau; dùng force_cascade để sửa',
      409,
      'MATCH_CORRECTION_REQUIRES_FORCE',
    );
  }

  for (const downstream of downstreamChain) {
    if (downstream.status === ContestMatchStatus.COMPLETED) {
      throw new AppError(
        'Không thể force correction khi có match hạ nguồn đã hoàn tất',
        409,
        'MATCH_CORRECTION_DOWNSTREAM_COMPLETED',
      );
    }
  }

  // Clear all downstream participants and reset match state to DRAFT.
  for (const downstream of downstreamChain) {
    const downstreamParticipants = await participantRepo.find({
      where: { matchId: downstream.id },
    });
    if (downstreamParticipants.length > 0) {
      await participantRepo.remove(downstreamParticipants);
    }
    downstream.status = ContestMatchStatus.DRAFT;
    downstream.startedAt = null;
    downstream.endedAt = null;
    downstream.decidedAt = null;
    downstream.decidedBy = null;
    downstream.resultSummary = {};
    await matchRepo.save(downstream);
  }
}

export async function listContestMatches(
  contestId: string,
  viewer?: Viewer,
  query?: ContestMatchesQuery,
) {
  await assertViewerCanViewContestMatches(contestId, viewer);
  const mapped = await mapMatchesPayload(contestId, viewer);
  const normalizedQuery = query?.participant_query?.toLowerCase();
  return mapped.filter((match) => {
    const matchesRound = !query?.round_no || match.round_no === query.round_no;
    const matchesStatus = !query?.status || match.status === query.status;
    const matchesCafe = !query?.cafe_id || match.cafe_id === query.cafe_id;
    const matchesParticipant =
      !normalizedQuery ||
      match.participants.some((participant) =>
        [participant.registration?.participant_name, participant.registration?.participant_email]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
      );
    return matchesRound && matchesStatus && matchesCafe && matchesParticipant;
  });
}

export async function generateContestMatches(
  contestId: string,
  viewer: Viewer,
  body: GenerateMatchesBody,
) {
  const contest = await assertContestOperator(contestId, viewer);
  await ensureContestRuntimeEditable(contest);
  await validateContestCafe(contestId, body.cafe_id);

  if (viewer.role === UserRole.STAFF) {
    const assignedToCafe = await isStaffAssignedToCafe(viewer.userId, body.cafe_id);
    if (!assignedToCafe) {
      throw new AppError('Staff không được tạo runtime ở chi nhánh này', 403, 'FORBIDDEN');
    }
  }

  const registrations = await loadEligibleRegistrations(contestId, body.registration_ids);
  const matchRepo = AppDataSource.getRepository(ContestMatch);
  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);

  const existingMatches = await matchRepo.find({ where: { contestId } });
  if (
    existingMatches.some((match) =>
      [ContestMatchStatus.COMPLETED, ContestMatchStatus.RUNNING].includes(match.status),
    )
  ) {
    throw new AppError(
      'Không thể tạo lại bracket khi đã có match đang diễn ra hoặc đã hoàn tất',
      409,
      'CONTEST_RUNTIME_LOCKED',
    );
  }

  const orderedRegistrations =
    getSeedingMode(contest, body.seeding_mode) === 'CHECK_IN_ORDER'
      ? [...registrations].sort((a, b) => {
          const aTime = a.checkedInAt?.getTime() ?? a.createdAt.getTime();
          const bTime = b.checkedInAt?.getTime() ?? b.createdAt.getTime();
          return aTime - bTime;
        })
      : body.registration_ids
          .map((registrationId) => registrations.find((item) => item.id === registrationId)!)
          .filter(Boolean);

  await clearExistingRuntime(contestId);

  const engine = getEngine(contest);
  const driversPerMatch = Math.max(1, getDriversPerMatch(contest, body.drivers_per_match));
  const generatedMatches = engine.generateMatches({
    contest,
    cafeId: body.cafe_id,
    trackConfigId: body.track_config_id,
    registrations,
    registrationOrder: orderedRegistrations.map((item) => item.id),
    driversPerMatch,
    seedingMode: getSeedingMode(contest, body.seeding_mode),
    createdBy: viewer.userId,
  });

  const roundMap = new Map<number, ContestMatch[]>();
  const createdMatches: ContestMatch[] = [];

  for (const generated of generatedMatches) {
    const match = await matchRepo.save(
      matchRepo.create({
        contestId,
        cafeId: body.cafe_id,
        trackConfigId: body.track_config_id ?? null,
        roundNo: generated.roundNo,
        matchNo: generated.matchNo,
        name: generated.name,
        matchType: generated.matchType,
        status: generated.status,
        scheduledAt: generated.scheduledAt,
        advancementRule: generated.advancementRule,
        metadata: generated.metadata,
        createdBy: viewer.userId,
      }),
    );
    createdMatches.push(match);
    const list = roundMap.get(generated.roundNo) ?? [];
    list.push(match);
    roundMap.set(generated.roundNo, list);
  }

  // Link next matches using generated nextMatchIndex pointers.
  for (const [index, generated] of generatedMatches.entries()) {
    if (generated.nextMatchIndex !== undefined) {
      const nextRoundMatches = roundMap.get(generated.roundNo + 1) ?? [];
      const nextMatch = nextRoundMatches[generated.nextMatchIndex];
      if (nextMatch) {
        const match = createdMatches[index];
        match.nextMatchId = nextMatch.id;
        await matchRepo.save(match);
      }
    }
  }

  // Create participants.
  for (const [index, generated] of generatedMatches.entries()) {
    const match = createdMatches[index];
    for (const participant of generated.participants) {
      await participantRepo.save(
        participantRepo.create({
          matchId: match.id,
          registrationId: participant.registrationId,
          slotNo: participant.slotNo,
          lane: participant.lane ?? null,
          gridPosition: participant.gridPosition ?? null,
          seedNo: participant.seedNo ?? null,
          status: participant.status,
          metadata: participant.metadata ?? {},
        }),
      );
    }
  }

  // Auto-advance bye winners so staff does not need to create fake results.
  for (const [index, generated] of generatedMatches.entries()) {
    if (generated.isBye && generated.byeWinnerRegistrationId) {
      await advanceByeWinner(createdMatches[index], generated.byeWinnerRegistrationId, viewer);
    }
  }

  if (contest.status === ContestStatus.OPEN) {
    contest.status = ContestStatus.CLOSED;
  }
  await AppDataSource.getRepository(Contest).save(contest);

  await writeContestAudit({
    contestId,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.matches_generated',
    afterJson: {
      generated_match_count: createdMatches.length,
      registration_count: orderedRegistrations.length,
      format: engine.code,
    },
    metadata: {
      cafe_id: body.cafe_id,
      track_config_id: body.track_config_id ?? null,
      seeding_mode: getSeedingMode(contest, body.seeding_mode),
      drivers_per_match: driversPerMatch,
      format: engine.code,
    },
  });

  return mapMatchesPayload(contestId, viewer);
}

export async function updateMatchParticipants(
  matchId: string,
  viewer: Viewer,
  body: MatchParticipantUpdateBody,
) {
  const { match, participants } = await loadMatchBundle(matchId);
  await assertViewerCanOperateMatch(match, viewer);

  if ([ContestMatchStatus.COMPLETED, ContestMatchStatus.RUNNING].includes(match.status)) {
    throw new AppError(
      'Không thể đổi participant khi match đang diễn ra hoặc đã hoàn tất',
      400,
      'MATCH_LOCKED',
    );
  }

  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const registrations = await loadEligibleRegistrations(
    match.contestId,
    body.participants.map((item) => item.registration_id),
  );
  const registrationMap = new Map(registrations.map((item) => [item.id, item]));

  const seenSlots = new Set<number>();
  for (const item of body.participants) {
    if (seenSlots.has(item.slot_no)) {
      throw new AppError('slot_no bị trùng trong cùng match', 400, 'MATCH_SLOT_DUPLICATED');
    }
    seenSlots.add(item.slot_no);
  }

  const existingByRegistrationId = new Map(participants.map((item) => [item.registrationId, item]));
  const requestedRegistrationIds = new Set(body.participants.map((item) => item.registration_id));

  // Delete participants that are no longer in the requested list.
  for (const participant of participants) {
    if (!requestedRegistrationIds.has(participant.registrationId)) {
      await participantRepo.remove(participant);
    }
  }

  // Upsert participants to preserve any already-submitted result data.
  for (const item of body.participants) {
    const registration = registrationMap.get(item.registration_id)!;
    const existing = existingByRegistrationId.get(item.registration_id);
    if (existing) {
      existing.slotNo = item.slot_no;
      existing.lane = item.lane ?? null;
      existing.gridPosition = item.grid_position ?? null;
      existing.seedNo = item.seed_no ?? null;
      await participantRepo.save(existing);
    } else {
      await participantRepo.save(
        participantRepo.create({
          matchId: match.id,
          registrationId: registration.id,
          slotNo: item.slot_no,
          lane: item.lane ?? null,
          gridPosition: item.grid_position ?? null,
          seedNo: item.seed_no ?? null,
          status: ContestParticipantStatus.READY,
          metadata: {},
        }),
      );
    }
  }

  await writeContestAudit({
    contestId: match.contestId,
    matchId: match.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'match.participants_updated',
    afterJson: { participants: body.participants },
  });

  return mapMatchesPayload(match.contestId, viewer);
}

export async function submitMatchResults(matchId: string, viewer: Viewer, body: SubmitResultsBody) {
  const { match, participants } = await loadMatchBundle(matchId);
  await assertViewerCanOperateMatch(match, viewer);
  const contest = await getContestOrThrow(match.contestId);
  const engine = getEngine(contest);
  if (participants.length === 0) {
    throw new AppError('Match chưa có participant', 400, 'MATCH_HAS_NO_PARTICIPANTS');
  }

  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const participantMap = new Map(participants.map((item) => [item.registrationId, item]));
  if (body.results.some((item) => !participantMap.has(item.registration_id))) {
    throw new AppError('Có result không thuộc participant của match', 400, 'MATCH_RESULT_INVALID');
  }

  const before = {
    status: match.status,
    result_summary: match.resultSummary,
  };

  for (const item of body.results) {
    const participant = participantMap.get(item.registration_id)!;
    participant.finishPosition = item.finish_position ?? null;
    participant.score = item.score ?? null;
    participant.bestLapSeconds = item.best_lap_seconds ?? null;
    participant.totalTimeSeconds = item.total_time_seconds ?? null;
    participant.bestLapMsLegacy =
      item.best_lap_seconds !== undefined && item.best_lap_seconds !== null
        ? Math.round(item.best_lap_seconds * 1000)
        : null;
    participant.totalTimeMsLegacy =
      item.total_time_seconds !== undefined && item.total_time_seconds !== null
        ? Math.round(item.total_time_seconds * 1000)
        : null;
    participant.isWinner = item.is_winner ?? false;
    participant.resultNote = item.result_note ?? null;
    participant.status = item.status ?? ContestParticipantStatus.FINISHED;
    await participantRepo.save(participant);
  }

  const refreshedParticipants = await participantRepo.find({
    where: { matchId },
    order: { slotNo: 'ASC' },
  });
  const winnersToAdvance =
    typeof match.advancementRule?.winners_to_advance === 'number'
      ? Number(match.advancementRule.winners_to_advance)
      : match.nextMatchId
        ? 1
        : 0;
  const inferredWinners = engine.inferWinners(
    refreshedParticipants,
    Math.max(1, winnersToAdvance || 1),
  );
  const winnerIds = new Set(inferredWinners.map((item) => item.id));

  for (const participant of refreshedParticipants) {
    participant.isWinner = winnerIds.has(participant.id);
    if (!body.results.some((item) => item.registration_id === participant.registrationId)) {
      participant.status = participant.status ?? ContestParticipantStatus.READY;
    }
    await participantRepo.save(participant);
  }

  match.status = ContestMatchStatus.COMPLETED;
  match.startedAt = match.startedAt ?? new Date();
  match.endedAt = new Date();
  match.decidedAt = new Date();
  match.decidedBy = viewer.userId;
  match.resultSummary = engine.buildResultSummary(contest, match, refreshedParticipants);
  await AppDataSource.getRepository(ContestMatch).save(match);

  if (contest.status !== ContestStatus.RUNNING) {
    contest.status = ContestStatus.RUNNING;
    await AppDataSource.getRepository(Contest).save(contest);
  }

  await writeContestAudit({
    contestId: match.contestId,
    matchId: match.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'match.results_submitted',
    beforeJson: before,
    afterJson: { status: match.status, result_summary: match.resultSummary },
    reason: body.reason,
  });

  return mapMatchesPayload(match.contestId, viewer);
}

export async function correctMatchResults(
  matchId: string,
  viewer: Viewer,
  body: CorrectResultsBody,
) {
  const { match } = await loadMatchBundle(matchId);
  await assertViewerCanOperateMatch(match, viewer);

  if (viewer.role === UserRole.STAFF && body.force_cascade) {
    throw new AppError('Staff không được force cascade khi sửa kết quả', 403, 'FORBIDDEN');
  }

  if (match.status !== ContestMatchStatus.COMPLETED) {
    throw new AppError('Chỉ sửa được match đã hoàn tất', 400, 'MATCH_NOT_COMPLETED');
  }

  await protectDownstreamCorrection(match, Boolean(body.force_cascade));

  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const previousParticipants = await participantRepo.find({
    where: { matchId },
    order: { slotNo: 'ASC' },
  });

  for (const participant of previousParticipants) {
    participant.finishPosition = null;
    participant.score = null;
    participant.bestLapSeconds = null;
    participant.totalTimeSeconds = null;
    participant.bestLapMsLegacy = null;
    participant.totalTimeMsLegacy = null;
    participant.isWinner = false;
    participant.resultNote = null;
    participant.status = ContestParticipantStatus.READY;
    await participantRepo.save(participant);
  }

  match.status = ContestMatchStatus.READY;
  match.endedAt = null;
  match.decidedAt = null;
  match.decidedBy = null;
  match.resultSummary = {};
  await AppDataSource.getRepository(ContestMatch).save(match);

  await writeContestAudit({
    contestId: match.contestId,
    matchId: match.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'match.results_corrected',
    beforeJson: { result_summary: match.resultSummary },
    reason: body.reason,
    metadata: { force_cascade: Boolean(body.force_cascade) },
  });

  return submitMatchResults(matchId, viewer, body);
}

export async function advanceMatch(matchId: string, viewer: Viewer) {
  const { match, participants } = await loadMatchBundle(matchId);
  await assertViewerCanOperateMatch(match, viewer);

  if (!match.nextMatchId) {
    throw new AppError('Match này không có round kế tiếp để advance', 400, 'MATCH_NO_NEXT_ROUND');
  }
  if (match.status !== ContestMatchStatus.COMPLETED) {
    throw new AppError('Chỉ advance được match đã hoàn tất', 400, 'MATCH_NOT_COMPLETED');
  }

  const nextMatch = await AppDataSource.getRepository(ContestMatch).findOne({
    where: { id: match.nextMatchId },
  });
  if (!nextMatch) {
    throw new AppError('Match kế tiếp không tồn tại', 404, 'NEXT_MATCH_NOT_FOUND');
  }

  const contest = await getContestOrThrow(match.contestId);
  const engine = getEngine(contest);

  const winnersToAdvance =
    typeof match.advancementRule?.winners_to_advance === 'number'
      ? Number(match.advancementRule.winners_to_advance)
      : 1;
  const winners = engine.inferWinners(participants, Math.max(1, winnersToAdvance));
  if (winners.length === 0) {
    throw new AppError('Chưa xác định được winner để advance', 400, 'MATCH_WINNER_NOT_FOUND');
  }

  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const nextParticipants = await participantRepo.find({
    where: { matchId: nextMatch.id },
    order: { slotNo: 'ASC' },
  });
  const usedSlots = new Set(nextParticipants.map((item) => item.slotNo));

  for (const winner of winners) {
    const existing = nextParticipants.find(
      (item) =>
        item.metadata?.source_match_id === match.id &&
        item.registrationId === winner.registrationId,
    );
    if (existing) continue;

    let slotNo = 1;
    while (usedSlots.has(slotNo)) slotNo += 1;
    usedSlots.add(slotNo);

    const advancedParticipant = participantRepo.create({
      matchId: nextMatch.id,
      registrationId: winner.registrationId,
      slotNo,
      lane: `L${slotNo}`,
      seedNo: winner.seedNo,
      status: ContestParticipantStatus.READY,
      metadata: {
        source_match_id: match.id,
        source_match_no: match.matchNo,
        source_round_no: match.roundNo,
      },
    });
    await participantRepo.save(advancedParticipant);
  }

  nextMatch.status = ContestMatchStatus.READY;
  await AppDataSource.getRepository(ContestMatch).save(nextMatch);

  await writeContestAudit({
    contestId: match.contestId,
    matchId: match.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'match.advanced',
    afterJson: { next_match_id: nextMatch.id, winners: winners.map((item) => item.registrationId) },
  });

  return mapMatchesPayload(match.contestId, viewer);
}

async function advanceByeWinner(match: ContestMatch, winnerRegistrationId: string, viewer: Viewer) {
  if (!match.nextMatchId) return;

  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const matchRepo = AppDataSource.getRepository(ContestMatch);

  const winnerParticipant = await participantRepo.findOne({
    where: { matchId: match.id, registrationId: winnerRegistrationId },
  });
  if (!winnerParticipant) return;

  const nextMatch = await matchRepo.findOne({ where: { id: match.nextMatchId } });
  if (!nextMatch) return;

  const nextParticipants = await participantRepo.find({
    where: { matchId: nextMatch.id },
    order: { slotNo: 'ASC' },
  });
  const existing = nextParticipants.find(
    (item) =>
      item.metadata?.source_match_id === match.id &&
      item.registrationId === winnerParticipant.registrationId,
  );
  if (existing) return;

  const usedSlots = new Set(nextParticipants.map((item) => item.slotNo));
  let slotNo = 1;
  while (usedSlots.has(slotNo)) slotNo += 1;

  const advancedParticipant = participantRepo.create({
    matchId: nextMatch.id,
    registrationId: winnerParticipant.registrationId,
    slotNo,
    lane: `L${slotNo}`,
    seedNo: winnerParticipant.seedNo,
    status: ContestParticipantStatus.READY,
    metadata: {
      source_match_id: match.id,
      source_match_no: match.matchNo,
      source_round_no: match.roundNo,
      bye_advance: true,
    },
  });
  await participantRepo.save(advancedParticipant);

  nextMatch.status = ContestMatchStatus.READY;
  await matchRepo.save(nextMatch);

  await writeContestAudit({
    contestId: match.contestId,
    matchId: match.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'match.advanced',
    afterJson: {
      next_match_id: nextMatch.id,
      winners: [winnerParticipant.registrationId],
      bye: true,
    },
  });
}

type LeaderboardEntry = {
  registration_id: string;
  user_id: string | null;
  display_name: string | null;
  driver_handle: string | null;
  driver_title_label: string | null;
  wins: number;
  best_lap_seconds: number | null;
  total_time_seconds: number | null;
  latest_finish_position: number | null;
  matches_completed: number;
  progressed_round: number;
};

function normalizeContestTimeSeconds(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortLeaderboardEntries(
  entries: LeaderboardEntry[],
  mode: 'BEST_LAP' | 'TOTAL_TIME' | 'KNOCKOUT_WINS',
) {
  return [...entries].sort((a, b) => {
    if (mode === 'KNOCKOUT_WINS') {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (a.progressed_round !== b.progressed_round) return b.progressed_round - a.progressed_round;
      return (
        (a.latest_finish_position ?? Number.MAX_SAFE_INTEGER) -
        (b.latest_finish_position ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (mode === 'TOTAL_TIME') {
      return (
        (a.total_time_seconds ?? Number.MAX_SAFE_INTEGER) -
        (b.total_time_seconds ?? Number.MAX_SAFE_INTEGER)
      );
    }
    return (
      (a.best_lap_seconds ?? Number.MAX_SAFE_INTEGER) -
      (b.best_lap_seconds ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

async function buildLeaderboard(contestId: string, contest: Contest) {
  const matches = await loadContestMatches(contestId);
  const completedMatches = matches.filter((item) => item.status === ContestMatchStatus.COMPLETED);
  const participantsByMatch = await loadContestMatchParticipantsByMatch(
    completedMatches.map((item) => item.id),
  );
  const registrationIds = Array.from(
    new Set([...participantsByMatch.values()].flat().map((item) => item.registrationId)),
  );
  const registrationMap = await loadContestRegistrationsMap(registrationIds);
  const userMap = await loadUsersMap(
    Array.from(new Set(Array.from(registrationMap.values()).map((item) => item.userId))),
  );

  const entryMap = new Map<string, LeaderboardEntry>();
  for (const match of completedMatches) {
    for (const participant of participantsByMatch.get(match.id) ?? []) {
      const registration = registrationMap.get(participant.registrationId);
      const user = registration ? (userMap.get(registration.userId) ?? null) : null;
      const racing = getUserRacingProfile(user);
      const current = entryMap.get(participant.registrationId) ?? {
        registration_id: participant.registrationId,
        user_id: registration?.userId ?? null,
        display_name: user?.full_name ?? null,
        driver_handle: racing.driverHandle,
        driver_title_label: racing.titleLabel,
        wins: 0,
        best_lap_seconds: null,
        total_time_seconds: null,
        latest_finish_position: null,
        matches_completed: 0,
        progressed_round: 0,
      };
      current.matches_completed += 1;
      current.progressed_round = Math.max(current.progressed_round, match.roundNo);
      current.latest_finish_position = participant.finishPosition ?? current.latest_finish_position;
      if (participant.isWinner) current.wins += 1;
      const bestLapSeconds = normalizeContestTimeSeconds(participant.bestLapSeconds);
      const totalTimeSeconds = normalizeContestTimeSeconds(participant.totalTimeSeconds);
      if (bestLapSeconds !== null) {
        current.best_lap_seconds =
          current.best_lap_seconds === null
            ? bestLapSeconds
            : Math.min(current.best_lap_seconds, bestLapSeconds);
      }
      if (totalTimeSeconds !== null) {
        current.total_time_seconds =
          current.total_time_seconds === null
            ? totalTimeSeconds
            : Math.min(current.total_time_seconds, totalTimeSeconds);
      }
      entryMap.set(participant.registrationId, current);
    }
  }

  const mode = getLeaderboardMode(contest);
  const sorted = sortLeaderboardEntries(Array.from(entryMap.values()), mode).map(
    (entry, index) => ({
      rank: index + 1,
      ...entry,
    }),
  );

  return { mode, entries: sorted, match_count: completedMatches.length };
}

export async function publishContestLeaderboard(contestId: string, viewer: Viewer) {
  const contest = await assertContestOperator(contestId, viewer);
  if (![ContestStatus.RUNNING, ContestStatus.CLOSED].includes(contest.status)) {
    throw new AppError(
      'Chỉ có thể publish leaderboard khi contest đang diễn ra hoặc đã đóng đăng ký',
      400,
      'CONTEST_NOT_PUBLISHABLE',
    );
  }

  const matches = await loadContestMatches(contestId);
  if (matches.length === 0) {
    throw new AppError('Contest chưa có match để publish leaderboard', 400, 'CONTEST_NO_MATCHES');
  }

  const unfinishedMatch = matches.find((match) =>
    [ContestMatchStatus.DRAFT, ContestMatchStatus.READY, ContestMatchStatus.RUNNING].includes(
      match.status,
    ),
  );
  if (unfinishedMatch) {
    throw new AppError(
      'Không thể publish leaderboard khi vẫn còn match chưa hoàn tất',
      409,
      'CONTEST_MATCHES_INCOMPLETE',
    );
  }

  const participantsByMatch = await loadContestMatchParticipantsByMatch(
    matches.map((item) => item.id),
  );
  const matchWithoutResults = matches.find((match) => {
    const participants = participantsByMatch.get(match.id) ?? [];
    return participants.every(
      (participant) =>
        participant.finishPosition === null &&
        participant.bestLapSeconds === null &&
        participant.totalTimeSeconds === null &&
        participant.score === null,
    );
  });
  if (matchWithoutResults) {
    throw new AppError(
      'Có match hoàn tất nhưng chưa có kết quả hợp lệ',
      400,
      'CONTEST_MATCH_WITHOUT_RESULTS',
    );
  }

  const leaderboard = await buildLeaderboard(contestId, contest);
  if (leaderboard.entries.length === 0) {
    throw new AppError(
      'Contest chưa có kết quả hoàn tất để publish leaderboard',
      400,
      'CONTEST_LEADERBOARD_EMPTY',
    );
  }

  contest.config = {
    ...(contest.config ?? {}),
    published_leaderboard: {
      ...leaderboard,
      published_at: new Date().toISOString(),
      published_by: viewer.userId,
    },
  };
  contest.status = ContestStatus.COMPLETED;
  await AppDataSource.getRepository(Contest).save(contest);

  await writeContestAudit({
    contestId,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.leaderboard_published',
    afterJson: contest.config.published_leaderboard as Record<string, unknown>,
  });

  return contest.config.published_leaderboard;
}

export async function listContestAuditLogs(
  contestId: string,
  viewer: Viewer,
  options?: { page?: number; limit?: number },
) {
  await assertContestOperator(contestId, viewer);
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.max(1, Math.min(200, options?.limit ?? 20));
  const [rows, total] = await AppDataSource.getRepository(ContestAuditLog).findAndCount({
    where: { contestId },
    order: { createdAt: 'DESC' },
    skip: (page - 1) * limit,
    take: limit,
  });
  return { data: rows, meta: { total, page, limit } };
}

export async function getContestMetrics(contestId: string, viewer: Viewer) {
  const contest = await assertContestOperator(contestId, viewer);
  const registrations = await AppDataSource.getRepository(ContestRegistration).find({
    where: { contestId },
  });
  const matches = await loadContestMatches(contestId);
  const raceRecordCount = await AppDataSource.getRepository(RaceRecord).count({
    where: {
      contestId,
      verificationStatus: RaceRecordVerificationStatus.VERIFIED,
    },
  });
  const leaderboard = (contest.config?.published_leaderboard ?? null) as Record<
    string,
    unknown
  > | null;
  const globalSync = (contest.config?.global_sync ?? null) as Record<string, unknown> | null;

  return {
    contest_id: contestId,
    capacity: contest.capacity,
    entry_fee_amount: Number(contest.entryFee ?? 0),
    registration_counts: {
      total: registrations.length,
      pending: registrations.filter((item) => item.status === ContestRegistrationStatus.PENDING)
        .length,
      confirmed: registrations.filter((item) => item.status === ContestRegistrationStatus.CONFIRMED)
        .length,
      checked_in: registrations.filter(
        (item) => item.status === ContestRegistrationStatus.CHECKED_IN,
      ).length,
      cancelled: registrations.filter((item) => item.status === ContestRegistrationStatus.CANCELLED)
        .length,
    },
    revenue: {
      expected_revenue:
        registrations.filter((item) => item.status !== ContestRegistrationStatus.CANCELLED).length *
        Number(contest.entryFee ?? 0),
      paid_revenue:
        registrations.filter((item) => item.paymentStatus === 'MARKED_PAID').length *
        Number(contest.entryFee ?? 0),
      waived_revenue:
        registrations.filter((item) => item.paymentStatus === 'WAIVED').length *
        Number(contest.entryFee ?? 0),
      pending_revenue:
        registrations.filter((item) =>
          ['PENDING_PAYMENT', 'PENDING_REVIEW'].includes(item.paymentStatus),
        ).length * Number(contest.entryFee ?? 0),
      payment_conversion_rate:
        registrations.length > 0
          ? Number(
              (
                registrations.filter((item) => item.paymentStatus === 'MARKED_PAID').length /
                registrations.length
              ).toFixed(4),
            )
          : 0,
    },
    match_counts: {
      total: matches.length,
      draft: matches.filter((item) => item.status === ContestMatchStatus.DRAFT).length,
      ready: matches.filter((item) => item.status === ContestMatchStatus.READY).length,
      running: matches.filter((item) => item.status === ContestMatchStatus.RUNNING).length,
      completed: matches.filter((item) => item.status === ContestMatchStatus.COMPLETED).length,
      cancelled: matches.filter((item) => item.status === ContestMatchStatus.CANCELLED).length,
    },
    leaderboard: {
      published: Boolean(leaderboard),
      published_at: leaderboard?.published_at ?? null,
      entry_count: Array.isArray(leaderboard?.entries) ? leaderboard.entries.length : 0,
      mode: leaderboard?.mode ?? getLeaderboardMode(contest),
    },
    global_sync: {
      synced: raceRecordCount > 0,
      synced_at: globalSync?.synced_at ?? null,
      synced_count: Number(globalSync?.synced_count ?? raceRecordCount),
      superseded_count: Number(globalSync?.superseded_count ?? 0),
    },
  };
}

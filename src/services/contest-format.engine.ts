import { ContestMatch } from '../models/contest-match.entity';
import { ContestMatchParticipant } from '../models/contest-match-participant.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { Contest } from '../models/contest.entity';
import { ContestMatchStatus, ContestMatchType, ContestParticipantStatus } from '../types';

export type SeedingMode = 'MANUAL' | 'CHECK_IN_ORDER';

export type GenerateMatchesInput = {
  contest: Contest;
  cafeId: string;
  trackConfigId?: string | null;
  registrations: ContestRegistration[];
  registrationOrder: string[];
  driversPerMatch?: number;
  seedingMode?: SeedingMode;
  createdBy?: string;
};

export type GeneratedMatchParticipant = {
  registrationId: string;
  slotNo: number;
  lane?: string | null;
  gridPosition?: number | null;
  seedNo?: number | null;
  status: ContestParticipantStatus;
  metadata?: Record<string, unknown>;
};

export type GeneratedMatch = {
  roundNo: number;
  matchNo: number;
  name: string;
  matchType: ContestMatchType;
  status: ContestMatchStatus;
  scheduledAt: Date;
  advancementRule: Record<string, unknown>;
  metadata: Record<string, unknown>;
  nextMatchIndex?: number; // index in the generated round array, not DB id
  participants: GeneratedMatchParticipant[];
  isBye?: boolean;
  byeWinnerRegistrationId?: string | null;
};

export interface ContestFormatEngine {
  readonly code: string;

  generateMatches(input: GenerateMatchesInput): GeneratedMatch[];

  buildResultSummary(
    contest: Contest,
    match: ContestMatch,
    participants: ContestMatchParticipant[],
  ): Record<string, unknown>;

  inferWinners(
    participants: ContestMatchParticipant[],
    winnersToAdvance: number,
  ): ContestMatchParticipant[];

  canPublishLeaderboard(matches: ContestMatch[]): boolean;
}

function normalizeTimeSeconds(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferMatchWinners(
  participants: ContestMatchParticipant[],
  winnersToAdvance: number,
): ContestMatchParticipant[] {
  const explicitWinners = participants.filter((item) => item.isWinner);
  if (explicitWinners.length > 0) {
    return explicitWinners.slice(0, winnersToAdvance);
  }

  const ranked = [...participants].sort((a, b) => {
    const aFinish = a.finishPosition ?? Number.MAX_SAFE_INTEGER;
    const bFinish = b.finishPosition ?? Number.MAX_SAFE_INTEGER;
    if (aFinish !== bFinish) return aFinish - bFinish;

    const aBestLap = a.bestLapSeconds ?? Number.MAX_SAFE_INTEGER;
    const bBestLap = b.bestLapSeconds ?? Number.MAX_SAFE_INTEGER;
    if (aBestLap !== bBestLap) return aBestLap - bBestLap;

    const aTotal = a.totalTimeSeconds ?? Number.MAX_SAFE_INTEGER;
    const bTotal = b.totalTimeSeconds ?? Number.MAX_SAFE_INTEGER;
    if (aTotal !== bTotal) return aTotal - bTotal;

    const aScore = a.score ?? Number.NEGATIVE_INFINITY;
    const bScore = b.score ?? Number.NEGATIVE_INFINITY;
    if (aScore !== bScore) return bScore - aScore;

    return a.slotNo - b.slotNo;
  });

  return ranked.slice(0, winnersToAdvance);
}

export class TimeTrialEngine implements ContestFormatEngine {
  readonly code = 'TIME_TRIAL';

  generateMatches(input: GenerateMatchesInput): GeneratedMatch[] {
    const { contest, registrations, registrationOrder } = input;
    const orderedRegistrations = registrationOrder
      .map((id) => registrations.find((r) => r.id === id))
      .filter((r): r is ContestRegistration => Boolean(r));

    const matches: GeneratedMatch[] = [];
    for (const [index, registration] of orderedRegistrations.entries()) {
      matches.push({
        roundNo: 1,
        matchNo: index + 1,
        name: `Lượt thi đấu ${index + 1}`,
        matchType: ContestMatchType.TIME_ATTACK,
        status: ContestMatchStatus.READY,
        scheduledAt: new Date(contest.startsAt.getTime() + index * 5 * 60 * 1000),
        advancementRule: { winners_to_advance: 0, format: this.code },
        metadata: { generated_from: 'contest-runtime.generate', format: this.code },
        participants: [
          {
            registrationId: registration.id,
            slotNo: 1,
            seedNo: index + 1,
            status: ContestParticipantStatus.READY,
            metadata: { generated_seed_order: index + 1 },
          },
        ],
      });
    }
    return matches;
  }

  buildResultSummary(
    contest: Contest,
    _match: ContestMatch,
    participants: ContestMatchParticipant[],
  ): Record<string, unknown> {
    const mode = this.getLeaderboardMode(contest);
    const sorted = [...participants].sort((a, b) => {
      if (mode === 'TOTAL_TIME') {
        return (
          (a.totalTimeSeconds ?? Number.MAX_SAFE_INTEGER) -
          (b.totalTimeSeconds ?? Number.MAX_SAFE_INTEGER)
        );
      }
      return (
        (a.bestLapSeconds ?? Number.MAX_SAFE_INTEGER) -
        (b.bestLapSeconds ?? Number.MAX_SAFE_INTEGER)
      );
    });
    const winner = sorted[0] ?? null;
    return {
      leaderboard_mode: mode,
      winner_registration_id: winner?.registrationId ?? null,
      best_lap_seconds: normalizeTimeSeconds(winner?.bestLapSeconds),
      total_time_seconds: normalizeTimeSeconds(winner?.totalTimeSeconds),
    };
  }

  inferWinners(
    participants: ContestMatchParticipant[],
    winnersToAdvance: number,
  ): ContestMatchParticipant[] {
    return inferMatchWinners(participants, winnersToAdvance);
  }

  canPublishLeaderboard(matches: ContestMatch[]): boolean {
    return matches.every((match) => match.status === ContestMatchStatus.COMPLETED);
  }

  private getLeaderboardMode(contest: Contest): 'BEST_LAP' | 'TOTAL_TIME' | 'KNOCKOUT_WINS' {
    const mode = contest.config?.leaderboard_mode;
    if (mode === 'TOTAL_TIME') return 'TOTAL_TIME';
    if (mode === 'KNOCKOUT_WINS') return 'KNOCKOUT_WINS';
    return 'BEST_LAP';
  }
}

export class KnockoutEngine implements ContestFormatEngine {
  readonly code = 'KNOCKOUT';

  generateMatches(input: GenerateMatchesInput): GeneratedMatch[] {
    const { contest, registrations, registrationOrder, driversPerMatch } = input;
    const drivers = Math.max(1, driversPerMatch ?? this.resolveDriversPerMatch(contest));
    const orderedRegistrations = registrationOrder
      .map((id) => registrations.find((r) => r.id === id))
      .filter((r): r is ContestRegistration => Boolean(r));

    const participantCount = orderedRegistrations.length;
    const firstRoundMatches = Math.ceil(participantCount / drivers);
    const totalRounds = Math.max(1, Math.ceil(Math.log2(firstRoundMatches || 1)) + 1);

    const rounds: GeneratedMatch[][] = [];

    for (let roundNo = 1; roundNo <= totalRounds; roundNo += 1) {
      const matchesInRound =
        roundNo === 1
          ? firstRoundMatches
          : Math.max(1, Math.ceil((rounds[roundNo - 2]?.length ?? firstRoundMatches) / 2));
      rounds[roundNo - 1] = [];

      for (let matchNo = 1; matchNo <= matchesInRound; matchNo += 1) {
        rounds[roundNo - 1].push({
          roundNo,
          matchNo,
          name:
            roundNo === totalRounds ? `Chung kết ${matchNo}` : `Vòng ${roundNo} · Trận ${matchNo}`,
          matchType:
            roundNo === totalRounds ? ContestMatchType.FINAL : ContestMatchType.HEAD_TO_HEAD,
          status: roundNo === 1 ? ContestMatchStatus.READY : ContestMatchStatus.DRAFT,
          scheduledAt: new Date(
            contest.startsAt.getTime() + (rounds.flat().length + matchNo - 1) * 10 * 60 * 1000,
          ),
          advancementRule: { winners_to_advance: 1, format: this.code },
          metadata: { generated_from: 'contest-runtime.generate', format: this.code },
          participants: [],
        });
      }
    }

    // Link next matches
    for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex += 1) {
      for (const match of rounds[roundIndex]) {
        const nextMatch = rounds[roundIndex + 1][Math.floor((match.matchNo - 1) / 2)];
        match.nextMatchIndex = rounds[roundIndex + 1].indexOf(nextMatch);
      }
    }

    // Assign participants to round 1
    for (const [index, registration] of orderedRegistrations.entries()) {
      const match = rounds[0][Math.floor(index / drivers)];
      const slotNo = (index % drivers) + 1;
      match.participants.push({
        registrationId: registration.id,
        slotNo,
        lane: `L${slotNo}`,
        seedNo: index + 1,
        status: ContestParticipantStatus.READY,
        metadata: { generated_seed_order: index + 1 },
      });
    }

    // Auto-bye: round 1 matches with only one participant
    for (const match of rounds[0]) {
      if (match.participants.length === 1) {
        const byeWinner = match.participants[0];
        match.isBye = true;
        match.byeWinnerRegistrationId = byeWinner.registrationId;
        match.status = ContestMatchStatus.COMPLETED;
        match.metadata = {
          ...match.metadata,
          bye: true,
          bye_winner_registration_id: byeWinner.registrationId,
        };
      }
    }

    return rounds.flat();
  }

  buildResultSummary(
    _contest: Contest,
    _match: ContestMatch,
    participants: ContestMatchParticipant[],
  ): Record<string, unknown> {
    const winner = participants.find((item) => item.isWinner) ?? null;
    return {
      winner_registration_id: winner?.registrationId ?? null,
      participants_count: participants.length,
    };
  }

  inferWinners(
    participants: ContestMatchParticipant[],
    winnersToAdvance: number,
  ): ContestMatchParticipant[] {
    return inferMatchWinners(participants, winnersToAdvance);
  }

  canPublishLeaderboard(matches: ContestMatch[]): boolean {
    return matches.every((match) => match.status === ContestMatchStatus.COMPLETED);
  }

  private resolveDriversPerMatch(contest: Contest): number {
    const configValue = contest.config?.drivers_per_match;
    return typeof configValue === 'number' && Number.isFinite(configValue) ? configValue : 2;
  }
}

const engines = new Map<string, ContestFormatEngine>([
  [new TimeTrialEngine().code, new TimeTrialEngine()],
  [new KnockoutEngine().code, new KnockoutEngine()],
]);

export function getContestFormatEngine(contest: Contest): ContestFormatEngine {
  const code =
    contest.config?.runtime_format === 'TIME_TRIAL' || contest.config?.format === 'TIME_TRIAL'
      ? 'TIME_TRIAL'
      : 'KNOCKOUT';
  return engines.get(code) ?? new KnockoutEngine();
}

export function registerContestFormatEngine(engine: ContestFormatEngine): void {
  engines.set(engine.code, engine);
}

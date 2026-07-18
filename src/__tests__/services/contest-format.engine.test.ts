import { Contest } from '../../models/contest.entity';
import { ContestMatch } from '../../models/contest-match.entity';
import { ContestMatchParticipant } from '../../models/contest-match-participant.entity';
import { ContestRegistration } from '../../models/contest-registration.entity';
import {
  ContestEntryFeePaymentStatus,
  ContestMatchStatus,
  ContestMatchType,
  ContestParticipantStatus,
  ContestRegistrationStatus,
  ContestStatus,
  VehicleSource,
} from '../../types';
import {
  KnockoutEngine,
  TimeTrialEngine,
  getContestFormatEngine,
} from '../../services/contest-format.engine';

function createMockContest(overrides?: Partial<Contest>): Contest {
  const now = new Date();
  return {
    id: 'contest-1',
    cafeId: 'cafe-1',
    providerId: 'provider-1',
    name: 'Test Contest',
    description: null,
    trackTypeId: 'track-1',
    contestTypeId: 'type-1',
    contestFormatId: 'format-1',
    contestTemplateId: 'template-1',
    registrationOpensAt: new Date(now.getTime() - 86400000),
    registrationClosesAt: new Date(now.getTime() + 86400000),
    startsAt: new Date(now.getTime() + 86400000),
    endsAt: new Date(now.getTime() + 2 * 86400000),
    capacity: 32,
    entryFee: 0,
    status: ContestStatus.OPEN,
    vehicleRule: { vehicle_policy: 'MIXED', assignment_policy: 'AT_CHECK_IN' },
    config: {},
    bannerImageUrl: null,
    createdBy: 'provider-1',
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Contest;
}

function createMockRegistration(id: string, index: number): ContestRegistration {
  const now = new Date();
  return {
    id,
    contestId: 'contest-1',
    userId: `user-${index}`,
    participantRoleSnapshot: 'CUSTOMER',
    vehicleSource: VehicleSource.RENTAL,
    vehicleId: null,
    customerVehicleId: null,
    bookingId: null,
    status: ContestRegistrationStatus.CHECKED_IN,
    checkInCode: `CODE${index}`,
    checkedInCafeId: 'cafe-1',
    checkedInBy: 'staff-1',
    checkedInAt: new Date(now.getTime() + index * 1000),
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    paymentStatus: ContestEntryFeePaymentStatus.NOT_REQUIRED,
    entryFeeAmount: 0,
    entryFeeDueAt: null,
    entryFeeMarkedPaidBy: null,
    entryFeeMarkedPaidAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  } as ContestRegistration;
}

describe('ContestFormatEngine', () => {
  describe('TimeTrialEngine', () => {
    it('should generate one match per registration', () => {
      const engine = new TimeTrialEngine();
      const contest = createMockContest({ config: { format: 'TIME_TRIAL' } });
      const registrations = [createMockRegistration('r1', 0), createMockRegistration('r2', 1)];
      const matches = engine.generateMatches({
        contest,
        cafeId: 'cafe-1',
        registrations,
        registrationOrder: ['r1', 'r2'],
      });

      expect(matches).toHaveLength(2);
      expect(matches[0].roundNo).toBe(1);
      expect(matches[0].matchType).toBe(ContestMatchType.TIME_ATTACK);
      expect(matches[0].participants).toHaveLength(1);
      expect(matches[0].participants[0].registrationId).toBe('r1');
    });

    it('should infer winner by best lap', () => {
      const engine = new TimeTrialEngine();
      const contest = createMockContest({
        config: { format: 'TIME_TRIAL', leaderboard_mode: 'BEST_LAP' },
      });
      const mockParticipants = [
        { id: 'p1', registrationId: 'r1', bestLapSeconds: 12.5, isWinner: false },
        { id: 'p2', registrationId: 'r2', bestLapSeconds: 11.8, isWinner: false },
      ] as unknown as ContestMatchParticipant[];
      const winners = engine.inferWinners(mockParticipants, 1);
      expect(winners[0].registrationId).toBe('r2');
    });

    it('should build result summary with best lap mode', () => {
      const engine = new TimeTrialEngine();
      const contest = createMockContest({
        config: { format: 'TIME_TRIAL', leaderboard_mode: 'BEST_LAP' },
      });
      const match = { matchType: ContestMatchType.TIME_ATTACK } as unknown as ContestMatch;
      const participants = [
        { registrationId: 'r1', bestLapSeconds: 12.5, totalTimeSeconds: 45.2, isWinner: true },
      ] as unknown as ContestMatchParticipant[];
      const summary = engine.buildResultSummary(contest, match, participants);
      expect(summary.leaderboard_mode).toBe('BEST_LAP');
      expect(summary.winner_registration_id).toBe('r1');
      expect(summary.best_lap_seconds).toBe(12.5);
    });
  });

  describe('KnockoutEngine', () => {
    it('should generate bracket with correct round count', () => {
      const engine = new KnockoutEngine();
      const contest = createMockContest({ config: { format: 'KNOCKOUT' } });
      const registrations = Array.from({ length: 8 }, (_, i) =>
        createMockRegistration(`r${i + 1}`, i),
      );
      const matches = engine.generateMatches({
        contest,
        cafeId: 'cafe-1',
        registrations,
        registrationOrder: registrations.map((r) => r.id),
      });

      // 4 round 1 + 2 semifinal + 1 final = 7
      expect(matches).toHaveLength(7);
      const round1 = matches.filter((m) => m.roundNo === 1);
      expect(round1).toHaveLength(4);
      expect(round1.every((m) => m.status === ContestMatchStatus.READY)).toBe(true);
      const finals = matches.filter((m) => m.roundNo === 3);
      expect(finals).toHaveLength(1);
      expect(finals[0].matchType).toBe(ContestMatchType.FINAL);
      expect(finals[0].status).toBe(ContestMatchStatus.DRAFT);
    });

    it('should create auto-bye for odd participants', () => {
      const engine = new KnockoutEngine();
      const contest = createMockContest({ config: { format: 'KNOCKOUT' } });
      const registrations = Array.from({ length: 7 }, (_, i) =>
        createMockRegistration(`r${i + 1}`, i),
      );
      const matches = engine.generateMatches({
        contest,
        cafeId: 'cafe-1',
        registrations,
        registrationOrder: registrations.map((r) => r.id),
      });

      const round1 = matches.filter((m) => m.roundNo === 1);
      const byeMatch = round1.find((m) => m.isBye);
      expect(byeMatch).toBeDefined();
      expect(byeMatch?.status).toBe(ContestMatchStatus.COMPLETED);
      expect(byeMatch?.byeWinnerRegistrationId).toBeDefined();
    });

    it('should link next matches in round sequence', () => {
      const engine = new KnockoutEngine();
      const contest = createMockContest({ config: { format: 'KNOCKOUT' } });
      const registrations = Array.from({ length: 4 }, (_, i) =>
        createMockRegistration(`r${i + 1}`, i),
      );
      const matches = engine.generateMatches({
        contest,
        cafeId: 'cafe-1',
        registrations,
        registrationOrder: registrations.map((r) => r.id),
      });

      const round1 = matches.filter((m) => m.roundNo === 1);
      const round2 = matches.filter((m) => m.roundNo === 2);
      expect(round1).toHaveLength(2);
      expect(round2).toHaveLength(1);
      expect(round1[0].nextMatchIndex).toBe(0);
      expect(round1[1].nextMatchIndex).toBe(0);
    });
  });

  describe('getContestFormatEngine', () => {
    it('should return TimeTrialEngine when format is TIME_TRIAL', () => {
      const contest = createMockContest({ config: { format: 'TIME_TRIAL' } });
      expect(getContestFormatEngine(contest).code).toBe('TIME_TRIAL');
    });

    it('should return KnockoutEngine for any other format', () => {
      const contest = createMockContest({ config: { format: 'KNOCKOUT' } });
      expect(getContestFormatEngine(contest).code).toBe('KNOCKOUT');
    });
  });
});

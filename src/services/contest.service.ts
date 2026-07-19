import { In, Not } from 'typeorm';
import { randomBytes } from 'crypto';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { Booking } from '../models/booking.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { Cafe } from '../models/cafe.entity';
import { ContestBan } from '../models/contest-ban.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestFormat } from '../models/contest-format.entity';
import { ContestMatch } from '../models/contest-match.entity';
import { ContestMatchParticipant } from '../models/contest-match-participant.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { ContestStaffAssignment } from '../models/contest-staff-assignment.entity';
import { ContestTemplate } from '../models/contest-template.entity';
import { ContestType } from '../models/contest-type.entity';
import { Contest } from '../models/contest.entity';
import { PaymentTransaction } from '../models/payment-transaction.entity';
import { TrackType } from '../models/track-type.entity';
import { User } from '../models/user.entity';
import {
  AppError,
  BookingStatus,
  ContestBanScopeType,
  ContestEntryFeePaymentStatus,
  ContestMatchStatus,
  ContestRegistrationStatus,
  ContestStatus,
  NotificationType,
  PaymentTransactionStatus,
  PaymentTransactionSubjectType,
  PaymentTransactionType,
  UserRole,
  VehicleSource,
} from '../types';
import {
  assertContestOperator,
  assertContestOwner,
  assertProviderViewer,
  getActiveContestBan,
  getContestOrThrow,
  isStaffAssignedToCafe,
  isStaffAssignedToContest,
  writeContestAudit,
} from './contest.helpers';
import { Viewer } from './cafe.service';
import {
  assertNoContestBookingConflicts,
  mergeContestConfig,
  resolveContestResourceLocks,
} from './contest-lock.service';
import { createPaymentUrl } from './vnpay.service';
import { env } from '../config/env';
import { processMockConfirmation } from './payment.service';
import { createNotification } from './notification.service';
import { createContestRentalBooking, ContestRentalSlotInput } from './contest-rental.service';
import { emailService } from './email.service';
import { getContestPublicRuntimeSummary } from './contest-runtime.service';

type ListContestsOptions = {
  page: number;
  limit: number;
  scope?: 'managed';
  status?: ContestStatus;
  contest_type_id?: string;
  contest_format_id?: string;
  cafe_id?: string;
  query?: string;
  viewer?: Viewer;
};

type CreateContestBody = {
  name: string;
  description?: string | null;
  contest_type_id: string;
  contest_format_id: string;
  contest_template_id: string;
  track_type_id: string;
  participating_cafe_ids: string[];
  starts_at: Date;
  ends_at: Date;
  registration_opens_at: Date;
  registration_closes_at: Date;
  capacity: number;
  entry_fee: number;
  banner_image_url?: string | null;
  vehicle_rule: Record<string, unknown>;
  config: Record<string, unknown>;
};

type UpdateContestBody = Partial<CreateContestBody>;

type CreateRegistrationBody = {
  booking_id?: string;
  vehicle_id?: string;
  vehicle_source: VehicleSource;
  rental_slot?: {
    cafe_id: string;
    slot_start: string | Date;
    slot_end: string | Date;
    track_config_id?: string | null;
    vehicle_catalog_id?: string | null;
  } | null;
  byoc_vehicle_name?: string;
  byoc_vehicle_brand?: string;
  byoc_vehicle_class?: string;
  byoc_vehicle_notes?: string;
};

type MyContestRegistrationsQuery = {
  query?: string;
  contest_status?: ContestStatus;
  customer_journey_status?:
    | 'PENDING_APPROVAL'
    | 'APPROVED_WAITING_CHECKIN'
    | 'CHECKED_IN_WAITING_BRACKET'
    | 'IN_BRACKET'
    | 'ADVANCED'
    | 'ELIMINATED'
    | 'FINISHED'
    | 'CANCELLED';
};

type ContestRegistrationsQuery = {
  query?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'CHECKED_IN';
  payment_status?: 'NOT_REQUIRED' | 'PENDING_PAYMENT' | 'PENDING_REVIEW' | 'WAIVED' | 'MARKED_PAID';
};

type ContestBanPayload = {
  user_id: string;
  scope_type: ContestBanScopeType;
  reason: string;
  evidence?: Record<string, unknown>;
  expires_at?: Date | null;
};

function getRegistrationStatusLabel(status: ContestRegistrationStatus) {
  switch (status) {
    case ContestRegistrationStatus.PENDING:
      return 'Cho duyet';
    case ContestRegistrationStatus.CONFIRMED:
      return 'Da duyet';
    case ContestRegistrationStatus.CHECKED_IN:
      return 'Da check-in';
    case ContestRegistrationStatus.CANCELLED:
      return 'Da huy';
    default:
      return status;
  }
}

function getPaymentStatusLabel(status: ContestEntryFeePaymentStatus) {
  switch (status) {
    case ContestEntryFeePaymentStatus.NOT_REQUIRED:
      return 'Khong can thanh toan';
    case ContestEntryFeePaymentStatus.PENDING_PAYMENT:
      return 'Cho thanh toan';
    case ContestEntryFeePaymentStatus.PENDING_REVIEW:
      return 'Cho xac nhan';
    case ContestEntryFeePaymentStatus.WAIVED:
      return 'Da mien phi';
    case ContestEntryFeePaymentStatus.MARKED_PAID:
      return 'Da ghi nhan thanh toan';
    default:
      return status;
  }
}

async function loadContestCatalogMaps(contests: Contest[]) {
  const trackTypeIds = Array.from(
    new Set(contests.map((item) => item.trackTypeId).filter(Boolean)),
  ) as string[];
  const typeIds = Array.from(
    new Set(contests.map((item) => item.contestTypeId).filter(Boolean)),
  ) as string[];
  const formatIds = Array.from(
    new Set(contests.map((item) => item.contestFormatId).filter(Boolean)),
  ) as string[];
  const templateIds = Array.from(
    new Set(contests.map((item) => item.contestTemplateId).filter(Boolean)),
  ) as string[];
  const contestIds = contests.map((item) => item.id);

  const [trackTypes, types, formats, templates, contestCafes, registrations, directAssignments] =
    await Promise.all([
      trackTypeIds.length > 0
        ? AppDataSource.getRepository(TrackType).findBy({ id: In(trackTypeIds) })
        : Promise.resolve([]),
      typeIds.length > 0
        ? AppDataSource.getRepository(ContestType).findBy({ id: In(typeIds) })
        : Promise.resolve([]),
      formatIds.length > 0
        ? AppDataSource.getRepository(ContestFormat).findBy({ id: In(formatIds) })
        : Promise.resolve([]),
      templateIds.length > 0
        ? AppDataSource.getRepository(ContestTemplate).findBy({ id: In(templateIds) })
        : Promise.resolve([]),
      contestIds.length > 0
        ? AppDataSource.getRepository(ContestCafe).findBy({ contestId: In(contestIds) })
        : Promise.resolve([]),
      contestIds.length > 0
        ? AppDataSource.getRepository(ContestRegistration).findBy({ contestId: In(contestIds) })
        : Promise.resolve([]),
      contestIds.length > 0
        ? AppDataSource.getRepository(ContestStaffAssignment).findBy({ contestId: In(contestIds) })
        : Promise.resolve([]),
    ]);

  const cafeIds = Array.from(new Set(contestCafes.map((item) => item.cafeId)));
  const staffIds = Array.from(new Set(directAssignments.map((item) => item.staffId)));
  const cafes =
    cafeIds.length > 0 ? await AppDataSource.getRepository(Cafe).findBy({ id: In(cafeIds) }) : [];
  const staffs =
    staffIds.length > 0 ? await AppDataSource.getRepository(User).findBy({ id: In(staffIds) }) : [];

  return {
    trackTypeMap: new Map(trackTypes.map((item) => [item.id, item])),
    typeMap: new Map(types.map((item) => [item.id, item])),
    formatMap: new Map(formats.map((item) => [item.id, item])),
    templateMap: new Map(templates.map((item) => [item.id, item])),
    cafesByContest: contestCafes.reduce<Map<string, ContestCafe[]>>((map, item) => {
      const list = map.get(item.contestId) ?? [];
      list.push(item);
      map.set(item.contestId, list);
      return map;
    }, new Map()),
    cafeMap: new Map(cafes.map((item) => [item.id, item])),
    registrationStatsByContest: registrations.reduce<
      Map<string, { total: number; checkedIn: number; confirmed: number }>
    >((map, item) => {
      const current = map.get(item.contestId) ?? { total: 0, checkedIn: 0, confirmed: 0 };
      if (item.status !== ContestRegistrationStatus.CANCELLED) current.total += 1;
      if (item.status === ContestRegistrationStatus.CHECKED_IN) current.checkedIn += 1;
      if (item.status === ContestRegistrationStatus.CONFIRMED) current.confirmed += 1;
      map.set(item.contestId, current);
      return map;
    }, new Map()),
    staffAssignmentsByContest: directAssignments.reduce<Map<string, ContestStaffAssignment[]>>(
      (map, item) => {
        const list = map.get(item.contestId) ?? [];
        list.push(item);
        map.set(item.contestId, list);
        return map;
      },
      new Map(),
    ),
    staffMap: new Map(staffs.map((item) => [item.id, item])),
  };
}

async function mapContestPayload(contests: Contest[]) {
  const {
    trackTypeMap,
    typeMap,
    formatMap,
    templateMap,
    cafesByContest,
    cafeMap,
    registrationStatsByContest,
    staffAssignmentsByContest,
    staffMap,
  } = await loadContestCatalogMaps(contests);

  return contests.map((contest) => {
    const branches = (cafesByContest.get(contest.id) ?? [])
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((item) => {
        const cafe = cafeMap.get(item.cafeId);
        return {
          id: item.id,
          cafe_id: item.cafeId,
          role: item.role,
          capacity_override: item.capacityOverride,
          check_in_enabled: item.checkInEnabled,
          display_order: item.displayOrder,
          cafe: cafe
            ? {
                id: cafe.id,
                name: cafe.name,
                district: cafe.district,
                city: cafe.city,
                status: cafe.status,
              }
            : null,
        };
      });

    const hostBranch = branches.find((item) => item.role === 'HOST') ?? branches[0] ?? null;
    const trackType = contest.trackTypeId ? (trackTypeMap.get(contest.trackTypeId) ?? null) : null;
    const contestType = contest.contestTypeId ? (typeMap.get(contest.contestTypeId) ?? null) : null;
    const contestFormat = contest.contestFormatId
      ? (formatMap.get(contest.contestFormatId) ?? null)
      : null;
    const contestTemplate = contest.contestTemplateId
      ? (templateMap.get(contest.contestTemplateId) ?? null)
      : null;
    const registrationStats = registrationStatsByContest.get(contest.id) ?? {
      total: 0,
      checkedIn: 0,
      confirmed: 0,
    };
    const resourceLocks = Array.isArray(contest.config?.resource_locks)
      ? (contest.config.resource_locks as unknown[])
      : [];
    const staffAssignments = (staffAssignmentsByContest.get(contest.id) ?? []).map((assignment) => {
      const staff = staffMap.get(assignment.staffId);
      return {
        id: assignment.id,
        staff_id: assignment.staffId,
        assigned_by: assignment.assignedBy,
        assigned_at: assignment.assignedAt,
        staff: staff
          ? {
              id: staff.id,
              full_name: staff.full_name,
              email: staff.email,
            }
          : null,
      };
    });

    return {
      id: contest.id,
      provider_id: contest.providerId,
      name: contest.name,
      description: contest.description,
      status: contest.status,
      starts_at: contest.startsAt,
      ends_at: contest.endsAt,
      registration_opens_at: contest.registrationOpensAt,
      registration_closes_at: contest.registrationClosesAt,
      capacity: contest.capacity,
      entry_fee: Number(contest.entryFee ?? 0),
      banner_image_url: contest.bannerImageUrl,
      vehicle_rule: contest.vehicleRule,
      config: contest.config ?? {},
      resource_locks: resourceLocks,
      prize_structure:
        (contest.config?.prize_structure as Record<string, unknown> | undefined) ??
        (contest.config?.prizes as unknown[] | undefined) ??
        null,
      created_by: contest.createdBy,
      created_at: contest.createdAt,
      updated_at: contest.updatedAt,
      host_branch: hostBranch,
      participating_branches: branches,
      track_type: trackType
        ? {
            id: trackType.id,
            code: trackType.code,
            name: trackType.name,
            description: trackType.description,
          }
        : null,
      contest_type: contestType
        ? {
            id: contestType.id,
            code: contestType.code,
            name: contestType.name,
            description: contestType.description,
          }
        : null,
      contest_format: contestFormat
        ? {
            id: contestFormat.id,
            code: contestFormat.code,
            name: contestFormat.name,
            description: contestFormat.description,
            supports_bracket: contestFormat.supportsBracket,
            supports_time_attack: contestFormat.supportsTimeAttack,
            supports_multi_round: contestFormat.supportsMultiRound,
          }
        : null,
      contest_template: contestTemplate
        ? {
            id: contestTemplate.id,
            code: contestTemplate.code,
            name: contestTemplate.name,
            description: contestTemplate.description,
            default_config: contestTemplate.defaultConfig,
            vehicle_policy_options: contestTemplate.vehiclePolicyOptions,
            feature_flags: contestTemplate.featureFlags,
          }
        : null,
      public_stats: {
        registration_count: registrationStats.total,
        confirmed_count: registrationStats.confirmed,
        checked_in_count: registrationStats.checkedIn,
        capacity_remaining:
          contest.capacity && contest.capacity > 0
            ? Math.max(0, contest.capacity - registrationStats.total)
            : null,
      },
      staff_assignments: staffAssignments,
    };
  });
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

async function loadLatestMatchMapForRegistrations(registrationIds: string[]) {
  if (registrationIds.length === 0) return new Map<string, Record<string, unknown>>();

  const rows = await AppDataSource.query<
    {
      registration_id: string;
      participant_status: string;
      finish_position: number | null;
      is_winner: boolean;
      match_id: string;
      contest_id: string;
      round_no: number;
      match_no: number;
      name: string | null;
      match_status: string;
      match_type: string;
      scheduled_at: string | null;
      started_at: string | null;
      ended_at: string | null;
      next_match_id: string | null;
    }[]
  >(
    `SELECT DISTINCT ON (p.registration_id)
       p.registration_id,
       p.status AS participant_status,
       p.finish_position,
       p.is_winner,
       m.id AS match_id,
       m.contest_id,
       m.round_no,
       m.match_no,
       m.name,
       m.status AS match_status,
       m.match_type,
       m.scheduled_at,
       m.started_at,
       m.ended_at,
       m.next_match_id
     FROM contest_match_participants p
     JOIN contest_matches m ON m.id = p.match_id
     WHERE p.registration_id = ANY($1::uuid[])
     ORDER BY p.registration_id, m.round_no DESC, m.match_no DESC, m.created_at DESC`,
    [registrationIds],
  );

  return new Map(
    rows.map((row) => [
      row.registration_id,
      {
        match_id: row.match_id,
        contest_id: row.contest_id,
        round_no: row.round_no,
        match_no: row.match_no,
        name: row.name,
        status: row.match_status,
        match_type: row.match_type,
        scheduled_at: row.scheduled_at,
        started_at: row.started_at,
        ended_at: row.ended_at,
        next_match_id: row.next_match_id,
        participant_status: row.participant_status,
        finish_position: row.finish_position,
        is_winner: row.is_winner,
      },
    ]),
  );
}

function deriveCustomerJourneyStatus(
  registration: ContestRegistration,
  contest: { status: ContestStatus } | undefined,
  latestMatch: Record<string, unknown> | undefined,
) {
  if (registration.status === ContestRegistrationStatus.CANCELLED) return 'CANCELLED';
  if (registration.status === ContestRegistrationStatus.PENDING) return 'PENDING_APPROVAL';
  if (registration.status === ContestRegistrationStatus.CONFIRMED)
    return 'APPROVED_WAITING_CHECKIN';

  if (!latestMatch) return 'CHECKED_IN_WAITING_BRACKET';

  const matchStatus = String(latestMatch.status ?? '');
  const isWinner = Boolean(latestMatch.is_winner);
  if (contest?.status === ContestStatus.COMPLETED) return 'FINISHED';
  if (matchStatus === 'RUNNING') return 'IN_BRACKET';
  if (matchStatus === 'COMPLETED' && isWinner) return 'ADVANCED';
  if (matchStatus === 'COMPLETED' && !isWinner) return 'ELIMINATED';

  return 'CHECKED_IN_WAITING_BRACKET';
}

async function mapContestRegistrationsPayload(
  registrations: ContestRegistration[],
  options?: { includeContest?: boolean },
) {
  const userMap = await loadUsersMap(
    Array.from(new Set(registrations.map((item) => item.userId).filter(Boolean))),
  );
  const contestMap = options?.includeContest
    ? new Map(
        (
          await mapContestPayload(
            await AppDataSource.getRepository(Contest).findBy({
              id: In(Array.from(new Set(registrations.map((item) => item.contestId)))),
            }),
          )
        ).map((item) => [item.id, item]),
      )
    : new Map<string, Awaited<ReturnType<typeof mapContestPayload>>[number]>();
  const latestMatchMap = await loadLatestMatchMapForRegistrations(
    registrations.map((item) => item.id),
  );

  return registrations.map((registration) => {
    const user = userMap.get(registration.userId);
    const contest = contestMap.get(registration.contestId);
    const latestMatch = latestMatchMap.get(registration.id);

    return {
      id: registration.id,
      contest_id: registration.contestId,
      user_id: registration.userId,
      status: registration.status,
      vehicle_source: registration.vehicleSource,
      vehicle_id: registration.vehicleId,
      customer_vehicle_id: registration.customerVehicleId,
      booking_id: registration.bookingId,
      check_in_code: registration.checkInCode,
      checked_in_cafe_id: registration.checkedInCafeId,
      checked_in_by: registration.checkedInBy,
      checked_in_at: registration.checkedInAt,
      payment_status: registration.paymentStatus,
      entry_fee_amount: Number(registration.entryFeeAmount ?? 0),
      cancellation_reason: registration.cancellationReason,
      metadata: registration.metadata ?? {},
      created_at: registration.createdAt,
      updated_at: registration.updatedAt,
      participant: user
        ? {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            avatar_url: user.avatar_url,
            driver_handle: getUserRacingProfile(user).driverHandle,
            driver_title_label: getUserRacingProfile(user).titleLabel,
          }
        : null,
      contest: contest ?? null,
      latest_match: latestMatch ?? null,
      customer_journey_status: deriveCustomerJourneyStatus(
        registration,
        contest ? { status: contest.status } : undefined,
        latestMatch,
      ),
    };
  });
}

async function resolveCatalogOrThrow(
  contestTypeId: string,
  contestFormatId: string,
  contestTemplateId: string,
) {
  const [contestType, contestFormat, contestTemplate] = await Promise.all([
    AppDataSource.getRepository(ContestType).findOne({
      where: { id: contestTypeId, isActive: true },
    }),
    AppDataSource.getRepository(ContestFormat).findOne({
      where: { id: contestFormatId, isActive: true },
    }),
    AppDataSource.getRepository(ContestTemplate).findOne({
      where: { id: contestTemplateId, isActive: true },
    }),
  ]);

  if (!contestType) throw new AppError('Contest type không hợp lệ', 400, 'CONTEST_TYPE_INVALID');
  if (!contestFormat)
    throw new AppError('Contest format không hợp lệ', 400, 'CONTEST_FORMAT_INVALID');
  if (!contestTemplate)
    throw new AppError('Contest template không hợp lệ', 400, 'CONTEST_TEMPLATE_INVALID');
  if (
    contestTemplate.contestTypeId !== contestType.id ||
    contestTemplate.contestFormatId !== contestFormat.id
  ) {
    throw new AppError(
      'Contest template không khớp với type/format đã chọn',
      400,
      'CONTEST_TEMPLATE_MISMATCH',
    );
  }

  return { contestType, contestFormat, contestTemplate };
}

async function resolveProviderBranchesOrThrow(providerId: string, cafeIds: string[]) {
  const cafes = await AppDataSource.getRepository(Cafe).findBy({ id: In(cafeIds) });
  if (cafes.length !== cafeIds.length) {
    throw new AppError('Có chi nhánh không tồn tại', 400, 'CAFE_NOT_FOUND');
  }
  for (const cafe of cafes) {
    if (cafe.providerId !== providerId) {
      throw new AppError(
        'Chi nhánh không thuộc provider hiện tại',
        400,
        'CONTEST_BRANCH_FORBIDDEN',
      );
    }
    if (cafe.status !== 'ACTIVE') {
      throw new AppError(
        'Contest chỉ được gắn với chi nhánh ACTIVE',
        400,
        'CONTEST_BRANCH_INACTIVE',
      );
    }
  }
  return cafes;
}

function getRuntimeFormatFromCatalog(contestFormatCode: string) {
  return contestFormatCode === 'TIME_TRIAL' ? 'TIME_TRIAL' : 'KNOCKOUT';
}

function stripRuntimeManagedConfig(config: Record<string, unknown> | null | undefined) {
  const nextConfig = { ...(config ?? {}) };
  delete nextConfig.format;
  delete nextConfig.runtime_format;
  delete nextConfig.resource_locks;
  return nextConfig;
}

async function assertContestProviderOrAssignedStaff(contestId: string, viewer: Viewer) {
  return assertContestOperator(contestId, viewer);
}

async function resolveContestProviderIdForViewer(
  viewer: Viewer,
  contest?: Contest,
): Promise<string> {
  if (viewer.role === UserRole.PROVIDER) return viewer.userId;
  if (contest?.providerId) return contest.providerId;
  throw new AppError('Không xác định được provider của contest', 400, 'PROVIDER_NOT_RESOLVED');
}

function buildByocMetadata(body: CreateRegistrationBody) {
  return {
    vehicle_name: body.byoc_vehicle_name ?? null,
    vehicle_brand: body.byoc_vehicle_brand ?? null,
    vehicle_class: body.byoc_vehicle_class ?? null,
    notes: body.byoc_vehicle_notes ?? null,
  };
}

async function generateUniqueCheckInCode(
  manager: import('typeorm').EntityManager,
  maxAttempts = 5,
): Promise<string> {
  const repo = manager.getRepository(ContestRegistration);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    const existing = await repo.findOne({ where: { checkInCode: code } });
    if (!existing) return code;
  }
  throw new AppError('Không thể tạo mã check-in duy nhất', 500, 'CHECK_IN_CODE_GENERATION_FAILED');
}

async function removeRegistrationFromActiveMatches(registrationId: string) {
  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const matchRepo = AppDataSource.getRepository(ContestMatch);
  const participants = await participantRepo.find({ where: { registrationId } });

  for (const participant of participants) {
    const match = await matchRepo.findOne({ where: { id: participant.matchId } });
    if (!match || match.status === ContestMatchStatus.COMPLETED) continue;

    await participantRepo.remove(participant);

    const remainingCount = await participantRepo.count({ where: { matchId: match.id } });
    if (match.status === ContestMatchStatus.READY && remainingCount === 0) {
      match.status = ContestMatchStatus.DRAFT;
      await matchRepo.save(match);
    }
  }
}

async function loadContestNotificationContext(registration: ContestRegistration) {
  const [row] = await AppDataSource.query<
    {
      contest_name: string;
      contest_starts_at: string;
      contest_status: string;
      host_branch_name: string | null;
      customer_email: string;
      customer_name: string;
    }[]
  >(
    `SELECT c.name AS contest_name,
            c.starts_at AS contest_starts_at,
            c.status AS contest_status,
            host.name AS host_branch_name,
            u.email AS customer_email,
            u.full_name AS customer_name
       FROM contest_registrations cr
       JOIN contests c ON c.id = cr.contest_id
       JOIN users u ON u.id = cr.user_id
       LEFT JOIN cafes host ON host.id = c.cafe_id
      WHERE cr.id = $1`,
    [registration.id],
  );

  if (!row) return null;

  return {
    contestName: row.contest_name,
    contestStartsAt: new Date(row.contest_starts_at),
    contestStatus: row.contest_status,
    hostBranchName: row.host_branch_name,
    customerEmail: row.customer_email,
    customerName: row.customer_name ?? 'Racer',
  };
}

async function sendContestRegistrationCreatedSideEffects(registration: ContestRegistration) {
  const context = await loadContestNotificationContext(registration);
  if (!context) return;

  await createNotification(
    registration.userId,
    NotificationType.CONTEST_REGISTRATION_CREATED,
    'Dang ky giai dau thanh cong',
    `Ban da dang ky ${context.contestName}. RCField se tiep tuc cap nhat trang thai dang ky cho ban.`,
    {
      contest_id: registration.contestId,
      registration_id: registration.id,
    },
  );

  try {
    await emailService.sendContestRegistrationConfirmation({
      to: context.customerEmail,
      customerName: context.customerName,
      contestName: context.contestName,
      contestId: registration.contestId,
      contestStatusLabel: context.contestStatus,
      hostBranchName: context.hostBranchName,
      startsAt: context.contestStartsAt,
      registrationStatusLabel: getRegistrationStatusLabel(registration.status),
      paymentStatusLabel: getPaymentStatusLabel(registration.paymentStatus),
      entryFeeAmount: Number(registration.entryFeeAmount ?? 0),
    });
  } catch (error) {
    logger.error('ContestEmail', 'failed to send registration confirmation', error);
  }
}

async function sendContestRegistrationStatusNotification(
  registration: ContestRegistration,
  type: NotificationType,
  title: string,
  message: string,
) {
  await createNotification(registration.userId, type, title, message, {
    contest_id: registration.contestId,
    registration_id: registration.id,
  });
}

export async function listContestTypes() {
  return AppDataSource.getRepository(ContestType).find({
    where: { isActive: true },
    order: { sortOrder: 'ASC', name: 'ASC' },
  });
}

export async function listContestFormats() {
  return AppDataSource.getRepository(ContestFormat).find({
    where: { isActive: true },
    order: { sortOrder: 'ASC', name: 'ASC' },
  });
}

export async function listContestTemplates(query: {
  contest_type_id?: string;
  contest_format_id?: string;
  active_only?: boolean;
}) {
  const repo = AppDataSource.getRepository(ContestTemplate);
  const where: Record<string, unknown> = {};
  if (query.contest_type_id) where.contestTypeId = query.contest_type_id;
  if (query.contest_format_id) where.contestFormatId = query.contest_format_id;
  if (query.active_only ?? true) where.isActive = true;

  const templates = await repo.find({
    where,
    order: { sortOrder: 'ASC', name: 'ASC' },
  });
  return templates;
}

export async function listContests(options: ListContestsOptions) {
  const repo = AppDataSource.getRepository(Contest);
  const qb = repo.createQueryBuilder('contest');

  if (options.scope === 'managed') {
    if (options.viewer?.role === UserRole.PROVIDER) {
      qb.andWhere('contest.provider_id = :providerId', { providerId: options.viewer.userId });
    } else if (options.viewer?.role === UserRole.STAFF) {
      qb.innerJoin(
        ContestStaffAssignment,
        'contest_staff_assignment',
        'contest_staff_assignment.contest_id = contest.id AND contest_staff_assignment.staff_id = :staffId',
        { staffId: options.viewer.userId },
      );
    } else {
      throw new AppError('Bạn không có quyền xem danh sách contest quản lý', 403, 'FORBIDDEN');
    }
  } else {
    qb.andWhere('contest.status != :draft', { draft: ContestStatus.DRAFT });
    qb.andWhere('contest.status != :cancelled', { cancelled: ContestStatus.CANCELLED });
    if (options.viewer?.role === UserRole.STAFF) {
      qb.innerJoin(
        ContestStaffAssignment,
        'contest_staff_assignment',
        'contest_staff_assignment.contest_id = contest.id AND contest_staff_assignment.staff_id = :staffId',
        { staffId: options.viewer.userId },
      );
    }
  }

  if (options.status) qb.andWhere('contest.status = :status', { status: options.status });
  if (options.contest_type_id) {
    qb.andWhere('contest.contest_type_id = :contestTypeId', {
      contestTypeId: options.contest_type_id,
    });
  }
  if (options.contest_format_id) {
    qb.andWhere('contest.contest_format_id = :contestFormatId', {
      contestFormatId: options.contest_format_id,
    });
  }
  if (options.query) {
    qb.andWhere('(contest.name ILIKE :search OR contest.description ILIKE :search)', {
      search: `%${options.query.trim()}%`,
    });
  }
  if (options.cafe_id) {
    qb.innerJoin(ContestCafe, 'contest_cafe', 'contest_cafe.contest_id = contest.id');
    qb.andWhere('contest_cafe.cafe_id = :cafeId', { cafeId: options.cafe_id });
  }

  qb.orderBy('contest.starts_at', 'DESC');

  const [rows, total] = await qb
    .skip((options.page - 1) * options.limit)
    .take(options.limit)
    .getManyAndCount();

  const data = await mapContestPayload(rows);
  return { data, total };
}

export async function getContestDetail(contestId: string, viewer?: Viewer) {
  const contest = await getContestOrThrow(contestId);
  const isOwner = viewer?.role === UserRole.PROVIDER && contest.providerId === viewer.userId;
  const isAssignedStaff =
    viewer?.role === UserRole.STAFF
      ? await isStaffAssignedToContest(contestId, viewer.userId)
      : false;
  const isRegisteredCustomer =
    viewer?.role === UserRole.CUSTOMER
      ? Boolean(
          await AppDataSource.getRepository(ContestRegistration).findOne({
            where: { contestId, userId: viewer.userId },
          }),
        )
      : false;

  if (
    !isOwner &&
    !isAssignedStaff &&
    !isRegisteredCustomer &&
    [ContestStatus.DRAFT, ContestStatus.CANCELLED].includes(contest.status)
  ) {
    throw new AppError('Contest chưa được công khai', 404, 'CONTEST_NOT_PUBLIC');
  }
  const [payload] = await mapContestPayload([contest]);
  const runtimeSummary = await getContestPublicRuntimeSummary(contestId, viewer).catch(() => null);
  const publishedLeaderboard = (contest.config?.published_leaderboard ?? null) as Record<
    string,
    unknown
  > | null;

  if (viewer?.role === UserRole.CUSTOMER) {
    const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
      where: { contestId, userId: viewer.userId },
    });
    if (registration) {
      const [mappedRegistration] = await mapContestRegistrationsPayload([registration], {
        includeContest: false,
      });
      return {
        ...payload,
        my_registration: mappedRegistration,
        published_leaderboard: publishedLeaderboard,
        runtime_summary: runtimeSummary,
        highlight_rounds: runtimeSummary?.highlight_rounds ?? [],
      };
    }
  }

  return {
    ...payload,
    operator_access: isOwner || isAssignedStaff,
    published_leaderboard: publishedLeaderboard,
    runtime_summary: runtimeSummary,
    highlight_rounds: runtimeSummary?.highlight_rounds ?? [],
  };
}

export async function createContest(viewer: Viewer, body: CreateContestBody) {
  assertProviderViewer(viewer);
  const [trackType, branches, catalog] = await Promise.all([
    AppDataSource.getRepository(TrackType).findOne({
      where: { id: body.track_type_id, isActive: true },
    }),
    resolveProviderBranchesOrThrow(viewer.userId, body.participating_cafe_ids),
    resolveCatalogOrThrow(body.contest_type_id, body.contest_format_id, body.contest_template_id),
  ]);
  if (!trackType) throw new AppError('Track type không hợp lệ', 400, 'TRACK_TYPE_INVALID');
  const resourceLocks = await resolveContestResourceLocks(body.participating_cafe_ids, body.config);
  await assertNoContestBookingConflicts({
    startsAt: body.starts_at,
    endsAt: body.ends_at,
    trackTypeId: trackType.id,
    resourceLocks,
  });
  const runtimeFormat = getRuntimeFormatFromCatalog(catalog.contestFormat.code);

  const repo = AppDataSource.getRepository(Contest);
  const contest = repo.create({
    cafeId: branches[0].id,
    providerId: viewer.userId,
    name: body.name,
    description: body.description ?? null,
    legacyTrackType: trackType.code,
    trackTypeId: trackType.id,
    contestTypeId: catalog.contestType.id,
    contestFormatId: catalog.contestFormat.id,
    contestTemplateId: catalog.contestTemplate.id,
    registrationOpensAt: body.registration_opens_at,
    registrationClosesAt: body.registration_closes_at,
    vehicleRule: body.vehicle_rule,
    bannerImageUrl: body.banner_image_url ?? null,
    config: mergeContestConfig(
      {
        ...(catalog.contestTemplate.defaultConfig ?? {}),
        ...stripRuntimeManagedConfig(body.config),
      },
      runtimeFormat,
      resourceLocks,
    ),
    startsAt: body.starts_at,
    endsAt: body.ends_at,
    capacity: body.capacity,
    entryFee: body.entry_fee,
    status: ContestStatus.DRAFT,
    createdBy: viewer.userId,
  });

  const saved = await repo.save(contest);
  const contestCafeRepo = AppDataSource.getRepository(ContestCafe);
  await contestCafeRepo.save(
    branches.map((branch, index) =>
      contestCafeRepo.create({
        contestId: saved.id,
        cafeId: branch.id,
        role: index === 0 ? 'HOST' : 'PARTICIPATING',
        displayOrder: index,
        checkInEnabled: true,
      }),
    ),
  );

  await writeContestAudit({
    contestId: saved.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.created',
    afterJson: { name: saved.name, status: saved.status },
  });

  return getContestDetail(saved.id, viewer);
}

export async function updateContest(contestId: string, viewer: Viewer, body: UpdateContestBody) {
  const contest = await assertContestProviderOrAssignedStaff(contestId, viewer);
  if (![ContestStatus.DRAFT, ContestStatus.OPEN].includes(contest.status)) {
    throw new AppError(
      'Chỉ được sửa contest ở trạng thái DRAFT hoặc OPEN',
      400,
      'CONTEST_NOT_EDITABLE',
    );
  }

  let trackType: TrackType | null = null;
  if (body.track_type_id) {
    trackType = await AppDataSource.getRepository(TrackType).findOne({
      where: { id: body.track_type_id, isActive: true },
    });
    if (!trackType) throw new AppError('Track type không hợp lệ', 400, 'TRACK_TYPE_INVALID');
  }

  let catalog: Awaited<ReturnType<typeof resolveCatalogOrThrow>> | null = null;
  const nextTypeId = body.contest_type_id ?? contest.contestTypeId;
  const nextFormatId = body.contest_format_id ?? contest.contestFormatId;
  const nextTemplateId = body.contest_template_id ?? contest.contestTemplateId;
  if (nextTypeId && nextFormatId && nextTemplateId) {
    catalog = await resolveCatalogOrThrow(nextTypeId, nextFormatId, nextTemplateId);
  }

  const nextParticipatingCafeIds =
    body.participating_cafe_ids ??
    (
      await AppDataSource.getRepository(ContestCafe).find({
        where: { contestId: contest.id },
        order: { displayOrder: 'ASC' },
      })
    ).map((item) => item.cafeId);

  if (body.participating_cafe_ids) {
    const providerId = await resolveContestProviderIdForViewer(viewer, contest);
    const branches = await resolveProviderBranchesOrThrow(providerId, body.participating_cafe_ids);
    const existingCafes = await AppDataSource.getRepository(ContestCafe).find({
      where: { contestId: contest.id },
    });
    const existingByCafeId = new Map(existingCafes.map((item) => [item.cafeId, item]));

    await AppDataSource.getRepository(ContestCafe).delete({ contestId: contest.id });
    await AppDataSource.getRepository(ContestCafe).save(
      branches.map((branch, index) => {
        const existing = existingByCafeId.get(branch.id);
        return {
          contestId: contest.id,
          cafeId: branch.id,
          role: index === 0 ? 'HOST' : 'PARTICIPATING',
          displayOrder: index,
          checkInEnabled: existing?.checkInEnabled ?? true,
          capacityOverride: existing?.capacityOverride ?? null,
        };
      }),
    );
    contest.cafeId = branches[0].id;
  }

  const before = {
    name: contest.name,
    status: contest.status,
    registrationOpensAt: contest.registrationOpensAt,
    registrationClosesAt: contest.registrationClosesAt,
  };

  if (body.name !== undefined) contest.name = body.name;
  if (body.description !== undefined) contest.description = body.description ?? null;
  if (trackType) {
    contest.trackTypeId = trackType.id;
    contest.legacyTrackType = trackType.code;
  }
  if (catalog) {
    contest.contestTypeId = catalog.contestType.id;
    contest.contestFormatId = catalog.contestFormat.id;
    contest.contestTemplateId = catalog.contestTemplate.id;
  }
  if (body.registration_opens_at !== undefined)
    contest.registrationOpensAt = body.registration_opens_at;
  if (body.registration_closes_at !== undefined)
    contest.registrationClosesAt = body.registration_closes_at;
  if (body.vehicle_rule !== undefined) contest.vehicleRule = body.vehicle_rule;
  if (body.banner_image_url !== undefined) contest.bannerImageUrl = body.banner_image_url ?? null;
  if (body.starts_at !== undefined) contest.startsAt = body.starts_at;
  if (body.ends_at !== undefined) contest.endsAt = body.ends_at;
  if (body.capacity !== undefined) contest.capacity = body.capacity;
  if (body.entry_fee !== undefined) contest.entryFee = body.entry_fee;

  const nextTrackTypeId = contest.trackTypeId;
  if (!nextTrackTypeId) {
    throw new AppError('Contest chưa có track type hợp lệ', 400, 'TRACK_TYPE_INVALID');
  }
  const nextRuntimeFormat = getRuntimeFormatFromCatalog(
    catalog?.contestFormat.code ??
      (
        await AppDataSource.getRepository(ContestFormat).findOne({
          where: { id: contest.contestFormatId ?? undefined },
        })
      )?.code ??
      'KNOCKOUT',
  );
  const baseConfig =
    body.config !== undefined
      ? {
          ...(catalog?.contestTemplate.defaultConfig ?? {}),
          ...stripRuntimeManagedConfig(body.config),
        }
      : {
          ...stripRuntimeManagedConfig(contest.config),
        };
  const resourceLocks = await resolveContestResourceLocks(nextParticipatingCafeIds, {
    ...baseConfig,
    resource_locks:
      body.config && typeof body.config === 'object'
        ? (body.config.resource_locks as unknown)
        : contest.config?.resource_locks,
  });
  await assertNoContestBookingConflicts({
    startsAt: contest.startsAt,
    endsAt: contest.endsAt,
    trackTypeId: nextTrackTypeId,
    resourceLocks,
  });
  contest.config = mergeContestConfig(baseConfig, nextRuntimeFormat, resourceLocks);

  await AppDataSource.getRepository(Contest).save(contest);
  await writeContestAudit({
    contestId: contest.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.updated',
    beforeJson: before,
    afterJson: {
      name: contest.name,
      status: contest.status,
      registrationOpensAt: contest.registrationOpensAt,
      registrationClosesAt: contest.registrationClosesAt,
    },
  });
  return getContestDetail(contest.id, viewer);
}

async function cleanUpContestOnCancel(contestId: string, actorId: string) {
  const registrationRepo = AppDataSource.getRepository(ContestRegistration);
  const registrations = await registrationRepo.find({
    where: { contestId, status: Not(ContestRegistrationStatus.CANCELLED) },
  });

  for (const registration of registrations) {
    registration.status = ContestRegistrationStatus.CANCELLED;
    registration.cancelledBy = actorId;
    registration.cancelledAt = new Date();
    registration.cancellationReason = 'Contest cancelled';
    registration.metadata = {
      ...(registration.metadata ?? {}),
      refund_needed: registration.paymentStatus === ContestEntryFeePaymentStatus.MARKED_PAID,
    };
    await registrationRepo.save(registration);
  }

  const matchRepo = AppDataSource.getRepository(ContestMatch);
  const matches = await matchRepo.find({ where: { contestId } });
  for (const match of matches) {
    if (match.status === ContestMatchStatus.CANCELLED) continue;
    match.status = ContestMatchStatus.CANCELLED;
    match.endedAt = match.endedAt ?? new Date();
    await matchRepo.save(match);
  }
}

export async function changeContestStatus(
  contestId: string,
  viewer: Viewer,
  nextStatus: ContestStatus.OPEN | ContestStatus.CLOSED | ContestStatus.CANCELLED,
) {
  const contest = await assertContestProviderOrAssignedStaff(contestId, viewer);
  const allowedTransitions: Record<string, ContestStatus[]> = {
    [ContestStatus.DRAFT]: [ContestStatus.OPEN, ContestStatus.CANCELLED],
    [ContestStatus.OPEN]: [ContestStatus.CLOSED, ContestStatus.CANCELLED],
    [ContestStatus.CLOSED]: [ContestStatus.CANCELLED],
    [ContestStatus.RUNNING]: [ContestStatus.CANCELLED],
  };

  if (!allowedTransitions[contest.status]?.includes(nextStatus)) {
    throw new AppError(
      'Không thể chuyển contest sang trạng thái này',
      400,
      'CONTEST_STATUS_INVALID',
    );
  }

  if (nextStatus === ContestStatus.CANCELLED) {
    await cleanUpContestOnCancel(contest.id, viewer.userId);
  }

  contest.status = nextStatus;
  await AppDataSource.getRepository(Contest).save(contest);
  await writeContestAudit({
    contestId: contest.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType:
      nextStatus === ContestStatus.OPEN
        ? 'contest.opened'
        : nextStatus === ContestStatus.CLOSED
          ? 'contest.closed'
          : 'contest.cancelled',
    afterJson: { status: nextStatus },
  });

  return getContestDetail(contest.id, viewer);
}

export async function createContestRegistration(
  contestId: string,
  viewer: Viewer,
  body: CreateRegistrationBody,
) {
  if (viewer.role !== UserRole.CUSTOMER) {
    throw new AppError('Chỉ customer mới được đăng ký contest', 403, 'FORBIDDEN');
  }
  const contest = await getContestOrThrow(contestId);
  if (contest.status !== ContestStatus.OPEN) {
    throw new AppError('Contest chưa mở đăng ký', 400, 'CONTEST_NOT_OPEN');
  }
  const now = new Date();
  if (contest.registrationOpensAt && now < contest.registrationOpensAt) {
    throw new AppError('Chưa tới thời gian mở đăng ký', 400, 'CONTEST_REGISTRATION_NOT_OPEN_YET');
  }
  if (contest.registrationClosesAt && now > contest.registrationClosesAt) {
    throw new AppError('Contest đã đóng đăng ký', 400, 'CONTEST_REGISTRATION_CLOSED');
  }
  if (contest.providerId) {
    const activeBan = await getActiveContestBan(viewer.userId, contest.providerId, contest.id);
    if (activeBan) {
      throw new AppError(
        'Bạn đang bị chặn tham gia contest này',
        403,
        'CONTEST_PARTICIPANT_BANNED',
      );
    }
  }

  const vehiclePolicy = String(contest.vehicleRule?.vehicle_policy ?? 'RENTAL_ONLY');
  if (vehiclePolicy === 'RENTAL_ONLY' && body.vehicle_source !== VehicleSource.RENTAL) {
    throw new AppError(
      'Giải đấu chỉ chấp nhận thuê xe của cafe',
      400,
      'CONTEST_VEHICLE_POLICY_VIOLATED',
    );
  }
  if (vehiclePolicy === 'BYOC_ONLY' && body.vehicle_source !== VehicleSource.BYOC) {
    throw new AppError(
      'Giải đấu chỉ chấp nhận xe cá nhân (BYOC)',
      400,
      'CONTEST_VEHICLE_POLICY_VIOLATED',
    );
  }

  let resolvedBookingId: string | undefined = body.booking_id;
  let resolvedVehicleId: string | undefined = body.vehicle_id;

  if (body.vehicle_source === VehicleSource.RENTAL) {
    if (body.rental_slot && !body.booking_id) {
      const rentalResult = await createContestRentalBooking(
        contest,
        viewer.userId,
        body.rental_slot as ContestRentalSlotInput,
      );
      resolvedBookingId = rentalResult.booking_id;
      resolvedVehicleId = rentalResult.vehicle_id;
    }

    if (!resolvedBookingId || !resolvedVehicleId) {
      throw new AppError(
        'Đăng ký RENTAL yêu cầu booking_id và vehicle_id',
        400,
        'CONTEST_RENTAL_BOOKING_REQUIRED',
      );
    }
    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: resolvedBookingId, customerId: viewer.userId },
    });
    if (!booking) throw new AppError('Booking không tồn tại', 404, 'BOOKING_NOT_FOUND');
    if (contest.trackTypeId && booking.trackTypeId !== contest.trackTypeId) {
      throw new AppError(
        'Booking không khớp loại track của contest',
        400,
        'BOOKING_TRACK_TYPE_MISMATCH',
      );
    }

    const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
      where: { contestId, cafeId: booking.cafeId },
    });
    if (!contestCafe) {
      throw new AppError(
        'Booking không thuộc chi nhánh tham gia contest',
        400,
        'BOOKING_CAFE_MISMATCH',
      );
    }

    if (booking.slotStart > contest.endsAt || booking.slotEnd < contest.startsAt) {
      throw new AppError('Khung giờ booking không giao với contest', 400, 'BOOKING_TIME_MISMATCH');
    }

    const bookingVehicle = await AppDataSource.getRepository(BookingVehicle).findOne({
      where: { bookingId: booking.id, vehicleId: resolvedVehicleId },
    });
    if (!bookingVehicle) {
      throw new AppError('Vehicle không thuộc booking này', 400, 'BOOKING_VEHICLE_MISMATCH');
    }
  } else {
    if (!body.byoc_vehicle_name?.trim()) {
      throw new AppError(
        'Đăng ký BYOC yêu cầu khai báo tên xe',
        400,
        'CONTEST_BYOC_DECLARATION_REQUIRED',
      );
    }
  }

  const saved = await AppDataSource.transaction(async (manager) => {
    const transactionalRepo = manager.getRepository(ContestRegistration);

    // Lock existing registrations for this contest to serialize concurrent registrations.
    const existing = await transactionalRepo
      .createQueryBuilder('registration')
      .setLock('pessimistic_write')
      .where('registration.contest_id = :contestId', { contestId })
      .andWhere('registration.user_id = :userId', { userId: viewer.userId })
      .getOne();

    if (existing && existing.status !== ContestRegistrationStatus.CANCELLED) {
      throw new AppError('Bạn đã đăng ký contest này rồi', 409, 'CONTEST_ALREADY_REGISTERED');
    }

    if (contest.capacity && contest.capacity > 0) {
      const lockedRegistrations = await manager.query(
        `SELECT id
         FROM contest_registrations
         WHERE contest_id = $1 AND status != $2
         FOR UPDATE`,
        [contestId, ContestRegistrationStatus.CANCELLED],
      );
      const activeCount = lockedRegistrations.length;
      if (activeCount >= contest.capacity) {
        throw new AppError('Contest đã đủ sức chứa', 409, 'CONTEST_CAPACITY_REACHED');
      }
    }

    const registration = existing ?? transactionalRepo.create();
    registration.contestId = contestId;
    registration.userId = viewer.userId;
    registration.participantRoleSnapshot = UserRole.CUSTOMER;
    registration.vehicleSource = body.vehicle_source;
    registration.vehicleId =
      body.vehicle_source === VehicleSource.RENTAL ? (resolvedVehicleId ?? null) : null;
    registration.bookingId =
      body.vehicle_source === VehicleSource.RENTAL ? (resolvedBookingId ?? null) : null;
    registration.customerVehicleId = null;
    registration.status = ContestRegistrationStatus.PENDING;
    registration.checkInCode = existing?.checkInCode ?? (await generateUniqueCheckInCode(manager));
    registration.entryFeeAmount = Number(contest.entryFee ?? 0);
    registration.entryFeeDueAt = contest.registrationClosesAt ?? contest.startsAt;
    registration.paymentStatus =
      Number(contest.entryFee ?? 0) > 0
        ? ContestEntryFeePaymentStatus.PENDING_PAYMENT
        : ContestEntryFeePaymentStatus.PENDING_REVIEW;
    registration.metadata = {
      ...(registration.metadata ?? {}),
      booking_id: resolvedBookingId ?? null,
      byoc_declaration:
        body.vehicle_source === VehicleSource.BYOC ? buildByocMetadata(body) : undefined,
    };

    return transactionalRepo.save(registration);
  });

  await writeContestAudit({
    contestId,
    registrationId: saved.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.created',
    afterJson: { status: saved.status, paymentStatus: saved.paymentStatus },
  });
  await sendContestRegistrationCreatedSideEffects(saved);

  const [mapped] = await mapContestRegistrationsPayload([saved], { includeContest: true });
  return mapped;
}

export async function listMyContestRegistrations(
  viewer: Viewer,
  query?: MyContestRegistrationsQuery,
) {
  const rows = await AppDataSource.getRepository(ContestRegistration).find({
    where: { userId: viewer.userId },
    order: { createdAt: 'DESC' },
  });
  const mapped = await mapContestRegistrationsPayload(rows, { includeContest: true });
  const normalizedQuery = query?.query?.toLowerCase();
  return mapped.filter((registration) => {
    const matchesQuery =
      !normalizedQuery ||
      registration.contest?.name?.toLowerCase().includes(normalizedQuery) ||
      registration.participant?.full_name?.toLowerCase().includes(normalizedQuery) ||
      registration.participant?.email?.toLowerCase().includes(normalizedQuery);
    const matchesContestStatus =
      !query?.contest_status || registration.contest?.status === query.contest_status;
    const matchesJourney =
      !query?.customer_journey_status ||
      registration.customer_journey_status === query.customer_journey_status;
    return matchesQuery && matchesContestStatus && matchesJourney;
  });
}

export async function listContestRegistrations(
  contestId: string,
  viewer: Viewer,
  query?: ContestRegistrationsQuery,
) {
  await assertContestProviderOrAssignedStaff(contestId, viewer);
  const rows = await AppDataSource.getRepository(ContestRegistration).find({
    where: { contestId },
    order: { createdAt: 'DESC' },
  });
  const mapped = await mapContestRegistrationsPayload(rows, { includeContest: false });
  const normalizedQuery = query?.query?.toLowerCase();
  return mapped.filter((registration) => {
    const matchesQuery =
      !normalizedQuery ||
      registration.participant?.full_name?.toLowerCase().includes(normalizedQuery) ||
      registration.participant?.email?.toLowerCase().includes(normalizedQuery) ||
      registration.check_in_code?.toLowerCase().includes(normalizedQuery);
    const matchesStatus = !query?.status || registration.status === query.status;
    const matchesPayment =
      !query?.payment_status || registration.payment_status === query.payment_status;
    return matchesQuery && matchesStatus && matchesPayment;
  });
}

async function getContestRegistrationForOwner(registrationId: string, viewer: Viewer) {
  const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
    where: { id: registrationId },
  });
  if (!registration)
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');
  await assertContestProviderOrAssignedStaff(registration.contestId, viewer);
  return registration;
}

export async function markEntryFeePaid(registrationId: string, viewer: Viewer, note?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.paymentStatus = ContestEntryFeePaymentStatus.MARKED_PAID;
  registration.entryFeeMarkedPaidBy = viewer.userId;
  registration.entryFeeMarkedPaidAt = new Date();
  registration.metadata = { ...(registration.metadata ?? {}), fee_note: note ?? null };
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.entry_fee_marked_paid',
    afterJson: { paymentStatus: registration.paymentStatus },
    reason: note ?? null,
  });
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function waiveEntryFee(registrationId: string, viewer: Viewer, note?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.paymentStatus = ContestEntryFeePaymentStatus.WAIVED;
  registration.entryFeeMarkedPaidBy = viewer.userId;
  registration.entryFeeMarkedPaidAt = new Date();
  registration.metadata = { ...(registration.metadata ?? {}), fee_note: note ?? null };
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.entry_fee_waived',
    afterJson: { paymentStatus: registration.paymentStatus },
    reason: note ?? null,
  });
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function approveRegistration(registrationId: string, viewer: Viewer, reason?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  if (
    ![
      ContestEntryFeePaymentStatus.NOT_REQUIRED,
      ContestEntryFeePaymentStatus.WAIVED,
      ContestEntryFeePaymentStatus.MARKED_PAID,
      ContestEntryFeePaymentStatus.PENDING_REVIEW,
    ].includes(registration.paymentStatus)
  ) {
    throw new AppError(
      'Registration chưa hoàn tất trạng thái phí tham gia',
      400,
      'ENTRY_FEE_PENDING',
    );
  }

  if (registration.vehicleSource === VehicleSource.RENTAL && registration.bookingId) {
    const booking = await AppDataSource.getRepository(Booking).findOne({
      where: { id: registration.bookingId },
    });
    if (!booking || booking.status !== BookingStatus.CONFIRMED) {
      throw new AppError(
        'Booking thuê xe phải được thanh toán (CONFIRMED) trước khi duyệt đăng ký',
        400,
        'BOOKING_NOT_CONFIRMED',
      );
    }
  }

  const contest = await getContestOrThrow(registration.contestId);
  if (![ContestStatus.OPEN, ContestStatus.CLOSED].includes(contest.status)) {
    throw new AppError(
      'Không thể duyệt registration khi contest không ở trạng thái OPEN hoặc CLOSED',
      400,
      'CONTEST_NOT_APPROVABLE',
    );
  }
  if (contest.providerId) {
    const activeBan = await getActiveContestBan(
      registration.userId,
      contest.providerId,
      contest.id,
    );
    if (activeBan) {
      throw new AppError(
        'Người tham gia đang bị ban khỏi contest này',
        409,
        'CONTEST_PARTICIPANT_BANNED',
      );
    }
  }
  if (contest.capacity && contest.capacity > 0) {
    const activeCount = await AppDataSource.getRepository(ContestRegistration).count({
      where: {
        contestId: contest.id,
        status: Not(ContestRegistrationStatus.CANCELLED),
      },
    });
    // Exclude the current registration from the active count because it is being approved now.
    const currentIncluded = registration.status !== ContestRegistrationStatus.CANCELLED ? 1 : 0;
    if (activeCount - currentIncluded >= contest.capacity) {
      throw new AppError('Contest đã đủ sức chứa', 409, 'CONTEST_CAPACITY_REACHED');
    }
  }
  registration.status = ContestRegistrationStatus.CONFIRMED;
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.approved',
    afterJson: { status: registration.status },
    reason: reason ?? null,
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_REGISTRATION_APPROVED,
    'Dang ky giai dau da duoc duyet',
    'Dang ky cua ban da duoc duyet. Ban hay theo doi thong bao de den check-in dung gio.',
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function rejectRegistration(registrationId: string, viewer: Viewer, reason?: string) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.status = ContestRegistrationStatus.CANCELLED;
  registration.cancelledBy = viewer.userId;
  registration.cancelledAt = new Date();
  registration.cancellationReason = reason ?? 'Rejected by provider';
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await removeRegistrationFromActiveMatches(registration.id);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.rejected',
    afterJson: { status: registration.status },
    reason: registration.cancellationReason,
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_REGISTRATION_REJECTED,
    'Dang ky giai dau bi tu choi',
    `Dang ky cua ban da bi tu choi.${registration.cancellationReason ? ` Ly do: ${registration.cancellationReason}` : ''}`,
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function cancelRegistration(registrationId: string, viewer: Viewer, reason?: string) {
  const repo = AppDataSource.getRepository(ContestRegistration);
  const registration = await repo.findOne({ where: { id: registrationId } });
  if (!registration)
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');

  if (viewer.role === UserRole.CUSTOMER) {
    if (registration.userId !== viewer.userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
  } else {
    await assertContestProviderOrAssignedStaff(registration.contestId, viewer);
  }

  registration.status = ContestRegistrationStatus.CANCELLED;
  registration.cancelledBy = viewer.userId;
  registration.cancelledAt = new Date();
  registration.cancellationReason = reason ?? 'Cancelled';
  await repo.save(registration);
  await removeRegistrationFromActiveMatches(registration.id);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.cancelled',
    afterJson: { status: registration.status },
    reason: registration.cancellationReason,
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_REGISTRATION_CANCELLED,
    'Dang ky giai dau da duoc huy',
    `Dang ky cua ban da duoc huy.${registration.cancellationReason ? ` Ly do: ${registration.cancellationReason}` : ''}`,
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

export async function lookupRegistrationByCode(
  contestId: string,
  checkInCode: string,
  viewer: Viewer,
) {
  const contest = await getContestOrThrow(contestId);
  if (viewer.role === UserRole.PROVIDER) {
    await assertContestProviderOrAssignedStaff(contestId, viewer);
  } else if (viewer.role === UserRole.STAFF) {
    const assigned = await isStaffAssignedToContest(contestId, viewer.userId);
    if (!assigned) {
      throw new AppError('Staff không thuộc chi nhánh tham gia contest', 403, 'FORBIDDEN');
    }
  } else {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }

  const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
    where: { contestId: contest.id, checkInCode },
  });
  if (!registration)
    throw new AppError('Không tìm thấy registration', 404, 'REGISTRATION_NOT_FOUND');
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: true });
  return mapped;
}

export async function checkInRegistration(
  registrationId: string,
  checkedInCafeId: string,
  viewer: Viewer,
) {
  const repo = AppDataSource.getRepository(ContestRegistration);
  const registration = await repo.findOne({ where: { id: registrationId } });
  if (!registration)
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');
  const contest = await getContestOrThrow(registration.contestId);

  if (registration.status !== ContestRegistrationStatus.CONFIRMED) {
    throw new AppError(
      'Registration phải ở trạng thái CONFIRMED',
      400,
      'REGISTRATION_NOT_CONFIRMED',
    );
  }
  if (
    Number(contest.entryFee ?? 0) > 0 &&
    ![
      ContestEntryFeePaymentStatus.MARKED_PAID,
      ContestEntryFeePaymentStatus.WAIVED,
      ContestEntryFeePaymentStatus.PENDING_REVIEW,
    ].includes(registration.paymentStatus)
  ) {
    throw new AppError('Registration vẫn đang chờ xử lý phí tham gia', 400, 'ENTRY_FEE_PENDING');
  }

  if (![ContestStatus.CLOSED, ContestStatus.RUNNING].includes(contest.status)) {
    throw new AppError(
      'Check-in chỉ được thực hiện khi contest ở trạng thái CLOSED hoặc RUNNING',
      400,
      'CONTEST_NOT_CHECKIN_READY',
    );
  }
  const now = new Date();
  if (contest.startsAt && now < contest.startsAt) {
    throw new AppError('Chưa tới giờ check-in của contest', 400, 'CONTEST_CHECKIN_NOT_STARTED');
  }
  if (contest.endsAt && now > contest.endsAt) {
    throw new AppError('Contest đã kết thúc, không thể check-in', 400, 'CONTEST_CHECKIN_ENDED');
  }

  const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
    where: { contestId: contest.id, cafeId: checkedInCafeId },
  });
  if (!contestCafe) {
    throw new AppError('Cafe check-in không thuộc contest', 400, 'CONTEST_CHECKIN_CAFE_INVALID');
  }

  if (viewer.role === UserRole.PROVIDER) {
    await assertContestProviderOrAssignedStaff(contest.id, viewer);
  } else if (viewer.role === UserRole.STAFF) {
    const assignedToContest = await isStaffAssignedToContest(contest.id, viewer.userId);
    const assignedToCafe = await isStaffAssignedToCafe(viewer.userId, checkedInCafeId);
    if (!assignedToContest || !assignedToCafe) {
      throw new AppError('Staff không được check-in ở chi nhánh này', 403, 'FORBIDDEN');
    }
  } else {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }

  if (contest.providerId) {
    const activeBan = await getActiveContestBan(
      registration.userId,
      contest.providerId,
      contest.id,
    );
    if (activeBan) {
      throw new AppError(
        'Người tham gia đang bị chặn thi đấu ở contest này',
        403,
        'CONTEST_PARTICIPANT_BANNED',
      );
    }
  }

  registration.status = ContestRegistrationStatus.CHECKED_IN;
  registration.checkedInCafeId = checkedInCafeId;
  registration.checkedInBy = viewer.userId;
  registration.checkedInAt = new Date();
  await repo.save(registration);
  await writeContestAudit({
    contestId: contest.id,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.checked_in',
    afterJson: { status: registration.status, checkedInCafeId },
  });
  await sendContestRegistrationStatusNotification(
    registration,
    NotificationType.CONTEST_CHECKIN_CONFIRMED,
    'Check-in giai dau thanh cong',
    'Ban da check-in thanh cong. He thong se cap nhat bracket va luot thi tiep theo cho ban.',
  );
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: true });
  return mapped;
}

export async function listContestStaffAssignments(contestId: string, viewer: Viewer) {
  await assertContestProviderOrAssignedStaff(contestId, viewer);
  const contest = await getContestOrThrow(contestId);
  const [payload] = await mapContestPayload([contest]);
  return payload.staff_assignments ?? [];
}

export async function assignContestStaff(contestId: string, staffId: string, viewer: Viewer) {
  assertProviderViewer(viewer);
  await assertContestOwner(contestId, viewer);
  const staff = await AppDataSource.getRepository(User).findOne({
    where: { id: staffId, role: UserRole.STAFF, is_active: true },
  });
  if (!staff) throw new AppError('Staff không tồn tại', 404, 'STAFF_NOT_FOUND');
  const assignmentRepo = AppDataSource.getRepository(ContestStaffAssignment);
  const existing = await assignmentRepo.findOne({ where: { contestId, staffId } });
  if (!existing) {
    await assignmentRepo.save(
      assignmentRepo.create({
        contestId,
        staffId,
        assignedBy: viewer.userId,
      }),
    );
  }
  await writeContestAudit({
    contestId,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.staff_assigned',
    afterJson: { staff_id: staffId },
  });
  return listContestStaffAssignments(contestId, viewer);
}

export async function unassignContestStaff(contestId: string, staffId: string, viewer: Viewer) {
  assertProviderViewer(viewer);
  await assertContestOwner(contestId, viewer);
  await AppDataSource.getRepository(ContestStaffAssignment).delete({ contestId, staffId });
  await writeContestAudit({
    contestId,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.staff_unassigned',
    afterJson: { staff_id: staffId },
  });
  return listContestStaffAssignments(contestId, viewer);
}

export async function createContestEntryPaymentUrl(
  registrationId: string,
  viewer: Viewer,
  ipAddr: string,
  returnUrl?: string,
) {
  if (viewer.role !== UserRole.CUSTOMER) {
    throw new AppError('Chỉ customer mới được tạo thanh toán entry fee', 403, 'FORBIDDEN');
  }
  const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
    where: { id: registrationId, userId: viewer.userId },
  });
  if (!registration) {
    throw new AppError('Registration không tồn tại', 404, 'REGISTRATION_NOT_FOUND');
  }
  const contest = await getContestOrThrow(registration.contestId);
  if (Number(registration.entryFeeAmount ?? 0) <= 0) {
    throw new AppError('Contest này không yêu cầu entry fee', 400, 'ENTRY_FEE_NOT_REQUIRED');
  }
  if (
    [ContestEntryFeePaymentStatus.MARKED_PAID, ContestEntryFeePaymentStatus.WAIVED].includes(
      registration.paymentStatus,
    )
  ) {
    throw new AppError('Entry fee đã được xử lý', 409, 'ENTRY_FEE_ALREADY_SETTLED');
  }

  const existingTxn = await AppDataSource.getRepository(PaymentTransaction).findOne({
    where: {
      contestRegistrationId: registration.id,
      subjectType: PaymentTransactionSubjectType.CONTEST_ENTRY,
      type: PaymentTransactionType.PAYMENT,
      status: PaymentTransactionStatus.PENDING,
    },
    order: { createdAt: 'DESC' },
  });
  if (existingTxn) {
    throw new AppError(
      'Một giao dịch entry fee đang chờ xử lý; vui lòng hoàn tất hoặc hủy trước khi tạo mới',
      409,
      'ENTRY_FEE_TRANSACTION_PENDING',
    );
  }

  const txnRef = `contest_${registration.id.replace(/-/g, '').slice(0, 18)}_${Date.now().toString().slice(-4)}`;
  const paymentUrl = createPaymentUrl({
    amount: Number(registration.entryFeeAmount),
    txnRef,
    orderInfo: `Contest entry ${contest.name.slice(0, 40)}`,
    ipAddr,
    returnUrl,
    bankCode: 'VNBANK',
  });

  await AppDataSource.getRepository(PaymentTransaction).save(
    AppDataSource.getRepository(PaymentTransaction).create({
      bookingId: null,
      customerPackageId: null,
      contestRegistrationId: registration.id,
      subjectType: PaymentTransactionSubjectType.CONTEST_ENTRY,
      type: PaymentTransactionType.PAYMENT,
      gateway: env.vnpay.mockEnabled ? 'MOCK' : 'VNPAY',
      txnRef,
      amount: Number(registration.entryFeeAmount),
      status: PaymentTransactionStatus.PENDING,
      rawRequest: {
        registrationId: registration.id,
        contestId: contest.id,
        returnUrl: returnUrl ?? null,
      },
    }),
  );

  if (env.vnpay.mockEnabled) {
    await processMockConfirmation(txnRef);
    const target = new URL('/payment/result', env.frontendUrl);
    target.searchParams.set('status', 'success');
    target.searchParams.set('txn_ref', txnRef);
    target.searchParams.set('mock', '1');
    return {
      payment_url: target.toString(),
      txn_ref: txnRef,
      amount: Number(registration.entryFeeAmount),
    };
  }

  return {
    payment_url: paymentUrl,
    txn_ref: txnRef,
    amount: Number(registration.entryFeeAmount),
  };
}

export async function listContestBans(contestId: string, viewer: Viewer) {
  const contest = await assertContestProviderOrAssignedStaff(contestId, viewer);
  const rows = await AppDataSource.getRepository(ContestBan).find({
    where: { providerId: contest.providerId ?? undefined },
    order: { createdAt: 'DESC' },
  });
  return rows.filter((item) => item.contestId === contestId || item.contestId === null);
}

export async function createContestBan(contestId: string, viewer: Viewer, body: ContestBanPayload) {
  const contest = await assertContestProviderOrAssignedStaff(contestId, viewer);
  const providerId = await resolveContestProviderIdForViewer(viewer, contest);

  const targetUser = await AppDataSource.getRepository(User).findOne({
    where: { id: body.user_id, role: UserRole.CUSTOMER },
  });
  if (!targetUser) {
    throw new AppError(
      'Người dùng không tồn tại hoặc không phải customer',
      400,
      'BAN_TARGET_INVALID',
    );
  }

  const repo = AppDataSource.getRepository(ContestBan);
  const ban = await repo.save(
    repo.create({
      providerId,
      contestId: body.scope_type === ContestBanScopeType.CONTEST ? contestId : null,
      userId: body.user_id,
      scopeType: body.scope_type,
      reason: body.reason,
      evidence: body.evidence ?? {},
      createdBy: viewer.userId,
      expiresAt: body.expires_at ?? null,
    }),
  );
  await writeContestAudit({
    contestId,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.participant_banned',
    afterJson: { ban_id: ban.id, user_id: body.user_id, scope_type: body.scope_type },
    reason: body.reason,
  });
  return ban;
}

export async function liftContestBan(
  contestId: string,
  banId: string,
  viewer: Viewer,
  reason?: string,
) {
  const contest = await assertContestProviderOrAssignedStaff(contestId, viewer);
  const repo = AppDataSource.getRepository(ContestBan);
  const ban = await repo.findOne({
    where: {
      id: banId,
      providerId: contest.providerId ?? undefined,
    },
  });
  if (!ban) throw new AppError('Ban không tồn tại', 404, 'CONTEST_BAN_NOT_FOUND');
  ban.liftedAt = new Date();
  ban.liftedBy = viewer.userId;
  ban.liftReason = reason ?? null;
  await repo.save(ban);
  await writeContestAudit({
    contestId: contest.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'contest.participant_unbanned',
    afterJson: { ban_id: ban.id, user_id: ban.userId },
    reason: reason ?? null,
  });
  return ban;
}

export async function disqualifyRegistration(
  registrationId: string,
  viewer: Viewer,
  reason?: string,
) {
  const registration = await getContestRegistrationForOwner(registrationId, viewer);
  registration.status = ContestRegistrationStatus.CANCELLED;
  registration.cancelledBy = viewer.userId;
  registration.cancelledAt = new Date();
  registration.cancellationReason = reason ?? 'Disqualified';
  registration.metadata = {
    ...(registration.metadata ?? {}),
    disqualified: true,
    disqualified_at: new Date().toISOString(),
  };
  await AppDataSource.getRepository(ContestRegistration).save(registration);
  await removeRegistrationFromActiveMatches(registration.id);
  await writeContestAudit({
    contestId: registration.contestId,
    registrationId: registration.id,
    actorId: viewer.userId,
    actorRole: viewer.role,
    eventType: 'registration.disqualified',
    afterJson: { status: registration.status },
    reason: registration.cancellationReason,
  });
  const [mapped] = await mapContestRegistrationsPayload([registration], { includeContest: false });
  return mapped;
}

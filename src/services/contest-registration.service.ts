import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Contest } from '../models/contest.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import {
  AppError,
  ContestRegistrationStatus,
  ContestStatus,
  UserRole,
  VehicleSource,
} from '../types';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface RegisterContestBody {
  vehicle_source: VehicleSource;
  vehicle_id?: string | null;
  customer_vehicle_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CheckInRegistrationBody {
  cafe_id: string;
}

export interface CancelRegistrationBody {
  reason?: string;
}

interface RegistrationDto {
  id: string;
  contest_id: string;
  user_id: string;
  participant_role_snapshot: UserRole;
  vehicle_source: VehicleSource;
  vehicle_id: string | null;
  customer_vehicle_id: string | null;
  status: ContestRegistrationStatus;
  check_in_code: string;
  checked_in_cafe_id: string | null;
  checked_in_by: string | null;
  checked_in_at: Date | null;
  cancelled_by: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const ACTIVE_REGISTRATION_STATUSES = [
  ContestRegistrationStatus.PENDING,
  ContestRegistrationStatus.CONFIRMED,
  ContestRegistrationStatus.CHECKED_IN,
];

function toRegistrationDto(registration: ContestRegistration): RegistrationDto {
  return {
    id: registration.id,
    contest_id: registration.contestId,
    user_id: registration.userId,
    participant_role_snapshot: registration.participantRoleSnapshot,
    vehicle_source: registration.vehicleSource,
    vehicle_id: registration.vehicleId,
    customer_vehicle_id: registration.customerVehicleId,
    status: registration.status,
    check_in_code: registration.checkInCode,
    checked_in_cafe_id: registration.checkedInCafeId,
    checked_in_by: registration.checkedInBy,
    checked_in_at: registration.checkedInAt,
    cancelled_by: registration.cancelledBy,
    cancelled_at: registration.cancelledAt,
    cancellation_reason: registration.cancellationReason,
    metadata: registration.metadata,
    created_at: registration.createdAt,
    updated_at: registration.updatedAt,
  };
}

async function getContestOrThrow(manager: EntityManager, contestId: string): Promise<Contest> {
  const contest = await manager.getRepository(Contest).findOne({ where: { id: contestId } });
  if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');
  return contest;
}

async function getRegistrationOrThrow(
  manager: EntityManager,
  registrationId: string,
): Promise<ContestRegistration> {
  const registration = await manager
    .getRepository(ContestRegistration)
    .findOne({ where: { id: registrationId } });
  if (!registration) {
    throw new AppError('Registration không tồn tại', 404, 'CONTEST_REGISTRATION_NOT_FOUND');
  }
  return registration;
}

function assertRegistrationWindow(contest: Contest): void {
  const now = new Date();
  if (contest.status !== ContestStatus.OPEN) {
    throw new AppError('Contest chưa mở đăng ký', 409, 'CONTEST_NOT_OPEN');
  }
  if (contest.registrationOpensAt > now || contest.registrationClosesAt < now) {
    throw new AppError('Contest đang ngoài thời gian đăng ký', 409, 'CONTEST_REGISTRATION_CLOSED');
  }
}

async function countActiveRegistrations(
  manager: EntityManager,
  contestId: string,
): Promise<number> {
  return manager
    .getRepository(ContestRegistration)
    .createQueryBuilder('registration')
    .where('registration.contestId = :contestId', { contestId })
    .andWhere('registration.status IN (:...statuses)', { statuses: ACTIVE_REGISTRATION_STATUSES })
    .getCount();
}

async function assertParticipatingCafe(
  manager: EntityManager,
  contestId: string,
  cafeId: string,
): Promise<void> {
  const contestCafe = await manager.getRepository(ContestCafe).findOne({
    where: { contestId, cafeId, checkInEnabled: true },
  });
  if (!contestCafe) {
    throw new AppError(
      'Cafe check-in không nằm trong danh sách chi nhánh tham gia contest',
      403,
      'CONTEST_CHECK_IN_CAFE_INVALID',
    );
  }
}

async function assertStaffAssignedToCafe(staffId: string, cafeId: string): Promise<void> {
  const rows = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM staff_cafe_assignments WHERE staff_id = $1 AND cafe_id = $2 LIMIT 1`,
    [staffId, cafeId],
  );
  if (rows.length === 0) {
    throw new AppError('Staff không được phân công tại chi nhánh này', 403, 'STAFF_CAFE_FORBIDDEN');
  }
}

function assertContestOwner(contest: Contest, providerId: string): void {
  if (contest.providerId !== providerId) {
    throw new AppError('Bạn không có quyền thao tác contest này', 403, 'CONTEST_FORBIDDEN');
  }
}

export async function registerContest(
  contestId: string,
  viewer: Viewer,
  body: RegisterContestBody,
): Promise<RegistrationDto> {
  if (![UserRole.CUSTOMER, UserRole.PROVIDER].includes(viewer.role)) {
    throw new AppError(
      'Role hiện tại không được đăng ký contest',
      403,
      'CONTEST_REGISTER_FORBIDDEN',
    );
  }

  return AppDataSource.transaction(async (manager) => {
    const contest = await manager
      .getRepository(Contest)
      .createQueryBuilder('contest')
      .setLock('pessimistic_write')
      .where('contest.id = :contestId', { contestId })
      .getOne();
    if (!contest) throw new AppError('Contest không tồn tại', 404, 'CONTEST_NOT_FOUND');

    assertRegistrationWindow(contest);
    if (viewer.role === UserRole.PROVIDER && contest.providerId === viewer.userId) {
      throw new AppError(
        'Provider không được tự đăng ký contest do mình tạo',
        403,
        'CONTEST_SELF_REGISTRATION_FORBIDDEN',
      );
    }

    const existing = await manager.getRepository(ContestRegistration).findOne({
      where: { contestId, userId: viewer.userId },
    });
    if (existing) {
      throw new AppError('Bạn đã đăng ký contest này', 409, 'CONTEST_REGISTRATION_EXISTS');
    }

    const activeCount = await countActiveRegistrations(manager, contestId);
    if (activeCount >= contest.capacity) {
      throw new AppError('Contest đã đủ số lượng đăng ký', 409, 'CONTEST_CAPACITY_FULL');
    }

    const registration = manager.getRepository(ContestRegistration).create({
      contestId,
      userId: viewer.userId,
      participantRoleSnapshot: viewer.role,
      vehicleSource: body.vehicle_source,
      vehicleId: body.vehicle_id ?? null,
      customerVehicleId: body.customer_vehicle_id ?? null,
      status: ContestRegistrationStatus.CONFIRMED,
      checkInCode: randomUUID(),
      metadata: body.metadata ?? {},
    });

    return toRegistrationDto(await manager.getRepository(ContestRegistration).save(registration));
  });
}

export async function listContestRegistrations(
  contestId: string,
  providerId: string,
): Promise<RegistrationDto[]> {
  const contest = await getContestOrThrow(AppDataSource.manager, contestId);
  assertContestOwner(contest, providerId);

  const registrations = await AppDataSource.getRepository(ContestRegistration).find({
    where: { contestId },
    order: { createdAt: 'ASC' },
  });
  return registrations.map(toRegistrationDto);
}

export async function checkInRegistration(
  registrationId: string,
  viewer: Viewer,
  body: CheckInRegistrationBody,
): Promise<RegistrationDto> {
  if (![UserRole.PROVIDER, UserRole.STAFF].includes(viewer.role)) {
    throw new AppError(
      'Role hiện tại không được check-in contest',
      403,
      'CONTEST_CHECK_IN_FORBIDDEN',
    );
  }

  return AppDataSource.transaction(async (manager) => {
    const registration = await getRegistrationOrThrow(manager, registrationId);
    const contest = await getContestOrThrow(manager, registration.contestId);

    if (viewer.role === UserRole.PROVIDER) {
      assertContestOwner(contest, viewer.userId);
    } else {
      await assertStaffAssignedToCafe(viewer.userId, body.cafe_id);
    }

    await assertParticipatingCafe(manager, contest.id, body.cafe_id);

    if (registration.status !== ContestRegistrationStatus.CONFIRMED) {
      throw new AppError(
        'Chỉ registration CONFIRMED mới được check-in',
        409,
        'CONTEST_REGISTRATION_STATUS_INVALID',
      );
    }

    registration.status = ContestRegistrationStatus.CHECKED_IN;
    registration.checkedInCafeId = body.cafe_id;
    registration.checkedInBy = viewer.userId;
    registration.checkedInAt = new Date();

    return toRegistrationDto(await manager.getRepository(ContestRegistration).save(registration));
  });
}

export async function cancelRegistration(
  registrationId: string,
  viewer: Viewer,
  body: CancelRegistrationBody,
): Promise<RegistrationDto> {
  return AppDataSource.transaction(async (manager) => {
    const registration = await getRegistrationOrThrow(manager, registrationId);
    const contest = await getContestOrThrow(manager, registration.contestId);
    const isParticipant = registration.userId === viewer.userId;
    const isOwner = viewer.role === UserRole.PROVIDER && contest.providerId === viewer.userId;

    if (!isParticipant && !isOwner) {
      throw new AppError('Bạn không có quyền hủy registration này', 403, 'CONTEST_FORBIDDEN');
    }
    if (registration.status === ContestRegistrationStatus.CANCELLED) {
      throw new AppError(
        'Registration đã bị hủy trước đó',
        409,
        'CONTEST_REGISTRATION_STATUS_INVALID',
      );
    }

    registration.status = ContestRegistrationStatus.CANCELLED;
    registration.cancelledBy = viewer.userId;
    registration.cancelledAt = new Date();
    registration.cancellationReason = body.reason ?? null;

    return toRegistrationDto(await manager.getRepository(ContestRegistration).save(registration));
  });
}

import { randomUUID } from 'crypto';
import { EntityManager, In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Contest } from '../models/contest.entity';
import { ContestCafe } from '../models/contest-cafe.entity';
import { ContestRegistration } from '../models/contest-registration.entity';
import { CustomerVehicle } from '../models/customer-vehicle.entity';
import { Vehicle } from '../models/vehicle.entity';
import { Booking } from '../models/booking.entity';
import { BookingVehicle } from '../models/booking-vehicle.entity';
import { writeContestAudit } from './contest-audit.service';
import { User } from '../models/user.entity';
import {
  AppError,
  ContestRegistrationStatus,
  ContestStatus,
  UserRole,
  VehicleSource,
  VehicleStatus,
  BookingStatus,
} from '../types';

interface Viewer {
  userId: string;
  role: UserRole;
}

export interface RegisterContestBody {
  vehicle_source: VehicleSource;
  vehicle_id?: string | null;
  customer_vehicle_id?: string | null;
  booking_id?: string | null;
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
  booking_id: string | null;
  status: ContestRegistrationStatus;
  check_in_code: string;
  checked_in_cafe_id: string | null;
  checked_in_by: string | null;
  checked_in_at: Date | null;
  cancelled_by: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  metadata: Record<string, unknown>;
  user?: {
    id: string;
    fullName: string;
    email: string;
    avatarUrl: string | null;
  };
  created_at: Date;
  updated_at: Date;
}

const ACTIVE_REGISTRATION_STATUSES = [
  ContestRegistrationStatus.PENDING,
  ContestRegistrationStatus.CONFIRMED,
  ContestRegistrationStatus.CHECKED_IN,
];

function toRegistrationDto(
  registration: ContestRegistration,
  user?: Pick<User, 'id' | 'full_name' | 'email' | 'avatar_url'>,
): RegistrationDto {
  return {
    id: registration.id,
    contest_id: registration.contestId,
    user_id: registration.userId,
    participant_role_snapshot: registration.participantRoleSnapshot,
    vehicle_source: registration.vehicleSource,
    vehicle_id: registration.vehicleId,
    customer_vehicle_id: registration.customerVehicleId,
    booking_id: registration.bookingId,
    status: registration.status,
    check_in_code: registration.checkInCode,
    checked_in_cafe_id: registration.checkedInCafeId,
    checked_in_by: registration.checkedInBy,
    checked_in_at: registration.checkedInAt,
    cancelled_by: registration.cancelledBy,
    cancelled_at: registration.cancelledAt,
    cancellation_reason: registration.cancellationReason,
    metadata: registration.metadata,
    user: user
      ? {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          avatarUrl: user.avatar_url,
        }
      : undefined,
    created_at: registration.createdAt,
    updated_at: registration.updatedAt,
  };
}

async function getRegistrationUsers(
  manager: EntityManager,
  registrations: ContestRegistration[],
): Promise<Map<string, Pick<User, 'id' | 'full_name' | 'email' | 'avatar_url'>>> {
  const userIds = Array.from(new Set(registrations.map((registration) => registration.userId)));
  if (userIds.length === 0) return new Map();
  const users = await manager.getRepository(User).find({
    where: { id: In(userIds) },
    select: ['id', 'full_name', 'email', 'avatar_url'],
  });
  return new Map(users.map((user) => [user.id, user]));
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

async function assertStaffAssignedToAnyContestCafe(
  manager: EntityManager,
  staffId: string,
  contestId: string,
): Promise<void> {
  const row = await manager
    .getRepository(ContestCafe)
    .createQueryBuilder('contestCafe')
    .innerJoin(
      'staff_cafe_assignments',
      'assignment',
      'assignment.cafe_id = contestCafe.cafeId AND assignment.staff_id = :staffId',
      { staffId },
    )
    .where('contestCafe.contestId = :contestId', { contestId })
    .getOne();

  if (!row) {
    throw new AppError(
      'Staff không thuộc chi nhánh tham gia contest',
      403,
      'CONTEST_OPERATOR_FORBIDDEN',
    );
  }
}

function assertContestOwner(contest: Contest, providerId: string): void {
  if (contest.providerId !== providerId) {
    throw new AppError('Bạn không có quyền thao tác contest này', 403, 'CONTEST_FORBIDDEN');
  }
}
async function assertNoDuplicateRentalVehicleRegistration(
  manager: EntityManager,
  contestId: string,
  vehicleId: string,
  excludeRegistrationId?: string,
): Promise<void> {
  const qb = manager
    .getRepository(ContestRegistration)
    .createQueryBuilder('registration')
    .where('registration.contestId = :contestId', { contestId })
    .andWhere('registration.vehicleId = :vehicleId', { vehicleId })
    .andWhere('registration.status IN (:...statuses)', { statuses: ACTIVE_REGISTRATION_STATUSES });

  if (excludeRegistrationId) {
    qb.andWhere('registration.id != :excludeRegistrationId', { excludeRegistrationId });
  }

  const activeVehicleReg = await qb.getOne();
  if (activeVehicleReg) {
    throw new AppError(
      'Phuong tien thue nay da duoc dang ky trong giai dau',
      409,
      'CONTEST_VEHICLE_ALREADY_REGISTERED',
    );
  }
}

async function validateLegacyRentalVehicle(
  manager: EntityManager,
  contest: Contest,
  vehicleId: string,
): Promise<string> {
  const vehicle = await manager.getRepository(Vehicle).findOne({
    where: { id: vehicleId },
    relations: ['catalog'],
  });
  if (!vehicle) {
    throw new AppError('Phuong tien thue khong ton tai', 404, 'VEHICLE_NOT_FOUND');
  }
  if (vehicle.status !== VehicleStatus.AVAILABLE) {
    throw new AppError('Phuong tien thue hien tai khong san sang', 400, 'VEHICLE_NOT_AVAILABLE');
  }

  const contestCafe = await manager.getRepository(ContestCafe).findOne({
    where: { contestId: contest.id, cafeId: vehicle.cafeId },
  });
  if (!contestCafe) {
    throw new AppError(
      'Phuong tien thue phai thuoc chi nhanh tham gia giai dau nay',
      400,
      'CONTEST_VEHICLE_CAFE_INVALID',
    );
  }

  const compatibleTrackTypes = vehicle.catalog?.compatibleTrackTypes ?? [];
  if (compatibleTrackTypes.length > 0 && !compatibleTrackTypes.includes(contest.trackTypeId)) {
    throw new AppError(
      'Phuong tien thue khong tuong thich voi duong dua cua contest',
      400,
      'CONTEST_VEHICLE_TRACK_INCOMPATIBLE',
    );
  }

  return vehicle.id;
}

async function validateRentalBookingLink(
  manager: EntityManager,
  contest: Contest,
  userId: string,
  bookingId: string,
  requestedVehicleId?: string | null,
): Promise<string> {
  const booking = await manager.getRepository(Booking).findOne({
    where: { id: bookingId, customerId: userId },
  });
  if (!booking) {
    throw new AppError('Booking thue xe khong ton tai', 404, 'CONTEST_RENTAL_BOOKING_NOT_FOUND');
  }
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new AppError(
      'Booking thue xe phai thanh toan/xac nhan truoc khi dang ky contest',
      400,
      'CONTEST_RENTAL_BOOKING_NOT_CONFIRMED',
    );
  }
  if (booking.trackTypeId !== contest.trackTypeId) {
    throw new AppError(
      'Booking thue xe khong dung loai duong dua cua contest',
      400,
      'CONTEST_RENTAL_BOOKING_TRACK_INVALID',
    );
  }
  if (booking.slotStart > contest.startsAt || booking.slotEnd < contest.endsAt) {
    throw new AppError(
      'Booking thue xe phai bao phu thoi gian dien ra contest',
      400,
      'CONTEST_RENTAL_BOOKING_TIME_INVALID',
    );
  }

  const contestCafe = await manager.getRepository(ContestCafe).findOne({
    where: { contestId: contest.id, cafeId: booking.cafeId },
  });
  if (!contestCafe) {
    throw new AppError(
      'Booking thue xe phai thuoc chi nhanh tham gia giai dau nay',
      400,
      'CONTEST_RENTAL_BOOKING_CAFE_INVALID',
    );
  }

  const bookingVehicles = await manager.getRepository(BookingVehicle).find({
    where: { bookingId: booking.id },
    order: { createdAt: 'ASC' },
  });
  if (bookingVehicles.length === 0) {
    throw new AppError(
      'Booking thue xe chua co xe rental',
      400,
      'CONTEST_RENTAL_BOOKING_VEHICLE_REQUIRED',
    );
  }

  if (
    requestedVehicleId &&
    !bookingVehicles.some((vehicle) => vehicle.vehicleId === requestedVehicleId)
  ) {
    throw new AppError(
      'vehicle_id khong thuoc booking thue xe da chon',
      400,
      'CONTEST_RENTAL_BOOKING_VEHICLE_INVALID',
    );
  }

  return requestedVehicleId ?? bookingVehicles[0].vehicleId;
}

async function revalidateRentalRegistration(
  manager: EntityManager,
  contest: Contest,
  registration: ContestRegistration,
): Promise<void> {
  if (registration.vehicleSource !== VehicleSource.RENTAL) return;

  const resolvedVehicleId = registration.bookingId
    ? await validateRentalBookingLink(
        manager,
        contest,
        registration.userId,
        registration.bookingId,
        registration.vehicleId,
      )
    : registration.vehicleId
      ? await validateLegacyRentalVehicle(manager, contest, registration.vehicleId)
      : null;

  if (!resolvedVehicleId) {
    throw new AppError(
      'Dang ky xe thue khong day du thong tin booking/vehicle',
      400,
      'CONTEST_RENTAL_BOOKING_VEHICLE_REQUIRED',
    );
  }

  await assertNoDuplicateRentalVehicleRegistration(
    manager,
    contest.id,
    resolvedVehicleId,
    registration.id,
  );
  registration.vehicleId = resolvedVehicleId;
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

    // Enforce Contest Vehicle Policy rules
    const policy = (contest.vehicleRule as Record<string, unknown>)?.vehicle_policy || 'MIXED';
    if (policy === 'RENTAL_ONLY' && body.vehicle_source !== VehicleSource.RENTAL) {
      throw new AppError(
        'Giải đấu này chỉ cho phép sử dụng xe thuê của chi nhánh',
        400,
        'CONTEST_VEHICLE_POLICY_VIOLATED',
      );
    }
    if (policy === 'BYOC_ONLY' && body.vehicle_source !== VehicleSource.BYOC) {
      throw new AppError(
        'Giải đấu này bắt buộc người chơi tự mang xe (BYOC)',
        400,
        'CONTEST_VEHICLE_POLICY_VIOLATED',
      );
    }

    // Validate selected vehicle source. Rental can link to the normal booking flow; BYOC is reviewed per registration.
    let resolvedRentalVehicleId = body.vehicle_id ?? null;
    if (body.vehicle_source === VehicleSource.BYOC) {
      if (!body.customer_vehicle_id) {
        throw new AppError(
          'Dang ky BYOC bat buoc customer_vehicle_id',
          400,
          'CUSTOMER_VEHICLE_REQUIRED',
        );
      }
      const customerVehicle = await manager.getRepository(CustomerVehicle).findOne({
        where: { id: body.customer_vehicle_id, customerId: viewer.userId },
      });
      if (!customerVehicle) {
        throw new AppError(
          'Phuong tien ca nhan khong ton tai hoac khong thuoc so huu cua ban',
          404,
          'CUSTOMER_VEHICLE_NOT_FOUND',
        );
      }

      const activeCustomerVehicleReg = await manager.getRepository(ContestRegistration).findOne({
        where: {
          contestId,
          customerVehicleId: body.customer_vehicle_id,
          status: In(ACTIVE_REGISTRATION_STATUSES),
        },
      });
      if (activeCustomerVehicleReg) {
        throw new AppError(
          'Phuong tien ca nhan nay da duoc dang ky trong giai dau',
          409,
          'CONTEST_VEHICLE_ALREADY_REGISTERED',
        );
      }
    } else if (body.booking_id) {
      resolvedRentalVehicleId = await validateRentalBookingLink(
        manager,
        contest,
        viewer.userId,
        body.booking_id,
        body.vehicle_id,
      );
    } else {
      if (!body.vehicle_id) {
        throw new AppError('Dang ky xe thue bat buoc vehicle_id', 400, 'RENTAL_VEHICLE_REQUIRED');
      }
      resolvedRentalVehicleId = await validateLegacyRentalVehicle(
        manager,
        contest,
        body.vehicle_id,
      );
    }

    if (resolvedRentalVehicleId) {
      await assertNoDuplicateRentalVehicleRegistration(manager, contestId, resolvedRentalVehicleId);
    }
    const registration = manager.getRepository(ContestRegistration).create({
      contestId,
      userId: viewer.userId,
      participantRoleSnapshot: viewer.role,
      vehicleSource: body.vehicle_source,
      vehicleId: resolvedRentalVehicleId,
      customerVehicleId: body.customer_vehicle_id ?? null,
      bookingId: body.booking_id ?? null,
      status: ContestRegistrationStatus.PENDING, // Default all new registrations to PENDING
      checkInCode: randomUUID(),
      metadata: body.metadata ?? {},
    });

    const saved = await manager.getRepository(ContestRegistration).save(registration);
    await writeContestAudit(manager, {
      contestId,
      registrationId: saved.id,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'registration.created',
      afterJson: {
        user_id: viewer.userId,
        participant_role: viewer.role,
        vehicle_source: saved.vehicleSource,
        status: saved.status,
      },
      metadata: { active_count_before_create: activeCount },
    });
    return toRegistrationDto(saved);
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
  const userMap = await getRegistrationUsers(AppDataSource.manager, registrations);
  return registrations.map((registration) =>
    toRegistrationDto(registration, userMap.get(registration.userId)),
  );
}

export async function listMyContestRegistrations(
  viewer: Viewer,
  contestId?: string,
): Promise<RegistrationDto[]> {
  if (![UserRole.CUSTOMER, UserRole.PROVIDER].includes(viewer.role)) {
    throw new AppError(
      'Role hiện tại không có registration contest',
      403,
      'CONTEST_REGISTRATION_FORBIDDEN',
    );
  }

  const registrations = await AppDataSource.getRepository(ContestRegistration).find({
    where: {
      userId: viewer.userId,
      ...(contestId ? { contestId } : {}),
    },
    order: { createdAt: 'DESC' },
  });
  const userMap = await getRegistrationUsers(AppDataSource.manager, registrations);
  return registrations.map((registration) =>
    toRegistrationDto(registration, userMap.get(registration.userId)),
  );
}

export async function lookupContestRegistrationByCode(
  contestId: string,
  viewer: Viewer,
  checkInCode: string,
): Promise<RegistrationDto> {
  if (![UserRole.PROVIDER, UserRole.STAFF].includes(viewer.role)) {
    throw new AppError(
      'Role hiện tại không được tra cứu registration contest',
      403,
      'CONTEST_REGISTRATION_LOOKUP_FORBIDDEN',
    );
  }

  const contest = await getContestOrThrow(AppDataSource.manager, contestId);
  if (viewer.role === UserRole.PROVIDER) {
    assertContestOwner(contest, viewer.userId);
  } else {
    await assertStaffAssignedToAnyContestCafe(AppDataSource.manager, viewer.userId, contestId);
  }

  const registration = await AppDataSource.getRepository(ContestRegistration).findOne({
    where: { contestId, checkInCode },
  });
  if (!registration) {
    throw new AppError('Registration không tồn tại', 404, 'CONTEST_REGISTRATION_NOT_FOUND');
  }
  const userMap = await getRegistrationUsers(AppDataSource.manager, [registration]);
  return toRegistrationDto(registration, userMap.get(registration.userId));
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

    await revalidateRentalRegistration(manager, contest, registration);

    const before = { status: registration.status, checked_in_at: registration.checkedInAt };

    registration.status = ContestRegistrationStatus.CHECKED_IN;
    registration.checkedInCafeId = body.cafe_id;
    registration.checkedInBy = viewer.userId;
    registration.checkedInAt = new Date();

    const saved = await manager.getRepository(ContestRegistration).save(registration);
    await writeContestAudit(manager, {
      contestId: contest.id,
      registrationId: saved.id,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'registration.checked_in',
      beforeJson: before,
      afterJson: {
        status: saved.status,
        checked_in_cafe_id: saved.checkedInCafeId,
        checked_in_by: saved.checkedInBy,
        checked_in_at: saved.checkedInAt,
      },
    });
    return toRegistrationDto(saved);
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

    const before = { status: registration.status, cancelled_at: registration.cancelledAt };

    registration.status = ContestRegistrationStatus.CANCELLED;
    registration.cancelledBy = viewer.userId;
    registration.cancelledAt = new Date();
    registration.cancellationReason = body.reason ?? null;

    const saved = await manager.getRepository(ContestRegistration).save(registration);
    await writeContestAudit(manager, {
      contestId: contest.id,
      registrationId: saved.id,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'registration.cancelled',
      beforeJson: before,
      afterJson: {
        status: saved.status,
        cancelled_by: saved.cancelledBy,
        cancelled_at: saved.cancelledAt,
        cancellation_reason: saved.cancellationReason,
      },
      reason: saved.cancellationReason,
    });
    return toRegistrationDto(saved);
  });
}

export async function approveRegistration(
  registrationId: string,
  viewer: Viewer,
): Promise<RegistrationDto> {
  if (![UserRole.PROVIDER, UserRole.STAFF].includes(viewer.role)) {
    throw new AppError(
      'Role hiện tại không được duyệt registration contest',
      403,
      'CONTEST_REGISTRATION_APPROVE_FORBIDDEN',
    );
  }

  return AppDataSource.transaction(async (manager) => {
    const registration = await getRegistrationOrThrow(manager, registrationId);
    const contest = await getContestOrThrow(manager, registration.contestId);

    if (viewer.role === UserRole.PROVIDER) {
      assertContestOwner(contest, viewer.userId);
    } else {
      await assertStaffAssignedToAnyContestCafe(manager, viewer.userId, contest.id);
    }

    if (registration.status !== ContestRegistrationStatus.PENDING) {
      throw new AppError(
        'Chỉ có thể duyệt đơn đăng ký đang ở trạng thái PENDING',
        400,
        'CONTEST_REGISTRATION_STATUS_INVALID',
      );
    }

    const before = { status: registration.status };
    registration.status = ContestRegistrationStatus.CONFIRMED;

    const saved = await manager.getRepository(ContestRegistration).save(registration);
    await writeContestAudit(manager, {
      contestId: contest.id,
      registrationId: saved.id,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'registration.approved',
      beforeJson: before,
      afterJson: {
        status: saved.status,
      },
    });
    return toRegistrationDto(saved);
  });
}

export async function rejectRegistration(
  registrationId: string,
  viewer: Viewer,
  reason?: string,
): Promise<RegistrationDto> {
  if (![UserRole.PROVIDER, UserRole.STAFF].includes(viewer.role)) {
    throw new AppError(
      'Role hiện tại không được từ chối registration contest',
      403,
      'CONTEST_REGISTRATION_REJECT_FORBIDDEN',
    );
  }

  return AppDataSource.transaction(async (manager) => {
    const registration = await getRegistrationOrThrow(manager, registrationId);
    const contest = await getContestOrThrow(manager, registration.contestId);

    if (viewer.role === UserRole.PROVIDER) {
      assertContestOwner(contest, viewer.userId);
    } else {
      await assertStaffAssignedToAnyContestCafe(manager, viewer.userId, contest.id);
    }

    if (
      registration.status !== ContestRegistrationStatus.PENDING &&
      registration.status !== ContestRegistrationStatus.CONFIRMED
    ) {
      throw new AppError(
        'Chỉ có thể từ chối đơn đăng ký ở trạng thái PENDING hoặc CONFIRMED',
        400,
        'CONTEST_REGISTRATION_STATUS_INVALID',
      );
    }

    const before = { status: registration.status, cancelled_at: registration.cancelledAt };

    registration.status = ContestRegistrationStatus.CANCELLED;
    registration.cancelledBy = viewer.userId;
    registration.cancelledAt = new Date();
    registration.cancellationReason = reason ?? 'Bị từ chối bởi quản trị viên/nhân viên';

    const saved = await manager.getRepository(ContestRegistration).save(registration);
    await writeContestAudit(manager, {
      contestId: contest.id,
      registrationId: saved.id,
      actorId: viewer.userId,
      actorRole: viewer.role,
      eventType: 'registration.rejected',
      beforeJson: before,
      afterJson: {
        status: saved.status,
        cancelled_by: saved.cancelledBy,
        cancelled_at: saved.cancelledAt,
        cancellation_reason: saved.cancellationReason,
      },
      reason: saved.cancellationReason,
    });
    return toRegistrationDto(saved);
  });
}

import { Between } from 'typeorm';
import { AppDataSource } from '../config/database';
import { AppError, UserRole } from '../types';
import { ShiftPosition } from '../models/shift-position.entity';
import { StaffShift } from '../models/staff-shift.entity';

const DEFAULT_POSITIONS = ['Lễ tân', 'Giám sát', 'Kỹ thuật'];
const DAY_MS = 24 * 60 * 60 * 1000;

export type ShiftPositionDTO = {
  id: string;
  name: string;
};

export type StaffShiftDTO = {
  id: string;
  positionId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  shiftDate: string;
  shiftLabel: string | null;
  startTime: string | null;
  endTime: string | null;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('Ngày không hợp lệ', 400, 'INVALID_DATE');
  }
  return parsed;
}

async function ensureDefaultPositions(providerId: string): Promise<void> {
  const repo = AppDataSource.getRepository(ShiftPosition);
  const count = await repo.count({ where: { providerId } });
  if (count > 0) return;

  await repo.save(DEFAULT_POSITIONS.map((name) => repo.create({ providerId, name })));
}

export async function createPosition(providerId: string, name: string): Promise<ShiftPositionDTO> {
  const normalizedName = name.trim();
  await ensureDefaultPositions(providerId);

  const existing = await AppDataSource.getRepository(ShiftPosition)
    .createQueryBuilder('position')
    .where('position.provider_id = :providerId', { providerId })
    .andWhere('position.deleted_at IS NULL')
    .andWhere('lower(position.name) = lower(:name)', { name: normalizedName })
    .getOne();

  if (existing) {
    throw new AppError('Vị trí đã tồn tại', 409, 'POSITION_ALREADY_EXISTS');
  }

  const position = await AppDataSource.getRepository(ShiftPosition).save(
    AppDataSource.getRepository(ShiftPosition).create({ providerId, name: normalizedName }),
  );

  return { id: position.id, name: position.name };
}

export async function getWeekSchedule(
  providerId: string,
  startDate: string,
): Promise<{
  weekStart: string;
  weekEnd: string;
  positions: ShiftPositionDTO[];
  shifts: StaffShiftDTO[];
}> {
  await ensureDefaultPositions(providerId);

  const start = parseIsoDate(startDate);
  const end = addDays(start, 6);
  const weekStart = toIsoDate(start);
  const weekEnd = toIsoDate(end);

  const positions = await AppDataSource.getRepository(ShiftPosition).find({
    where: { providerId },
    order: { createdAt: 'ASC' },
  });

  const shifts = await AppDataSource.getRepository(StaffShift).find({
    where: {
      providerId,
      shiftDate: Between(weekStart, weekEnd),
    },
    order: { shiftDate: 'ASC', createdAt: 'ASC' },
  });

  const staffIds = [...new Set(shifts.map((shift) => shift.staffId))];
  const staffRows = staffIds.length
    ? await AppDataSource.query<{ id: string; email: string; full_name: string }[]>(
        `SELECT id, email, full_name FROM users WHERE id = ANY($1::uuid[])`,
        [staffIds],
      )
    : [];
  const staffById = new Map(staffRows.map((staff) => [staff.id, staff]));

  return {
    weekStart,
    weekEnd,
    positions: positions.map((position) => ({ id: position.id, name: position.name })),
    shifts: shifts.map((shift) => {
      const staff = staffById.get(shift.staffId);
      return {
        id: shift.id,
        positionId: shift.positionId,
        staffId: shift.staffId,
        staffName: staff?.full_name ?? 'Nhân viên',
        staffEmail: staff?.email ?? '',
        shiftDate: shift.shiftDate,
        shiftLabel: shift.shiftLabel,
        startTime: shift.startTime ? shift.startTime.slice(0, 5) : null,
        endTime: shift.endTime ? shift.endTime.slice(0, 5) : null,
      };
    }),
  };
}

export async function assignShift(
  providerId: string,
  input: { position_id: string; staff_id: string; shift_date: string },
): Promise<StaffShiftDTO> {
  await ensureProviderPosition(providerId, input.position_id);
  const staff = await ensureProviderStaff(providerId, input.staff_id);

  const repo = AppDataSource.getRepository(StaffShift);
  let shift = await repo.findOne({
    where: {
      providerId,
      positionId: input.position_id,
      staffId: input.staff_id,
      shiftDate: input.shift_date,
    },
  });

  if (!shift) {
    shift = await repo.save(
      repo.create({
        providerId,
        positionId: input.position_id,
        staffId: input.staff_id,
        shiftDate: input.shift_date,
      }),
    );
  }

  return {
    id: shift.id,
    positionId: shift.positionId,
    staffId: shift.staffId,
    staffName: staff.full_name,
    staffEmail: staff.email,
    shiftDate: shift.shiftDate,
    shiftLabel: shift.shiftLabel,
    startTime: shift.startTime ? shift.startTime.slice(0, 5) : null,
    endTime: shift.endTime ? shift.endTime.slice(0, 5) : null,
  };
}

export async function updateShiftTime(
  providerId: string,
  input: { shift_id: string; shift_label: string; start_time: string; end_time: string },
): Promise<StaffShiftDTO> {
  const repo = AppDataSource.getRepository(StaffShift);
  const shift = await repo.findOne({ where: { id: input.shift_id, providerId } });
  if (!shift) {
    throw new AppError('Ca làm việc không tồn tại', 404, 'SHIFT_NOT_FOUND');
  }

  shift.shiftLabel = input.shift_label.trim();
  shift.startTime = input.start_time;
  shift.endTime = input.end_time;
  const saved = await repo.save(shift);

  const [staff] = await AppDataSource.query<{ id: string; email: string; full_name: string }[]>(
    `SELECT id, email, full_name FROM users WHERE id = $1`,
    [saved.staffId],
  );

  return {
    id: saved.id,
    positionId: saved.positionId,
    staffId: saved.staffId,
    staffName: staff?.full_name ?? 'Nhân viên',
    staffEmail: staff?.email ?? '',
    shiftDate: saved.shiftDate,
    shiftLabel: saved.shiftLabel,
    startTime: saved.startTime ? saved.startTime.slice(0, 5) : null,
    endTime: saved.endTime ? saved.endTime.slice(0, 5) : null,
  };
}

async function ensureProviderPosition(providerId: string, positionId: string): Promise<void> {
  const position = await AppDataSource.getRepository(ShiftPosition).findOne({
    where: { id: positionId, providerId },
  });
  if (!position) {
    throw new AppError('Vị trí không tồn tại', 404, 'POSITION_NOT_FOUND');
  }
}

async function ensureProviderStaff(
  providerId: string,
  staffId: string,
): Promise<{ id: string; email: string; full_name: string }> {
  const [staff] = await AppDataSource.query<{ id: string; email: string; full_name: string }[]>(
    `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN staff_cafe_assignments a ON a.staff_id = u.id
       JOIN cafes c ON c.id = a.cafe_id
      WHERE u.id = $1
        AND u.role = $2
        AND u.deleted_at IS NULL
        AND c.provider_id = $3`,
    [staffId, UserRole.STAFF, providerId],
  );

  if (!staff) {
    throw new AppError('Nhân viên không thuộc Provider này', 404, 'STAFF_NOT_FOUND');
  }

  return staff;
}

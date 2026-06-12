import { Between, In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { AppError, UserRole } from '../types';
import { ShiftPosition } from '../models/shift-position.entity';
import { StaffShift } from '../models/staff-shift.entity';
import { ShiftTimePreset } from '../models/shift-time-preset.entity';

const DEFAULT_POSITIONS = ['Lá»… tÃ¢n', 'GiÃ¡m sÃ¡t', 'Ká»¹ thuáº­t'];
const DEFAULT_SHIFT_TIME_PRESETS = [
  { label: 'SÃ¡ng (08-14)', startTime: '08:00', endTime: '14:00' },
  { label: 'Chiá»u (14-20)', startTime: '14:00', endTime: '20:00' },
  { label: 'Tá»‘i (18-24)', startTime: '18:00', endTime: '23:59' },
  { label: 'Cáº£ ngÃ y (09-18)', startTime: '09:00', endTime: '18:00' },
];
const DAY_MS = 24 * 60 * 60 * 1000;

export type ShiftPositionDTO = {
  id: string;
  name: string;
};

export type StaffShiftDTO = {
  id: string;
  cafeId: string;
  positionId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  shiftDate: string;
  shiftLabel: string | null;
  startTime: string | null;
  endTime: string | null;
};

export type ShiftTimePresetDTO = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
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
    throw new AppError('NgÃ y khÃ´ng há»£p lá»‡', 400, 'INVALID_DATE');
  }
  return parsed;
}

async function ensureDefaultPositions(providerId: string): Promise<void> {
  const repo = AppDataSource.getRepository(ShiftPosition);
  const count = await repo.count({ where: { providerId } });
  if (count > 0) return;

  await repo.save(DEFAULT_POSITIONS.map((name) => repo.create({ providerId, name })));
}

async function ensureDefaultShiftTimePresets(providerId: string): Promise<void> {
  const repo = AppDataSource.getRepository(ShiftTimePreset);
  const totalCount = await repo.count({ where: { providerId }, withDeleted: true });
  if (totalCount > 0) return;

  await repo.save(
    DEFAULT_SHIFT_TIME_PRESETS.map((preset, index) =>
      repo.create({
        providerId,
        label: preset.label,
        startTime: preset.startTime,
        endTime: preset.endTime,
        sortOrder: index + 1,
      }),
    ),
  );
}

function toShiftTimePresetDTO(preset: ShiftTimePreset): ShiftTimePresetDTO {
  return {
    id: preset.id,
    label: preset.label,
    startTime: preset.startTime.slice(0, 5),
    endTime: preset.endTime.slice(0, 5),
    sortOrder: preset.sortOrder,
  };
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
    throw new AppError('Vá»‹ trÃ­ Ä‘Ã£ tá»“n táº¡i', 409, 'POSITION_ALREADY_EXISTS');
  }

  const position = await AppDataSource.getRepository(ShiftPosition).save(
    AppDataSource.getRepository(ShiftPosition).create({ providerId, name: normalizedName }),
  );

  return { id: position.id, name: position.name };
}

export async function updatePosition(
  providerId: string,
  positionId: string,
  name: string,
): Promise<ShiftPositionDTO> {
  const normalizedName = name.trim();
  const repo = AppDataSource.getRepository(ShiftPosition);
  const position = await repo.findOne({ where: { id: positionId, providerId } });

  if (!position) {
    throw new AppError('VÃ¡Â»â€¹ trÃƒÂ­ khÃƒÂ´ng tÃ¡Â»â€œn tÃ¡ÂºÂ¡i', 404, 'POSITION_NOT_FOUND');
  }

  const existing = await repo
    .createQueryBuilder('position')
    .where('position.provider_id = :providerId', { providerId })
    .andWhere('position.deleted_at IS NULL')
    .andWhere('position.id <> :positionId', { positionId })
    .andWhere('lower(position.name) = lower(:name)', { name: normalizedName })
    .getOne();

  if (existing) {
    throw new AppError(
      'VÃ¡Â»â€¹ trÃƒÂ­ Ã„â€˜ÃƒÂ£ tÃ¡Â»â€œn tÃ¡ÂºÂ¡i',
      409,
      'POSITION_ALREADY_EXISTS',
    );
  }

  position.name = normalizedName;
  const saved = await repo.save(position);
  return { id: saved.id, name: saved.name };
}

export async function deletePosition(providerId: string, positionId: string): Promise<void> {
  await AppDataSource.transaction(async (manager) => {
    const position = await manager.getRepository(ShiftPosition).findOne({
      where: { id: positionId, providerId },
    });

    if (!position) {
      throw new AppError('VÃ¡Â»â€¹ trÃƒÂ­ khÃƒÂ´ng tÃ¡Â»â€œn tÃ¡ÂºÂ¡i', 404, 'POSITION_NOT_FOUND');
    }

    await manager.getRepository(StaffShift).delete({ providerId, positionId });
    await manager.getRepository(ShiftPosition).softDelete({ id: positionId, providerId });
  });
}

export async function listShiftTimePresets(providerId: string): Promise<ShiftTimePresetDTO[]> {
  await ensureDefaultShiftTimePresets(providerId);

  const presets = await AppDataSource.getRepository(ShiftTimePreset).find({
    where: { providerId },
    order: { sortOrder: 'ASC', createdAt: 'ASC' },
  });

  return presets.map(toShiftTimePresetDTO);
}

export async function createShiftTimePreset(
  providerId: string,
  input: { label: string; start_time: string; end_time: string },
): Promise<ShiftTimePresetDTO> {
  const normalizedLabel = input.label.trim();
  await ensureDefaultShiftTimePresets(providerId);
  await ensureUniqueShiftTimePresetLabel(providerId, normalizedLabel);

  const [{ next_sort_order: nextSortOrder }] = await AppDataSource.query<
    { next_sort_order: number }[]
  >(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
       FROM shift_time_presets
      WHERE provider_id = $1`,
    [providerId],
  );

  const repo = AppDataSource.getRepository(ShiftTimePreset);
  const preset = await repo.save(
    repo.create({
      providerId,
      label: normalizedLabel,
      startTime: input.start_time,
      endTime: input.end_time,
      sortOrder: Number(nextSortOrder) || 1,
    }),
  );

  return toShiftTimePresetDTO(preset);
}

export async function updateShiftTimePreset(
  providerId: string,
  presetId: string,
  input: { label: string; start_time: string; end_time: string },
): Promise<ShiftTimePresetDTO> {
  const normalizedLabel = input.label.trim();
  const repo = AppDataSource.getRepository(ShiftTimePreset);
  const preset = await repo.findOne({ where: { id: presetId, providerId } });

  if (!preset) {
    throw new AppError('Ca lÃ m khÃ´ng tá»“n táº¡i', 404, 'SHIFT_TIME_PRESET_NOT_FOUND');
  }

  await ensureUniqueShiftTimePresetLabel(providerId, normalizedLabel, presetId);

  preset.label = normalizedLabel;
  preset.startTime = input.start_time;
  preset.endTime = input.end_time;
  const saved = await repo.save(preset);
  return toShiftTimePresetDTO(saved);
}

export async function deleteShiftTimePreset(providerId: string, presetId: string): Promise<void> {
  const repo = AppDataSource.getRepository(ShiftTimePreset);
  const preset = await repo.findOne({ where: { id: presetId, providerId } });

  if (!preset) {
    throw new AppError('Ca lÃ m khÃ´ng tá»“n táº¡i', 404, 'SHIFT_TIME_PRESET_NOT_FOUND');
  }

  await repo.softDelete({ id: presetId, providerId });
}

export async function getWeekSchedule(
  providerId: string,
  startDate: string,
  cafeId: string,
): Promise<{
  weekStart: string;
  weekEnd: string;
  positions: ShiftPositionDTO[];
  shifts: StaffShiftDTO[];
}> {
  await ensureDefaultPositions(providerId);
  await ensureProviderCafe(providerId, cafeId);

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
      cafeId,
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
        cafeId: shift.cafeId,
        positionId: shift.positionId,
        staffId: shift.staffId,
        staffName: staff?.full_name ?? 'NhÃ¢n viÃªn',
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
  input: { cafe_id: string; position_id: string; staff_id: string; shift_date: string },
): Promise<StaffShiftDTO> {
  await ensureProviderCafe(providerId, input.cafe_id);
  await ensureProviderPosition(providerId, input.position_id);
  const staff = await ensureProviderStaff(providerId, input.staff_id, input.cafe_id);

  const repo = AppDataSource.getRepository(StaffShift);
  const shift = await repo.save(
    repo.create({
      providerId,
      cafeId: input.cafe_id,
      positionId: input.position_id,
      staffId: input.staff_id,
      shiftDate: input.shift_date,
    }),
  );

  return {
    id: shift.id,
    cafeId: shift.cafeId,
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
    throw new AppError('Ca lÃ m viá»‡c khÃ´ng tá»“n táº¡i', 404, 'SHIFT_NOT_FOUND');
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
    cafeId: saved.cafeId,
    positionId: saved.positionId,
    staffId: saved.staffId,
    staffName: staff?.full_name ?? 'NhÃ¢n viÃªn',
    staffEmail: staff?.email ?? '',
    shiftDate: saved.shiftDate,
    shiftLabel: saved.shiftLabel,
    startTime: saved.startTime ? saved.startTime.slice(0, 5) : null,
    endTime: saved.endTime ? saved.endTime.slice(0, 5) : null,
  };
}

export async function moveShift(
  providerId: string,
  input: { shift_id: string; new_position_id: string; new_date: string },
): Promise<StaffShiftDTO> {
  await ensureProviderPosition(providerId, input.new_position_id);

  const repo = AppDataSource.getRepository(StaffShift);
  const shift = await repo.findOne({ where: { id: input.shift_id, providerId } });
  if (!shift) {
    throw new AppError('Ca làm việc không tồn tại', 404, 'SHIFT_NOT_FOUND');
  }

  shift.positionId = input.new_position_id;
  shift.shiftDate = input.new_date;
  const saved = await repo.save(shift);
  return staffShiftToDTO(saved);
}

export async function cloneShift(
  providerId: string,
  input: { source_shift_id: string; position_id: string; shift_date: string },
): Promise<StaffShiftDTO> {
  await ensureProviderPosition(providerId, input.position_id);
  const source = await getProviderShift(providerId, input.source_shift_id);
  const cloned = await cloneOneShift(source, input.position_id, input.shift_date);
  return staffShiftToDTO(cloned);
}

export async function bulkCloneShifts(
  providerId: string,
  input: {
    source_shift_ids: string[];
    target_cells: Array<{ position_id: string; shift_date: string }>;
  },
): Promise<StaffShiftDTO[]> {
  const uniquePositionIds = [...new Set(input.target_cells.map((cell) => cell.position_id))];
  await Promise.all(
    uniquePositionIds.map((positionId) => ensureProviderPosition(providerId, positionId)),
  );

  const sources = await Promise.all(
    input.source_shift_ids.map((shiftId) => getProviderShift(providerId, shiftId)),
  );
  const cloned: StaffShift[] = [];

  for (const cell of input.target_cells) {
    for (const source of sources) {
      cloned.push(await cloneOneShift(source, cell.position_id, cell.shift_date));
    }
  }

  return Promise.all(cloned.map(staffShiftToDTO));
}

export async function deleteShifts(
  providerId: string,
  shiftIds: string[],
): Promise<{ deletedCount: number }> {
  const uniqueShiftIds = [...new Set(shiftIds)];
  const result = await AppDataSource.getRepository(StaffShift).delete({
    providerId,
    id: In(uniqueShiftIds),
  });

  return { deletedCount: result.affected ?? 0 };
}

export async function clearEmployeeWeek(
  providerId: string,
  input: { employee_id: string; week_start_date: string },
): Promise<{ deletedCount: number }> {
  await ensureProviderStaffAnyCafe(providerId, input.employee_id);

  const weekStartDate = toIsoDate(parseIsoDate(input.week_start_date));
  const weekEndDate = toIsoDate(addDays(parseIsoDate(input.week_start_date), 6));
  const result = await AppDataSource.getRepository(StaffShift).delete({
    providerId,
    staffId: input.employee_id,
    shiftDate: Between(weekStartDate, weekEndDate),
  });

  return { deletedCount: result.affected ?? 0 };
}

async function ensureProviderPosition(providerId: string, positionId: string): Promise<void> {
  const position = await AppDataSource.getRepository(ShiftPosition).findOne({
    where: { id: positionId, providerId },
  });
  if (!position) {
    throw new AppError('Vá»‹ trÃ­ khÃ´ng tá»“n táº¡i', 404, 'POSITION_NOT_FOUND');
  }
}

async function getProviderShift(providerId: string, shiftId: string): Promise<StaffShift> {
  const shift = await AppDataSource.getRepository(StaffShift).findOne({
    where: { id: shiftId, providerId },
  });
  if (!shift) {
    throw new AppError('Ca làm việc không tồn tại', 404, 'SHIFT_NOT_FOUND');
  }
  return shift;
}

async function cloneOneShift(
  source: StaffShift,
  positionId: string,
  shiftDate: string,
): Promise<StaffShift> {
  const repo = AppDataSource.getRepository(StaffShift);
  return repo.save(
    repo.create({
      providerId: source.providerId,
      cafeId: source.cafeId,
      positionId,
      staffId: source.staffId,
      shiftDate,
      shiftLabel: source.shiftLabel,
      startTime: source.startTime,
      endTime: source.endTime,
    }),
  );
}

async function staffShiftToDTO(shift: StaffShift): Promise<StaffShiftDTO> {
  const [staff] = await AppDataSource.query<{ id: string; email: string; full_name: string }[]>(
    `SELECT id, email, full_name FROM users WHERE id = $1`,
    [shift.staffId],
  );

  return {
    id: shift.id,
    cafeId: shift.cafeId,
    positionId: shift.positionId,
    staffId: shift.staffId,
    staffName: staff?.full_name ?? 'Nhân viên',
    staffEmail: staff?.email ?? '',
    shiftDate: shift.shiftDate,
    shiftLabel: shift.shiftLabel,
    startTime: shift.startTime ? shift.startTime.slice(0, 5) : null,
    endTime: shift.endTime ? shift.endTime.slice(0, 5) : null,
  };
}

async function ensureProviderCafe(providerId: string, cafeId: string): Promise<void> {
  const [cafe] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id
       FROM cafes
      WHERE id = $1
        AND provider_id = $2
        AND deleted_at IS NULL`,
    [cafeId, providerId],
  );

  if (!cafe) {
    throw new AppError(
      'Chi nhánh không tồn tại hoặc không thuộc Provider này',
      404,
      'CAFE_NOT_FOUND',
    );
  }
}
async function ensureUniqueShiftTimePresetLabel(
  providerId: string,
  label: string,
  ignorePresetId?: string,
): Promise<void> {
  let query = AppDataSource.getRepository(ShiftTimePreset)
    .createQueryBuilder('preset')
    .where('preset.provider_id = :providerId', { providerId })
    .andWhere('preset.deleted_at IS NULL')
    .andWhere('lower(preset.label) = lower(:label)', { label });

  if (ignorePresetId) {
    query = query.andWhere('preset.id <> :ignorePresetId', { ignorePresetId });
  }

  const existing = await query.getOne();
  if (existing) {
    throw new AppError('Ca lÃ m Ä‘Ã£ tá»“n táº¡i', 409, 'SHIFT_TIME_PRESET_ALREADY_EXISTS');
  }
}

async function ensureProviderStaff(
  providerId: string,
  staffId: string,
  cafeId: string,
): Promise<{ id: string; email: string; full_name: string }> {
  const [staff] = await AppDataSource.query<{ id: string; email: string; full_name: string }[]>(
    `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN staff_cafe_assignments a ON a.staff_id = u.id
       JOIN cafes c ON c.id = a.cafe_id
      WHERE u.id = $1
        AND u.role = $2
        AND u.deleted_at IS NULL
        AND c.provider_id = $3
        AND c.id = $4`,
    [staffId, UserRole.STAFF, providerId, cafeId],
  );

  if (!staff) {
    throw new AppError('Nhân viên không thu?c chi nhánh này', 404, 'STAFF_NOT_FOUND');
  }

  return staff;
}

async function ensureProviderStaffAnyCafe(providerId: string, staffId: string): Promise<void> {
  const [staff] = await AppDataSource.query<{ id: string }[]>(
    `SELECT u.id
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
}

import type { CafeOperatingHours } from '../types';

/**
 * Mốc thời gian và giờ hoạt động theo múi giờ Việt Nam.
 *
 * Gom về một nơi vì logic này quyết định một slot rơi vào ngày nào — chép thành
 * hai bản trong hệ thống đặt lịch thì sớm muộn hai bản lệch nhau, và triệu
 * chứng sẽ là "đặt được ở màn này nhưng bị từ chối ở màn kia" quanh nửa đêm.
 */

export const VN_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Nửa đêm theo giờ Việt Nam của ngày chứa `value`, trả về dưới dạng mốc UTC. */
export function getVietnamLocalMidnightUtcMs(value: Date): number {
  const local = new Date(value.getTime() + VN_TZ_OFFSET_MS);
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - VN_TZ_OFFSET_MS
  );
}

/** Khoá thứ trong tuần (`mon`, `tue`, …) dùng để tra bảng giờ hoạt động. */
export function getOperatingDayKey(localMidnightUtcMs: number): string {
  const local = new Date(localMidnightUtcMs + VN_TZ_OFFSET_MS);
  return DAY_KEYS[local.getUTCDay()]!;
}

/** `'HH:MM'` thành số phút từ nửa đêm. `null` khi chuỗi không hợp lệ. */
export function parseOperatingTimeToMinutes(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return 24 * 60;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Khung giờ mở cửa của một ngày cụ thể. `null` khi ngày đó nghỉ hoặc chưa khai.
 *
 * Giờ đóng nhỏ hơn hoặc bằng giờ mở nghĩa là quán bán qua nửa đêm, nên khung
 * được kéo sang ngày hôm sau thay vì coi là cấu hình sai.
 */
export function buildOperatingWindow(
  operatingHours: CafeOperatingHours | null | undefined,
  localMidnightUtcMs: number,
): { openAt: Date; closeAt: Date } | null {
  const schedule = operatingHours?.[getOperatingDayKey(localMidnightUtcMs)];
  if (!schedule || schedule.is_closed) return null;

  const openMinutes = parseOperatingTimeToMinutes(schedule.open);
  const closeMinutes = parseOperatingTimeToMinutes(schedule.close);
  if (openMinutes === null || closeMinutes === null) return null;

  const closeOffsetMinutes = closeMinutes <= openMinutes ? closeMinutes + 24 * 60 : closeMinutes;
  return {
    openAt: new Date(localMidnightUtcMs + openMinutes * 60 * 1000),
    closeAt: new Date(localMidnightUtcMs + closeOffsetMinutes * 60 * 1000),
  };
}

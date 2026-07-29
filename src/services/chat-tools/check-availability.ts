import { Type } from '@google/genai';
import { AppDataSource } from '../../config/database';

export const definition = {
  name: 'check_availability',
  description:
    'Kiểm tra slot trống tại chi nhánh theo ngày. Gọi khi khách hỏi về lịch trống, còn slot không, muốn đặt sân vào ngày/giờ nào.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      date: {
        type: Type.STRING,
        description:
          'Ngày cần kiểm tra, định dạng YYYY-MM-DD. Tự suy ra từ context (ngày mai, thứ 6, cuối tuần…). Nếu không xác định được, dùng ngày hôm nay.',
      },
    },
    required: [],
  },
};

export interface CheckAvailabilityArgs {
  date?: string;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function toVnTimeString(d: Date): string {
  const vnMs = d.getTime() + VN_OFFSET_MS;
  return new Date(vnMs).toISOString().slice(11, 16); // HH:MM
}

function todayInVn(): string {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

// cafeId luôn được inject từ widget context — không nhận từ args để tránh cross-cafe query
export async function handler(cafeId: string, args: CheckAvailabilityArgs): Promise<string> {
  const dateStr = args.date ?? todayInVn();
  const ds = AppDataSource;

  const cafeRows = await ds.query<
    {
      byoc_capacity: number;
      slot_duration_minutes: number;
      name: string;
    }[]
  >(`SELECT byoc_capacity, slot_duration_minutes, name FROM cafes WHERE id = $1`, [cafeId]);
  if (!cafeRows.length) return JSON.stringify({ error: 'Cafe not found' });

  const byocCapacity = Number(cafeRows[0].byoc_capacity);
  const slotMinutes = Number(cafeRows[0].slot_duration_minutes);
  if (
    !Number.isInteger(byocCapacity) ||
    byocCapacity < 0 ||
    !Number.isInteger(slotMinutes) ||
    slotMinutes <= 0
  ) {
    return JSON.stringify({ error: 'Cafe schedule or BYOC capacity is not configured correctly' });
  }

  // RENTAL capacity = number of currently available vehicles
  const vehicleRows = await ds.query<{ count: string }[]>(
    `SELECT COUNT(*) AS count FROM vehicles
     WHERE cafe_id = $1 AND status = 'AVAILABLE' AND deleted_at IS NULL`,
    [cafeId],
  );
  const totalVehicles = parseInt(vehicleRows[0]?.count ?? '0', 10);

  const vnMidnight = `${dateStr}T00:00:00+07:00`;

  // Per-slot: count BYOC bookings (each = 1 BYOC slot) and booked vehicle IDs for RENTAL
  // Matches the same overlap logic used by the real availability API:
  //   b.slot_start < slot_end AND b.slot_end > slot_start
  const rows = await ds.query<
    {
      slot_time: Date;
      byoc_booked: number;
      rental_booked: number;
    }[]
  >(
    `SELECT
       gs.slot_time,
       COUNT(DISTINCT CASE WHEN b.play_mode = 'BYOC' THEN b.id END)::int       AS byoc_booked,
       COUNT(DISTINCT CASE WHEN b.play_mode = 'RENTAL' THEN bv.vehicle_id END)::int AS rental_booked
     FROM generate_series(
       $3::timestamptz,
       $3::timestamptz + interval '1 day' - ($4 || ' minutes')::interval,
       ($4 || ' minutes')::interval
     ) AS gs(slot_time)
     LEFT JOIN bookings b
       ON b.cafe_id = $1
       AND b.status IN ('PENDING', 'CONFIRMED')
       AND b.slot_start < gs.slot_time + ($4 || ' minutes')::interval
       AND b.slot_end   > gs.slot_time
     LEFT JOIN booking_vehicles bv ON bv.booking_id = b.id AND b.play_mode = 'RENTAL'
     WHERE gs.slot_time >= NOW()
     GROUP BY gs.slot_time
     HAVING
       ($2::int - COUNT(DISTINCT CASE WHEN b.play_mode = 'BYOC'   THEN b.id         END)) > 0
       OR ($5::int - COUNT(DISTINCT CASE WHEN b.play_mode = 'RENTAL' THEN bv.vehicle_id END)) > 0
     ORDER BY gs.slot_time`,
    [cafeId, byocCapacity, vnMidnight, slotMinutes, totalVehicles],
  );

  if (rows.length === 0) {
    return JSON.stringify({ date: dateStr, available: false, message: 'Hết slot trong ngày này.' });
  }

  const rentalTimes: string[] = [];
  const byocTimes: string[] = [];

  for (const r of rows) {
    const t = toVnTimeString(new Date(r.slot_time));
    if (totalVehicles - r.rental_booked > 0) rentalTimes.push(t);
    if (byocCapacity - r.byoc_booked > 0) byocTimes.push(t);
  }

  return JSON.stringify({
    date: dateStr,
    available: true,
    slotDurationMinutes: slotMinutes,
    rental: {
      available: rentalTimes.length > 0,
      availableTimes: rentalTimes,
      note: 'Thuê xe RC tại quán. Phù hợp người mới chơi.',
    },
    byoc: {
      available: byocTimes.length > 0,
      availableTimes: byocTimes,
      note: 'Mang xe RC cá nhân đến chơi, chỉ trả phí sân.',
    },
    note: `Mỗi slot kéo dài ${slotMinutes} phút. Khách chọn giờ bắt đầu để đặt sân.`,
  });
}

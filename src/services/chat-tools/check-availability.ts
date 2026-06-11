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

// cafeId luôn được inject từ widget context — không nhận từ args để tránh cross-cafe query
export async function handler(cafeId: string, args: CheckAvailabilityArgs): Promise<string> {
  const dateStr = args.date ?? new Date().toISOString().split('T')[0];
  const ds = AppDataSource;

  const cafeRows = await ds.query<{ max_concurrent_bookings: number; name: string }[]>(
    `SELECT max_concurrent_bookings, name FROM cafes WHERE id = $1`,
    [cafeId],
  );
  if (!cafeRows.length) return JSON.stringify({ error: 'Cafe not found' });

  const maxConcurrent = cafeRows[0].max_concurrent_bookings ?? 3;

  const rows = await ds.query<{ slot_time: Date; available_count: number }[]>(
    `SELECT
       gs.slot_time,
       $2::int - COUNT(b.id) AS available_count
     FROM generate_series(
       $3::date,
       $3::date + interval '1 day' - interval '30 minutes',
       interval '30 minutes'
     ) AS gs(slot_time)
     LEFT JOIN bookings b
       ON b.cafe_id = $1
       AND b.status IN ('PENDING', 'CONFIRMED')
       AND b.slot_start <= gs.slot_time
       AND b.slot_end > gs.slot_time
     GROUP BY gs.slot_time
     HAVING ($2::int - COUNT(b.id)) > 0
     ORDER BY gs.slot_time`,
    [cafeId, maxConcurrent, dateStr],
  );

  const slots = rows.map((r) => ({
    time: new Date(r.slot_time).toTimeString().slice(0, 5),
    availableCount: Number(r.available_count),
  }));

  return JSON.stringify({ date: dateStr, totalAvailable: slots.length, slots });
}

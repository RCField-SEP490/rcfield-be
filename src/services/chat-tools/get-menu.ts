import { Type } from '@google/genai';
import { AppDataSource } from '../../config/database';

export const definition = {
  name: 'get_menu',
  description:
    'Lấy thực đơn F&B tại chi nhánh. Gọi khi khách hỏi về đồ ăn, thức uống, menu, đồ uống có gì, giá đồ ăn bao nhiêu.',
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: [],
  },
};

interface MenuRow {
  name: string;
  description: string | null;
  price: string;
  category: string | null;
  is_available: boolean;
}

export async function handler(cafeId: string): Promise<string> {
  const rows = await AppDataSource.query<MenuRow[]>(
    `SELECT name, description, price, category, is_available
     FROM menu_items
     WHERE cafe_id = $1 AND deleted_at IS NULL
     ORDER BY category ASC, price ASC`,
    [cafeId],
  );

  if (!rows.length) {
    return JSON.stringify({ menu: [], message: 'Chi nhánh chưa cập nhật thực đơn.' });
  }

  // Group by category
  const grouped: Record<string, unknown[]> = {};
  for (const r of rows) {
    const cat = r.category ?? 'Khác';
    if (!grouped[cat]) grouped[cat] = [];
    const item: Record<string, unknown> = {
      name: r.name,
      price: `${Math.round(parseFloat(r.price)).toLocaleString('vi-VN')}đ`,
    };
    if (r.description) item.description = r.description;
    if (!r.is_available) item.note = 'Tạm hết';
    grouped[cat].push(item);
  }

  return JSON.stringify({ menu: grouped });
}

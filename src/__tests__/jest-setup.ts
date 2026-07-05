import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { redis } from '../config/redis';

// Kết nối DB trước khi test file chạy
beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
});

// Xóa sạch data sau mỗi test — CASCADE tự xử lý FK
beforeEach(async () => {
  await AppDataSource.query(`
    TRUNCATE TABLE
      reviews,
      vehicle_maintenance_logs,
      notification_logs,
      trust_score_logs,
      fnb_order_items,
      fnb_orders,
      disputes,
      extension_proposals,
      inspection_checklists,
      inspection_photos,
      inspections,
      payment_transactions,
      payment_components,
      promotion_usages,
      bookings,
      menu_items,
      promotions,
      vehicle_catalog_images,
      vehicles,
      staff_cafe_assignments,
      cafe_announcements,
      cafe_images,
      kb_chunks,
      kb_documents,
      feature_flags,
      cafes,
      password_reset_tokens,
      refresh_tokens,
      users
    RESTART IDENTITY CASCADE
  `);
});

// Đóng connection sau khi test file xong
afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  try {
    await redis.quit();
  } catch {
    // ignore
  }
});

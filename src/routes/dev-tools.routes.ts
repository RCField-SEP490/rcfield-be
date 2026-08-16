import { NextFunction, Request, Response, Router } from 'express';
import { CLIENT_SCRIPT, STYLE, renderContestLab } from '../dev-tools/contest-lab.template';
import { env } from '../config/env';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { AppDataSource } from '../config/database';
import { UserRole } from '../types';

/**
 * Công cụ dựng dữ liệu giải đấu cho môi trường thử.
 *
 * Trang này KHÔNG chạm vào cơ sở dữ liệu — nó gọi đúng những endpoint mà giao
 * diện thật gọi, theo đúng thứ tự. Nhờ vậy dữ liệu sinh ra đi qua đủ mọi kiểm
 * tra nghiệp vụ, không bị lệch trạng thái như khi chèn thẳng vào bảng.
 *
 * Phục vụ từ chính backend nên trang cùng nguồn với API — không vướng CORS, và
 * không phải dựng thêm gì để chạy.
 */
const router = Router();

/**
 * Khoá mở cửa, chỉ có hiệu lực khi `DEV_TOOLS_TOKEN` được khai.
 *
 * Đây không phải lớp xác thực — trang tự nó không cầm quyền gì, mọi lời gọi
 * API đều mang token đăng nhập do người dùng tự nhập. Khoá này chỉ để trang
 * không nằm phơi trên tên miền thật cho ai gõ trúng đường dẫn cũng thấy.
 *
 * Trả 404 chứ không 403: 403 xác nhận đường dẫn có tồn tại, còn 404 thì với
 * người dò đường trang này không khác gì đã tắt.
 */
function requireDevToolsKey(req: Request, res: Response, next: NextFunction) {
  if (!env.devTools.token) return next();
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (key !== env.devTools.token) {
    res.status(404).type('text').send('Not Found');
    return;
  }
  next();
}

router.use(requireDevToolsKey);

// GET /dev-tools/contest-lab
router.get('/contest-lab', (req, res) => {
  // Chuyển tiếp khoá xuống hai tệp con — xem chú thích ở `renderContestLab`.
  const assetQuery = env.devTools.token
    ? `?key=${encodeURIComponent(String(req.query.key ?? ''))}`
    : '';
  res.type('html').send(renderContestLab(assetQuery));
});

// GET /dev-tools/contest-lab.css
router.get('/contest-lab.css', (_req, res) => {
  res.type('css').send(STYLE);
});

// GET /dev-tools/contest-lab.js
//
// Tách khỏi trang thay vì nhúng nội tuyến: chính sách bảo mật nội dung của ứng
// dụng chỉ cho chạy script cùng nguồn.
router.get('/contest-lab.js', (_req, res) => {
  res.type('js').send(CLIENT_SCRIPT);
});

/**
 * GET /dev-tools/customers  [admin]
 *
 * Danh sách tài khoản khách để chọn làm vận động viên, thay cho việc gõ tay
 * từng email — gõ tay thì mười người đã mất kiên nhẫn, mà giải đấu thật cần
 * mười sáu, ba hai.
 *
 * Đặt ở dev-tools chứ KHÔNG mở một endpoint liệt kê người dùng cho toàn hệ
 * thống: đây là nhu cầu của công cụ dựng dữ liệu, không phải năng lực sản phẩm.
 * Mở ra ở /api/v1 là từ đó về sau có một API xuất danh bạ người dùng mà không ai
 * cố ý thêm.
 *
 * Chặn hai lớp: khoá dev-tools ở trên, và token ADMIN thật ở đây. Chỉ khoá thôi
 * là chưa đủ — email người dùng là dữ liệu cá nhân, ai cầm khoá cũng tải được
 * cả danh bạ thì khoá đó thành chìa vạn năng.
 */
router.get(
  '/customers',
  authenticate,
  authorize(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const rows = await AppDataSource.query<
        { id: string; email: string; full_name: string | null; created_at: Date }[]
      >(
        `SELECT id, email, full_name, created_at
           FROM users
          WHERE role = $1 AND deleted_at IS NULL AND is_active = true
            AND ($2 = '' OR email ILIKE '%' || $2 || '%' OR full_name ILIKE '%' || $2 || '%')
          ORDER BY created_at DESC
          LIMIT $3`,
        [UserRole.CUSTOMER, q, limit],
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },
);

export { router as devToolsRouter };

import { Router } from 'express';
import { CLIENT_SCRIPT, STYLE, renderContestLab } from '../dev-tools/contest-lab.template';

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

// GET /dev-tools/contest-lab
router.get('/contest-lab', (_req, res) => {
  res.type('html').send(renderContestLab());
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

export { router as devToolsRouter };

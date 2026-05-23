import { Router, Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';

const router = Router();

// GET /api/system/widget-config
// Returns the system cafe ID and widget config for the landing page chat demo
router.get('/widget-config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = AppDataSource;

    const [cafe] = await ds.query<{ id: string }[]>(
      `SELECT id FROM cafes WHERE slug = 'rcfield-system' AND status = 'ACTIVE' LIMIT 1`,
    );

    if (!cafe) {
      res.status(503).json({ success: false, message: 'System chat not available' });
      return;
    }

    const [config] = await ds.query<
      {
        greeting_message: string;
        position: string;
        primary_color: string;
        quick_replies: string[];
        is_enabled: boolean;
      }[]
    >(
      `SELECT greeting_message, position, primary_color, quick_replies, is_enabled
       FROM cafe_widget_configs WHERE cafe_id = $1`,
      [cafe.id],
    );

    res.json({
      success: true,
      data: {
        cafeId: cafe.id,
        greetingMessage: config?.greeting_message ?? 'Xin chào! Tôi có thể giúp gì cho bạn?',
        position: config?.position ?? 'BOTTOM_RIGHT',
        primaryColor: config?.primary_color ?? '#EA580C',
        quickReplies: config?.quick_replies ?? [],
        isEnabled: config?.is_enabled ?? false,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as systemRouter };

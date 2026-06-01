import { Router, Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { upsertWidgetConfig } from '../services/chat.service';
import { UserRole } from '../types';

const router = Router();

// GET /api/system/widget-config
// Returns the system cafe ID and widget config for the landing page chat demo
router.get('/widget-config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = AppDataSource;

    const [cafe] = await ds.query<{ id: string; slug: string }[]>(
      `SELECT id, slug FROM cafes WHERE slug = 'rcfield-system' AND status = 'ACTIVE' LIMIT 1`,
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
        system_prompt: string | null;
        is_enabled: boolean;
        full_page_enabled: boolean;
      }[]
    >(
      `SELECT greeting_message, position, primary_color, quick_replies, system_prompt, is_enabled, full_page_enabled
       FROM cafe_widget_configs WHERE cafe_id = $1`,
      [cafe.id],
    );

    res.json({
      success: true,
      data: {
        cafeId: cafe.id,
        cafeSlug: cafe.slug,
        greetingMessage: config?.greeting_message ?? 'Xin chào! Tôi có thể giúp gì cho bạn?',
        position: config?.position ?? 'BOTTOM_RIGHT',
        primaryColor: config?.primary_color ?? '#EA580C',
        quickReplies: config?.quick_replies ?? [],
        systemPrompt: config?.system_prompt ?? null,
        isEnabled: config?.is_enabled ?? false,
        fullPageEnabled: config?.full_page_enabled ?? false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/system/widget-config  [admin]
router.put(
  '/widget-config',
  authenticate,
  authorize(UserRole.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ds = AppDataSource;

      const [cafe] = await ds.query<{ id: string }[]>(
        `SELECT id FROM cafes WHERE slug = 'rcfield-system' AND status = 'ACTIVE' LIMIT 1`,
      );

      if (!cafe) {
        res.status(503).json({ success: false, message: 'System chat not available' });
        return;
      }

      const {
        greetingMessage,
        position,
        primaryColor,
        quickReplies,
        systemPrompt,
        isEnabled,
        fullPageEnabled,
      } = req.body as {
        greetingMessage?: string;
        position?: string;
        primaryColor?: string;
        quickReplies?: string[];
        systemPrompt?: string | null;
        isEnabled?: boolean;
        fullPageEnabled?: boolean;
      };

      await upsertWidgetConfig(cafe.id, {
        ...(greetingMessage !== undefined && { greetingMessage }),
        ...(position !== undefined && { position }),
        ...(primaryColor !== undefined && { primaryColor }),
        ...(quickReplies !== undefined && { quickReplies }),
        ...(systemPrompt !== undefined && { systemPrompt }),
        ...(isEnabled !== undefined && { isEnabled }),
        ...(fullPageEnabled !== undefined && { fullPageEnabled }),
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export { router as systemRouter };

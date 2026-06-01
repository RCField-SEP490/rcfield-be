import type { Response, NextFunction } from 'express';
import {
  CafeListQuerySchema,
  CreateCafeSchema,
  UpdateCafeSchema,
  UpdateCafeStatusSchema,
  UpsertWidgetConfigSchema,
} from '../validate';
import { AppError, AuthRequest, CafeStatus, UserRole } from '../types';
import { AppDataSource } from '../config/database';
import * as cafeService from '../services/cafe.service';
import { getWidgetConfigForCafe, upsertWidgetConfig } from '../services/chat.service';

function viewerFromRequest(req: AuthRequest) {
  return req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
}

export const cafeController = {
  // POST /api/v1/cafes  [auth]
  async createCafe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = CreateCafeSchema.parse(req.body);
      const cafe = await cafeService.createCafe(req.user.userId, body);
      res.status(201).json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes
  async listCafes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, scope, district, city, track_type, status } = CafeListQuerySchema.parse(
        req.query,
      );
      const canFilterStatus =
        req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.PROVIDER;
      const visibleStatus = canFilterStatus ? (status as CafeStatus | undefined) : undefined;

      const result = await cafeService.listCafes({
        page,
        limit,
        scope,
        district,
        city,
        track_type,
        status: visibleStatus,
        viewer: viewerFromRequest(req),
      });
      res.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page, limit },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId
  async getCafeById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cafe = await cafeService.getCafeDetail(req.params.cafeId, viewerFromRequest(req));
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/cafes/:cafeId  [auth]
  async updateCafe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== UserRole.PROVIDER) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }
      const body = UpdateCafeSchema.parse(req.body);
      const cafe = await cafeService.updateCafe(req.params.cafeId, req.user.userId, body);
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/cafes/:cafeId/status  [auth]
  async updateCafeStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const { status } = UpdateCafeStatusSchema.parse(req.body);
      const cafe = await cafeService.updateCafeStatus(req.params.cafeId, status, {
        userId: req.user.userId,
        role: req.user.role,
      });
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/widget-config  [auth]
  async getWidgetConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await cafeService.getManagedCafeOrThrow(req.params.cafeId, {
        userId: req.user.userId,
        role: req.user.role,
      });
      const config = await getWidgetConfigForCafe(req.params.cafeId);
      res.json({
        success: true,
        data: {
          greetingMessage: config?.greetingMessage ?? 'Xin chào! Tôi có thể giúp gì cho bạn?',
          welcomeMessage: config?.welcomeMessage ?? 'Xin chào! Tôi có thể giúp gì cho bạn?',
          position: config?.position ?? 'BOTTOM_RIGHT',
          primaryColor: config?.primaryColor ?? '#EA580C',
          avatarUrl: config?.avatarUrl ?? null,
          quickReplies: config?.quickReplies ?? [],
          systemPrompt: config?.systemPrompt ?? null,
          isEnabled: config?.isEnabled ?? false,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/v1/cafes/:cafeId/widget-config  [auth]
  async updateWidgetConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await cafeService.getManagedCafeOrThrow(req.params.cafeId, {
        userId: req.user.userId,
        role: req.user.role,
      });
      const body = UpsertWidgetConfigSchema.parse(req.body);
      const updated = await upsertWidgetConfig(req.params.cafeId, {
        ...(body.greeting_message !== undefined && { greetingMessage: body.greeting_message }),
        ...(body.welcome_message !== undefined && { welcomeMessage: body.welcome_message }),
        ...(body.position !== undefined && { position: body.position }),
        ...(body.primary_color !== undefined && { primaryColor: body.primary_color }),
        ...(body.avatar_url !== undefined && { avatarUrl: body.avatar_url }),
        ...(body.quick_replies !== undefined && { quickReplies: body.quick_replies }),
        ...(body.system_prompt !== undefined && { systemPrompt: body.system_prompt }),
      });
      if (body.is_enabled !== undefined) {
        await AppDataSource.query(
          `UPDATE cafe_widget_configs SET is_enabled = $1 WHERE cafe_id = $2`,
          [body.is_enabled, req.params.cafeId],
        );
      }
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
};

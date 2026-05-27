import type { Response, NextFunction } from 'express';
import {
  CafeListQuerySchema,
  CreateCafeSchema,
  UpdateCafeSchema,
  UpdateCafeStatusSchema,
} from '../validate';
import { AppError, AuthRequest, CafeStatus, UserRole } from '../types';
import * as cafeService from '../services/cafe.service';

function viewerFromRequest(req: AuthRequest) {
  return req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
}

export const cafeController = {
  // POST /api/v1/cafes  [auth]
  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
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
  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, district, city, track_type, status } = CafeListQuerySchema.parse(
        req.query,
      );
      const canFilterStatus =
        req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.PROVIDER;
      if (status && !canFilterStatus) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }

      const result = await cafeService.listCafes({
        page,
        limit,
        district,
        city,
        track_type,
        status: status as CafeStatus | undefined,
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

  // GET /api/v1/cafes/:id
  async detail(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cafe = await cafeService.getCafeDetail(req.params.id, viewerFromRequest(req));
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/cafes/:id  [auth]
  async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== UserRole.PROVIDER) {
        throw new AppError('Forbidden', 403, 'FORBIDDEN');
      }
      const body = UpdateCafeSchema.parse(req.body);
      const cafe = await cafeService.updateCafe(req.params.id, req.user.userId, body);
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/cafes/:id/status  [auth]
  async updateStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status } = UpdateCafeStatusSchema.parse(req.body);
      const cafe = await cafeService.updateCafeStatus(req.params.id, status);
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },
};

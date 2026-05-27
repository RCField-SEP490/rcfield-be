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
      const { page, limit, district, city, track_type, status } = CafeListQuerySchema.parse(
        req.query,
      );
      const canFilterStatus =
        req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.PROVIDER;
      const visibleStatus = canFilterStatus ? (status as CafeStatus | undefined) : undefined;

      const result = await cafeService.listCafes({
        page,
        limit,
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
      const { status } = UpdateCafeStatusSchema.parse(req.body);
      const cafe = await cafeService.updateCafeStatus(req.params.cafeId, status);
      res.json({ success: true, data: cafe });
    } catch (err) {
      next(err);
    }
  },
};

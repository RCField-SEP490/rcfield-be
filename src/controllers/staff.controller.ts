import type { Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import {
  CreateStaffSchema,
  StaffIdParamsSchema,
  StaffListQuerySchema,
  UpdateStaffAssignmentSchema,
  UpdateStaffSchema,
  UpdateStaffStatusSchema,
} from '../validate';
import { AppError, AuthRequest } from '../types';
import * as staffService from '../services/staff.service';

export const staffController = {
  // GET /api/v1/provider/staff  [auth]
  async listStaff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const query = StaffListQuerySchema.parse(req.query);
      const result = await staffService.listStaffForProvider(req.user.userId, query);
      logger.auth('provider list staff', {
        providerId: req.user.userId,
        total: result.total,
        page: query.page,
        limit: query.limit,
      });
      res.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page: query.page, limit: query.limit },
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/provider/staff  [auth]
  async createStaff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = CreateStaffSchema.parse(req.body);
      const data = await staffService.createStaffForProvider(req.user.userId, body);
      logger.auth('provider create staff', {
        providerId: req.user.userId,
        staffId: data.id,
        cafeId: data.cafeId,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/provider/staff/:staffId  [auth]
  async getStaff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const { staffId } = StaffIdParamsSchema.parse(req.params);
      const data = await staffService.getStaffDetailForProvider(req.user.userId, staffId);
      logger.auth('provider get staff', { providerId: req.user.userId, staffId });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/provider/staff/:staffId  [auth]
  async updateStaff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const { staffId } = StaffIdParamsSchema.parse(req.params);
      const body = UpdateStaffSchema.parse(req.body);
      const data = await staffService.updateStaffForProvider(req.user.userId, staffId, body);
      logger.auth('provider update staff', { providerId: req.user.userId, staffId });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/provider/staff/:staffId/assignment  [auth]
  async updateAssignment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const { staffId } = StaffIdParamsSchema.parse(req.params);
      const { cafe_id } = UpdateStaffAssignmentSchema.parse(req.body);
      const data = await staffService.updateStaffAssignmentForProvider(
        req.user.userId,
        staffId,
        cafe_id,
      );
      logger.auth('provider update staff assignment', {
        providerId: req.user.userId,
        staffId,
        cafeId: data.cafeId,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/provider/staff/:staffId/status  [auth]
  async updateStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const { staffId } = StaffIdParamsSchema.parse(req.params);
      const { is_active } = UpdateStaffStatusSchema.parse(req.body);
      const data = await staffService.updateStaffStatusForProvider(
        req.user.userId,
        staffId,
        is_active,
      );
      logger.auth('provider update staff status', {
        providerId: req.user.userId,
        staffId,
        isActive: data.isActive,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/provider/staff/:staffId/reset-password  [auth]
  async resetPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const { staffId } = StaffIdParamsSchema.parse(req.params);
      const data = await staffService.resetStaffPasswordForProvider(req.user.userId, staffId);
      logger.auth('provider reset staff password', { providerId: req.user.userId, staffId });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

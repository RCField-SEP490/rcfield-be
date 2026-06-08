import type { Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { CreateStaffSchema } from '../validate';
import { AppError, AuthRequest } from '../types';
import * as staffService from '../services/staff.service';

export const staffController = {
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

  // GET /api/v1/provider/staff  [auth]
  async listStaff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const cafeId = typeof req.query.cafe_id === 'string' ? req.query.cafe_id : undefined;
      const data = await staffService.listStaffForProvider(req.user.userId, cafeId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/provider/staff/:staffId/deactivate  [auth]
  async deactivateStaff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await staffService.deactivateStaff(req.user.userId, req.params.staffId);
      logger.info('Staff', 'deactivated', {
        providerId: req.user.userId,
        staffId: req.params.staffId,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/provider/staff/:staffId/reactivate  [auth]
  async reactivateStaff(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await staffService.reactivateStaff(req.user.userId, req.params.staffId);
      logger.info('Staff', 'reactivated', {
        providerId: req.user.userId,
        staffId: req.params.staffId,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/provider/staff/:staffId/resend-invite  [auth]
  async resendInvite(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const data = await staffService.resendInvite(req.user.userId, req.params.staffId);
      logger.info('Staff', 'invite resent', {
        providerId: req.user.userId,
        staffId: req.params.staffId,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/staff/today-bookings  [auth]
  async todayBookings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      if (!req.user.cafeId)
        throw new AppError('Staff chưa được gán chi nhánh', 403, 'CAFE_NOT_ASSIGNED');
      const data = await staffService.getTodayBookings(req.user.cafeId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

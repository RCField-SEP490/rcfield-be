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
};

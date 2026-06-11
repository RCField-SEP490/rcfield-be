import type { NextFunction, Response } from 'express';
import {
  AssignShiftSchema,
  CreateShiftPositionSchema,
  UpdateShiftTimeSchema,
  WeekShiftQuerySchema,
} from '../validate';
import { AppError, AuthRequest } from '../types';
import * as shiftService from '../services/shift.service';

export const shiftController = {
  async createPosition(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = CreateShiftPositionSchema.parse(req.body);
      const data = await shiftService.createPosition(req.user.userId, body.name);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getWeek(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const query = WeekShiftQuerySchema.parse(req.query);
      const data = await shiftService.getWeekSchedule(req.user.userId, query.start_date);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async assignShift(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = AssignShiftSchema.parse(req.body);
      const data = await shiftService.assignShift(req.user.userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async updateShiftTime(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = UpdateShiftTimeSchema.parse(req.body);
      const data = await shiftService.updateShiftTime(req.user.userId, body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

import type { NextFunction, Response } from 'express';
import {
  AssignShiftSchema,
  BulkDeleteShiftSchema,
  BulkCloneShiftSchema,
  ClearEmployeeWeekShiftSchema,
  CloneShiftSchema,
  CreateShiftTimePresetSchema,
  CreateShiftPositionSchema,
  MoveShiftSchema,
  UpdateShiftPositionSchema,
  UpdateShiftTimeSchema,
  UpdateShiftTimePresetSchema,
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

  async updatePosition(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = UpdateShiftPositionSchema.parse(req.body);
      const data = await shiftService.updatePosition(
        req.user.userId,
        req.params.positionId,
        body.name,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async deletePosition(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await shiftService.deletePosition(req.user.userId, req.params.positionId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async listShiftTimePresets(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const data = await shiftService.listShiftTimePresets(req.user.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async createShiftTimePreset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = CreateShiftTimePresetSchema.parse(req.body);
      const data = await shiftService.createShiftTimePreset(req.user.userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async updateShiftTimePreset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = UpdateShiftTimePresetSchema.parse(req.body);
      const data = await shiftService.updateShiftTimePreset(
        req.user.userId,
        req.params.presetId,
        body,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async deleteShiftTimePreset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      await shiftService.deleteShiftTimePreset(req.user.userId, req.params.presetId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async getWeek(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const query = WeekShiftQuerySchema.parse(req.query);
      const data = await shiftService.getWeekSchedule(
        req.user.userId,
        query.start_date,
        query.cafe_id,
      );
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

  async moveShift(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = MoveShiftSchema.parse(req.body);
      const data = await shiftService.moveShift(req.user.userId, body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async cloneShift(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = CloneShiftSchema.parse(req.body);
      const data = await shiftService.cloneShift(req.user.userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async bulkCloneShifts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = BulkCloneShiftSchema.parse(req.body);
      const data = await shiftService.bulkCloneShifts(req.user.userId, body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async bulkDeleteShifts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = BulkDeleteShiftSchema.parse(req.body);
      const data = await shiftService.deleteShifts(req.user.userId, body.shift_ids);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async clearEmployeeWeek(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const body = ClearEmployeeWeekShiftSchema.parse(req.body);
      const data = await shiftService.clearEmployeeWeek(req.user.userId, body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

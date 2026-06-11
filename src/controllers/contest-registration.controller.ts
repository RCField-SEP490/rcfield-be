import type { NextFunction, Response } from 'express';
import { AppError, AuthRequest } from '../types';
import * as contestRegistrationService from '../services/contest-registration.service';
import {
  CancelContestRegistrationSchema,
  CheckInContestRegistrationSchema,
  ContestIdParamsSchema,
  ContestRegistrationIdParamsSchema,
  RegisterContestSchema,
} from '../validate';

function authViewer(req: AuthRequest) {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  return { userId: req.user.userId, role: req.user.role };
}

export const contestRegistrationController = {
  // POST /api/v1/contests/:id/register [auth]
  async register(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = RegisterContestSchema.parse(req.body);
      const data = await contestRegistrationService.registerContest(id, authViewer(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id/registrations [auth]
  async listByContest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const viewer = authViewer(req);
      const data = await contestRegistrationService.listContestRegistrations(id, viewer.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-registrations/:id/check-in [auth]
  async checkIn(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestRegistrationIdParamsSchema.parse(req.params);
      const body = CheckInContestRegistrationSchema.parse(req.body);
      const data = await contestRegistrationService.checkInRegistration(id, authViewer(req), body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-registrations/:id/cancel [auth]
  async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestRegistrationIdParamsSchema.parse(req.params);
      const body = CancelContestRegistrationSchema.parse(req.body);
      const data = await contestRegistrationService.cancelRegistration(id, authViewer(req), body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

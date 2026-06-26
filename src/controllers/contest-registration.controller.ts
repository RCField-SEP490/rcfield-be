import type { NextFunction, Response } from 'express';
import { AppError, AuthRequest } from '../types';
import * as contestRegistrationService from '../services/contest-registration.service';
import {
  CancelContestRegistrationSchema,
  CheckInContestRegistrationSchema,
  ContestIdParamsSchema,
  ContestRegistrationLookupQuerySchema,
  ContestRegistrationIdParamsSchema,
  MyContestRegistrationsQuerySchema,
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

  // GET /api/v1/me/contest-registrations [auth]
  async listMine(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = MyContestRegistrationsQuerySchema.parse(req.query);
      const data = await contestRegistrationService.listMyContestRegistrations(
        authViewer(req),
        query.contest_id,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id/registrations/lookup [auth]
  async lookupByCode(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const query = ContestRegistrationLookupQuerySchema.parse(req.query);
      const data = await contestRegistrationService.lookupContestRegistrationByCode(
        id,
        authViewer(req),
        query.check_in_code,
      );
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

  // POST /api/v1/contest-registrations/:id/approve [auth]
  async approve(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestRegistrationIdParamsSchema.parse(req.params);
      const data = await contestRegistrationService.approveRegistration(id, authViewer(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-registrations/:id/reject [auth]
  async reject(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestRegistrationIdParamsSchema.parse(req.params);
      const body = CancelContestRegistrationSchema.parse(req.body);
      const data = await contestRegistrationService.rejectRegistration(
        id,
        authViewer(req),
        body.reason,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

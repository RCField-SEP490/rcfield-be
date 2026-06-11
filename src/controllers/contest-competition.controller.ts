import type { NextFunction, Response } from 'express';
import { AppError, AuthRequest } from '../types';
import * as competitionService from '../services/contest-competition.service';
import {
  AddContestHeatEntrySchema,
  ContestHeatIdParamsSchema,
  ContestIdParamsSchema,
  ContestResultIdParamsSchema,
  ContestRoundIdParamsSchema,
  CreateContestClassSchema,
  CreateContestHeatSchema,
  CreateContestRoundSchema,
  SubmitContestHeatResultsSchema,
  VerifyContestResultSchema,
} from '../validate';

function authViewer(req: AuthRequest) {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  return { userId: req.user.userId, role: req.user.role };
}

function providerId(req: AuthRequest): string {
  const viewer = authViewer(req);
  return viewer.userId;
}

export const contestCompetitionController = {
  // POST /api/v1/contests/:id/classes [auth]
  async createClass(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = CreateContestClassSchema.parse(req.body);
      const data = await competitionService.createContestClass(id, providerId(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/rounds [auth]
  async createRound(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = CreateContestRoundSchema.parse(req.body);
      const data = await competitionService.createContestRound(id, providerId(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-rounds/:id/heats [auth]
  async createHeat(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestRoundIdParamsSchema.parse(req.params);
      const body = CreateContestHeatSchema.parse(req.body);
      const data = await competitionService.createContestHeat(id, authViewer(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-heats/:id/entries [auth]
  async addHeatEntry(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestHeatIdParamsSchema.parse(req.params);
      const body = AddContestHeatEntrySchema.parse(req.body);
      const data = await competitionService.addContestHeatEntry(id, authViewer(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-heats/:id/results [auth]
  async submitResults(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestHeatIdParamsSchema.parse(req.params);
      const body = SubmitContestHeatResultsSchema.parse(req.body);
      const data = await competitionService.submitContestHeatResults(id, authViewer(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-results/:id/verify [auth]
  async verifyResult(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestResultIdParamsSchema.parse(req.params);
      VerifyContestResultSchema.parse(req.body);
      const data = await competitionService.verifyContestResult(id, authViewer(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

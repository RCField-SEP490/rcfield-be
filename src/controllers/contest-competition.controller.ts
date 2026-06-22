import type { NextFunction, Response } from 'express';
import { AppError, AuthRequest } from '../types';
import * as competitionService from '../services/contest-competition.service';
import {
  AddContestHeatEntrySchema,
  ContestBracketMatchIdParamsSchema,
  ContestHeatIdParamsSchema,
  ContestIdParamsSchema,
  ContestResultIdParamsSchema,
  ContestRoundIdParamsSchema,
  CreateContestBracketMatchSchema,
  CreateContestClassSchema,
  CreateContestHeatSchema,
  CreateContestRoundSchema,
  DecideContestBracketMatchSchema,
  SubmitContestHeatResultsSchema,
  VerifyContestResultSchema,
} from '../validate';

function authViewer(req: AuthRequest) {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  return { userId: req.user.userId, role: req.user.role };
}

function optionalViewer(req: AuthRequest) {
  return req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
}

function providerId(req: AuthRequest): string {
  const viewer = authViewer(req);
  return viewer.userId;
}

export const contestCompetitionController = {
  // GET /api/v1/contests/:id/classes
  async listClasses(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await competitionService.listContestClasses(id, optionalViewer(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id/rounds
  async listRounds(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await competitionService.listContestRounds(id, optionalViewer(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id/bracket
  async listBracket(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await competitionService.listContestBracket(id, optionalViewer(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

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

  // POST /api/v1/contest-rounds/:id/bracket-matches [auth]
  async createBracketMatch(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestRoundIdParamsSchema.parse(req.params);
      const body = CreateContestBracketMatchSchema.parse(req.body);
      const data = await competitionService.createContestBracketMatch(id, authViewer(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-bracket-matches/:id/decide [auth]
  async decideBracketMatch(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestBracketMatchIdParamsSchema.parse(req.params);
      const body = DecideContestBracketMatchSchema.parse(req.body);
      const data = await competitionService.decideContestBracketMatch(id, authViewer(req), body);
      res.json({ success: true, data });
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

import type { NextFunction, Response } from 'express';
import { AppError, AuthRequest } from '../types';
import * as tournamentService from '../services/contest-tournament.service';
import {
  AdvanceContestMatchSchema,
  ContestIdParamsSchema,
  ContestMatchIdParamsSchema,
  GenerateContestMatchesSchema,
  PublishContestLeaderboardSchema,
  SubmitContestMatchResultsSchema,
  UpdateContestMatchParticipantsSchema,
} from '../validate';

function authViewer(req: AuthRequest) {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  return { userId: req.user.userId, role: req.user.role };
}

export const contestTournamentController = {
  // GET /api/v1/contests/:id/matches [auth]
  async listMatches(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await tournamentService.listContestMatches(id, authViewer(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/matches/generate [auth]
  async generate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = GenerateContestMatchesSchema.parse(req.body);
      const data = await tournamentService.generateContestMatches(id, authViewer(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/contest-matches/:id/participants [auth]
  async updateParticipants(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestMatchIdParamsSchema.parse(req.params);
      const body = UpdateContestMatchParticipantsSchema.parse(req.body);
      const data = await tournamentService.updateMatchParticipants(id, authViewer(req), body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-matches/:id/results [auth]
  async submitResults(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestMatchIdParamsSchema.parse(req.params);
      const body = SubmitContestMatchResultsSchema.parse(req.body);
      const data = await tournamentService.submitMatchResults(id, authViewer(req), body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contest-matches/:id/advance [auth]
  async advance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestMatchIdParamsSchema.parse(req.params);
      const body = AdvanceContestMatchSchema.parse(req.body);
      const data = await tournamentService.advanceContestMatch(id, authViewer(req), body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/leaderboard/publish [auth]
  async publishLeaderboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = PublishContestLeaderboardSchema.parse(req.body);
      const data = await tournamentService.publishLeaderboard(id, authViewer(req), body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

import type { NextFunction, Response } from 'express';
import { AppError, AuthRequest } from '../types';
import * as leaderboardService from '../services/contest-leaderboard.service';
import {
  ContestIdParamsSchema,
  CreateContestRewardSchema,
  IssueContestRewardsSchema,
  PublishContestLeaderboardSchema,
} from '../validate';

function authUserId(req: AuthRequest): string {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  return req.user.userId;
}

export const contestLeaderboardController = {
  // GET /api/v1/contests/:id/leaderboard
  async getLeaderboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const standings = await leaderboardService.computeLeaderboard(id);
      res.json({ success: true, data: { standings } });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/leaderboard/publish [auth]
  async publishLeaderboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = PublishContestLeaderboardSchema.parse(req.body);
      const data = await leaderboardService.publishLeaderboard(id, authUserId(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/rewards [auth]
  async createReward(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = CreateContestRewardSchema.parse(req.body);
      const data = await leaderboardService.createReward(id, authUserId(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id/rewards
  async listRewards(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await leaderboardService.listRewards(id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/rewards/issue [auth]
  async issueRewards(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = IssueContestRewardsSchema.parse(req.body);
      const data = await leaderboardService.issueRewardClaims(
        id,
        authUserId(req),
        body.contest_class_id,
      );
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/me/contest-reward-claims [auth]
  async myRewardClaims(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await leaderboardService.listMyRewardClaims(authUserId(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

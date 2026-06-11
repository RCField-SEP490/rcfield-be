import { Router } from 'express';
import { contestCompetitionController } from '../controllers/contest-competition.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';

export const contestRoundRouter = Router();
export const contestHeatRouter = Router();
export const contestResultRouter = Router();

contestRoundRouter.post(
  '/:id/heats',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestCompetitionController.createHeat,
);

contestHeatRouter.post(
  '/:id/entries',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestCompetitionController.addHeatEntry,
);
contestHeatRouter.post(
  '/:id/results',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestCompetitionController.submitResults,
);

contestResultRouter.post(
  '/:id/verify',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestCompetitionController.verifyResult,
);

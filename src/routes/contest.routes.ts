import { Router } from 'express';
import { contestController } from '../controllers/contest.controller';
import { contestRegistrationController } from '../controllers/contest-registration.controller';
import { contestCompetitionController } from '../controllers/contest-competition.controller';
import { contestLeaderboardController } from '../controllers/contest-leaderboard.controller';
import {
  authenticate,
  authorize,
  optionalAuthenticate,
  requireActiveProvider,
} from '../middlewares/auth.middleware';
import { UserRole } from '../types';

export const contestRouter = Router();

contestRouter.get('/', optionalAuthenticate, contestController.list);
contestRouter.post(
  '/',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.create,
);
contestRouter.post(
  '/:id/register',
  authenticate,
  authorize(UserRole.CUSTOMER, UserRole.PROVIDER),
  contestRegistrationController.register,
);
contestRouter.get(
  '/:id/registrations',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestRegistrationController.listByContest,
);
contestRouter.get(
  '/:id/leaderboard',
  optionalAuthenticate,
  contestLeaderboardController.getLeaderboard,
);
contestRouter.post(
  '/:id/leaderboard/publish',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestLeaderboardController.publishLeaderboard,
);
contestRouter.post(
  '/:id/rewards',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestLeaderboardController.createReward,
);
contestRouter.get('/:id/rewards', optionalAuthenticate, contestLeaderboardController.listRewards);
contestRouter.post(
  '/:id/rewards/issue',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestLeaderboardController.issueRewards,
);
contestRouter.post(
  '/:id/classes',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestCompetitionController.createClass,
);
contestRouter.post(
  '/:id/rounds',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestCompetitionController.createRound,
);
contestRouter.get('/:id', optionalAuthenticate, contestController.detail);
contestRouter.patch(
  '/:id',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.update,
);
contestRouter.post(
  '/:id/open',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.open,
);
contestRouter.post(
  '/:id/cancel',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.cancel,
);

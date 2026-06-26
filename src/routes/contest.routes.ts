import { Router } from 'express';
import { contestController } from '../controllers/contest.controller';
import { contestRegistrationController } from '../controllers/contest-registration.controller';
import { contestTournamentController } from '../controllers/contest-tournament.controller';
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
  '/:id/registrations/lookup',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestRegistrationController.lookupByCode,
);
contestRouter.get(
  '/:id/matches',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestTournamentController.listMatches,
);
contestRouter.post(
  '/:id/matches/generate',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestTournamentController.generate,
);
contestRouter.post(
  '/:id/leaderboard/publish',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestTournamentController.publishLeaderboard,
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
  '/:id/close',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.close,
);
contestRouter.post(
  '/:id/cancel',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  contestController.cancel,
);

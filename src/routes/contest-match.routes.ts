import { Router } from 'express';
import { contestTournamentController } from '../controllers/contest-tournament.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';

export const contestMatchRouter = Router();

contestMatchRouter.patch(
  '/:id/participants',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestTournamentController.updateParticipants,
);
contestMatchRouter.post(
  '/:id/results',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestTournamentController.submitResults,
);
contestMatchRouter.post(
  '/:id/advance',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestTournamentController.advance,
);

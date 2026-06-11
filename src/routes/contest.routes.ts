import { Router } from 'express';
import { contestController } from '../controllers/contest.controller';
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

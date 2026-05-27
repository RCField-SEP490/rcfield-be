import { Router } from 'express';
import {
  authenticate,
  authorize,
  optionalAuthenticate,
  requireActiveProvider,
} from '../middlewares/auth.middleware';
import { cafeController } from '../controllers/cafe.controller';
import { UserRole } from '../types';

export const cafeRouter = Router();

cafeRouter.get('/', optionalAuthenticate, cafeController.list);
cafeRouter.get('/:id', optionalAuthenticate, cafeController.detail);
cafeRouter.post(
  '/',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  cafeController.create,
);
cafeRouter.patch(
  '/:id',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  cafeController.update,
);
cafeRouter.patch(
  '/:id/status',
  authenticate,
  authorize(UserRole.ADMIN),
  cafeController.updateStatus,
);

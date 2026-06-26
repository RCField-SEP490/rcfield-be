import { Router } from 'express';
import { contestRegistrationController } from '../controllers/contest-registration.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';

export const contestRegistrationRouter = Router();

contestRegistrationRouter.post(
  '/:id/check-in',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestRegistrationController.checkIn,
);
contestRegistrationRouter.post(
  '/:id/cancel',
  authenticate,
  authorize(UserRole.CUSTOMER, UserRole.PROVIDER),
  contestRegistrationController.cancel,
);
contestRegistrationRouter.post(
  '/:id/approve',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestRegistrationController.approve,
);
contestRegistrationRouter.post(
  '/:id/reject',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  contestRegistrationController.reject,
);

import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { sessionController } from '../controllers/session.controller';

export const sessionRouter = Router();

// Customer session actions (real client flow)
sessionRouter.post(
  '/:sessionId/inspections/:inspectionId/confirm',
  authenticate,
  authorize(UserRole.CUSTOMER),
  sessionController.confirmInspection,
);

sessionRouter.post(
  '/:sessionId/inspection/confirm',
  authenticate,
  authorize(UserRole.CUSTOMER),
  sessionController.confirmInspection,
);

sessionRouter.post(
  '/:sessionId/extensions/respond',
  authenticate,
  authorize(UserRole.CUSTOMER),
  sessionController.respondExtension,
);

sessionRouter.post(
  '/:sessionId/extension/respond',
  authenticate,
  authorize(UserRole.CUSTOMER),
  sessionController.respondExtension,
);

// Get session detail (for customer to view inspection data)
sessionRouter.get(
  '/:sessionId',
  authenticate,
  authorize(UserRole.CUSTOMER),
  sessionController.getSessionDetail,
);

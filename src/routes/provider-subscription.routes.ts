import { Router } from 'express';
import { authenticate, authorize, requireActiveProvider } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { paymentRequestController } from '../controllers/payment-request.controller';
import { providerOnboardingController } from '../controllers/provider-onboarding.controller';
import { staffController } from '../controllers/staff.controller';

export const providerSubscriptionRouter = Router();

providerSubscriptionRouter.use(authenticate, authorize(UserRole.PROVIDER));

providerSubscriptionRouter.get('/me', providerOnboardingController.getProviderMe);

providerSubscriptionRouter.get('/staff', requireActiveProvider, staffController.listStaff);
providerSubscriptionRouter.post('/staff', requireActiveProvider, staffController.createStaff);
providerSubscriptionRouter.get('/staff/:staffId', requireActiveProvider, staffController.getStaff);
providerSubscriptionRouter.patch(
  '/staff/:staffId',
  requireActiveProvider,
  staffController.updateStaff,
);
providerSubscriptionRouter.patch(
  '/staff/:staffId/assignment',
  requireActiveProvider,
  staffController.updateAssignment,
);
providerSubscriptionRouter.patch(
  '/staff/:staffId/status',
  requireActiveProvider,
  staffController.updateStatus,
);
providerSubscriptionRouter.post(
  '/staff/:staffId/reset-password',
  requireActiveProvider,
  staffController.resetPassword,
);

providerSubscriptionRouter.get(
  '/subscription',
  requireActiveProvider,
  paymentRequestController.getSubscriptionStatus,
);
providerSubscriptionRouter.post(
  '/payment-requests',
  requireActiveProvider,
  paymentRequestController.submitPaymentRequest,
);
providerSubscriptionRouter.get(
  '/payment-requests',
  requireActiveProvider,
  paymentRequestController.listMyPaymentRequests,
);

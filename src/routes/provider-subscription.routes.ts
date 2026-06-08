import { Router } from 'express';
import { authenticate, authorize, requireActiveProvider } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { paymentRequestController } from '../controllers/payment-request.controller';
import { providerOnboardingController } from '../controllers/provider-onboarding.controller';
import { staffController } from '../controllers/staff.controller';

export const providerSubscriptionRouter = Router();

providerSubscriptionRouter.use(authenticate, authorize(UserRole.PROVIDER));

providerSubscriptionRouter.get('/me', providerOnboardingController.getProviderMe);

providerSubscriptionRouter.post('/staff', requireActiveProvider, staffController.createStaff);
providerSubscriptionRouter.get('/staff', requireActiveProvider, staffController.listStaff);
providerSubscriptionRouter.patch(
  '/staff/:staffId/deactivate',
  requireActiveProvider,
  staffController.deactivateStaff,
);
providerSubscriptionRouter.patch(
  '/staff/:staffId/reactivate',
  requireActiveProvider,
  staffController.reactivateStaff,
);
providerSubscriptionRouter.post(
  '/staff/:staffId/resend-invite',
  requireActiveProvider,
  staffController.resendInvite,
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

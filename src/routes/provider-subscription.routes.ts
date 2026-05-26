import { Router } from 'express';
import { authenticate, authorize, requireActiveProvider } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { paymentRequestController } from '../controllers/payment-request.controller';
import { providerOnboardingController } from '../controllers/provider-onboarding.controller';

export const providerSubscriptionRouter = Router();

providerSubscriptionRouter.use(authenticate, authorize(UserRole.PROVIDER));

providerSubscriptionRouter.get('/me', providerOnboardingController.getProviderMe);

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

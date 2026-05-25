import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { paymentRequestController } from '../controllers/payment-request.controller';

export const providerSubscriptionRouter = Router();

providerSubscriptionRouter.use(authenticate, authorize(UserRole.PROVIDER));

providerSubscriptionRouter.get('/subscription', paymentRequestController.getSubscriptionStatus);
providerSubscriptionRouter.post('/payment-requests', paymentRequestController.submitPaymentRequest);
providerSubscriptionRouter.get('/payment-requests', paymentRequestController.listMyPaymentRequests);

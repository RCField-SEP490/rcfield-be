import { Router } from 'express';
import { authRouter } from './auth.routes';
import { chatRouter } from './chat.routes';
import { systemRouter } from './system.routes';
import { fbChannelRouter } from './fb-channel.routes';
import { fbWebhookRouter } from './fb-webhook.routes';
import { providerOnboardingRouter } from './provider-onboarding.routes';
import { adminProviderRouter } from './admin-provider.routes';
import { adminPaymentRequestRouter } from './admin-payment-request.routes';
import { notificationRouter } from './notification.routes';
import { providerSubscriptionRouter } from './provider-subscription.routes';
import { adminSubscriptionPlanRouter } from './admin-subscription-plan.routes';
import { cafeRouter } from './cafe.routes';
import { cafeImagesRouter } from './cafe-images.routes';
import { uploadRouter } from './upload.routes';
import { vehicleCatalogRouter } from './vehicle-catalog.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'RCField API is running' });
});

router.use('/auth', authRouter);
router.use('/auth', providerOnboardingRouter);
router.use('/admin/providers', adminProviderRouter);
router.use('/admin/payment-requests', adminPaymentRequestRouter);
router.use('/admin/subscription-plans', adminSubscriptionPlanRouter);
router.use('/provider/notifications', notificationRouter);
router.use('/provider', providerSubscriptionRouter);
router.use('/system', systemRouter);
router.use('/uploads', uploadRouter);
router.use('/cafes', cafeRouter);
router.use('/', cafeImagesRouter);
router.use('/cafes/:cafeId/vehicle-catalogs', vehicleCatalogRouter);
router.use('/cafes/:cafeId', chatRouter);
router.use('/channels/facebook', fbChannelRouter);
router.use('/webhook/facebook', fbWebhookRouter);

// router.use('/bookings', bookingsRouter);
// router.use('/vehicles', vehiclesRouter);
// router.use('/inspections', inspectionsRouter);
// router.use('/payments', paymentsRouter);
// router.use('/fnb', fnbRouter);

export { router };

import { Router } from 'express';
import { authRouter } from './auth.routes';
import { chatRouter } from './chat.routes';
import { systemRouter } from './system.routes';
import { fbChannelRouter } from './fb-channel.routes';
import { fbWebhookRouter } from './fb-webhook.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'RCField API is running' });
});

router.use('/auth', authRouter);
router.use('/system', systemRouter);
router.use('/cafes/:cafeId', chatRouter);
router.use('/channels/facebook', fbChannelRouter);
router.use('/webhook/facebook', fbWebhookRouter);

// router.use('/cafes', cafesRouter);
// router.use('/bookings', bookingsRouter);
// router.use('/vehicles', vehiclesRouter);
// router.use('/inspections', inspectionsRouter);
// router.use('/payments', paymentsRouter);
// router.use('/fnb', fnbRouter);

export { router };

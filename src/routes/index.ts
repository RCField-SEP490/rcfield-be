import { Router } from 'express';
import { authRouter } from './auth.routes';
import { chatRouter } from './chat.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'RCField API is running' });
});

router.use('/auth', authRouter);
router.use('/cafes/:cafeId', chatRouter);

// router.use('/cafes', cafesRouter);
// router.use('/bookings', bookingsRouter);
// router.use('/vehicles', vehiclesRouter);
// router.use('/inspections', inspectionsRouter);
// router.use('/payments', paymentsRouter);
// router.use('/fnb', fnbRouter);

export { router };

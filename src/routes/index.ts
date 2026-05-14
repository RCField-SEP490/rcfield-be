import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'RCField API is running' });
});

// Routes sẽ được mount tại đây theo từng domain
// router.use('/auth', authRouter);
// router.use('/cafes', cafesRouter);
// router.use('/bookings', bookingsRouter);
// router.use('/vehicles', vehiclesRouter);
// router.use('/inspections', inspectionsRouter);
// router.use('/payments', paymentsRouter);
// router.use('/fnb', fnbRouter);

export { router };

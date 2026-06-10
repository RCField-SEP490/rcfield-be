import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { bookingController } from '../controllers/booking.controller';
import { UserRole } from '../types';

export const bookingRouter = Router();

bookingRouter.post(
  '/',
  authenticate,
  authorize(UserRole.CUSTOMER),
  bookingController.createBooking,
);

bookingRouter.get(
  '/',
  authenticate,
  authorize(UserRole.CUSTOMER),
  bookingController.listMyBookings,
);

bookingRouter.get('/:id', authenticate, bookingController.getBooking);

bookingRouter.post(
  '/:id/checkout',
  authenticate,
  authorize(UserRole.CUSTOMER),
  bookingController.createCheckout,
);

bookingRouter.post(
  '/:id/mock-checkout',
  authenticate,
  authorize(UserRole.CUSTOMER),
  bookingController.mockCheckout,
);

bookingRouter.post(
  '/:id/cancel',
  authenticate,
  authorize(UserRole.CUSTOMER, UserRole.PROVIDER),
  bookingController.cancelBooking,
);

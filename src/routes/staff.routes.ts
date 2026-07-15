import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { staffController } from '../controllers/staff.controller';

export const staffRouter = Router();

staffRouter.use(authenticate, authorize(UserRole.STAFF));

staffRouter.get('/today-bookings', staffController.todayBookings);
staffRouter.post('/bookings', staffController.createWalkInBooking);
staffRouter.get('/fnb-orders', staffController.getFnbOrders);
staffRouter.patch('/fnb-orders/:orderId', staffController.updateFnbOrder);

// Session Check-In & Details
staffRouter.post('/bookings/:bookingId/check-in', staffController.checkIn);
staffRouter.get('/sessions/:sessionId', staffController.getSessionDetail);

// Session Operations
staffRouter.post('/sessions/:sessionId/inspections', staffController.submitInspection);
staffRouter.post('/sessions/:sessionId/confirm-checkout', staffController.confirmCheckout);
staffRouter.put(
  '/sessions/:sessionId/inspections/:inspectionId/damage-items',
  staffController.updateDamageItems,
);
staffRouter.post('/sessions/:sessionId/escalate-dispute', staffController.escalateDispute);
staffRouter.post('/sessions/:sessionId/extensions', staffController.proposeExtension);
staffRouter.post('/sessions/:sessionId/fnb-orders', staffController.addSessionFnbOrder);
staffRouter.post('/sessions/:sessionId/swap-vehicle', staffController.swapSessionVehicle);
staffRouter.post(
  '/bookings/:bookingId/settle-pending-payments',
  staffController.settlePendingPayments,
);
staffRouter.post('/bookings/:bookingId/confirm-refund', staffController.confirmRefund);

// Client Simulators
staffRouter.post(
  '/sessions/:sessionId/simulate-check-in-response',
  staffController.simulateClientCheckIn,
);
staffRouter.post(
  '/sessions/:sessionId/simulate-check-out-response',
  staffController.simulateClientCheckOut,
);
staffRouter.post(
  '/sessions/:sessionId/simulate-extension-response',
  staffController.simulateClientExtension,
);

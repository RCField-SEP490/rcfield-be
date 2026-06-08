import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import { staffController } from '../controllers/staff.controller';

export const staffRouter = Router();

staffRouter.use(authenticate, authorize(UserRole.STAFF));

staffRouter.get('/today-bookings', staffController.todayBookings);

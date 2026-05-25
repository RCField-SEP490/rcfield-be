import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../controllers/notification.controller';

export const notificationRouter = Router();

notificationRouter.use(authenticate, authorize(UserRole.PROVIDER));

notificationRouter.get('/', getNotifications);
notificationRouter.put('/read-all', markAllNotificationsRead);
notificationRouter.put('/:id/read', markNotificationRead);

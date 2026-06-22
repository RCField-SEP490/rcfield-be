import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../controllers/notification.controller';

export const notificationRouter = Router();

notificationRouter.use(authenticate);

notificationRouter.get('/', getNotifications);
notificationRouter.put('/read-all', markAllNotificationsRead);
notificationRouter.put('/:id/read', markNotificationRead);

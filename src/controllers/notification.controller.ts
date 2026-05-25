import { Response, NextFunction } from 'express';
import { AppError, AuthRequest } from '../types';
import { NotificationQuerySchema } from '../validate';
import * as notificationService from '../services/notification.service';

// GET /api/v1/provider/notifications  [auth]
export async function getNotifications(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = NotificationQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'));
    }
    const { page, limit, unread_only } = parsed.data;
    const result = await notificationService.listForUser(req.user!.userId, {
      page,
      limit,
      unreadOnly: unread_only,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// PUT /api/v1/provider/notifications/read-all  [auth]
export async function markAllNotificationsRead(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const updated = await notificationService.markAllRead(req.user!.userId);
    res.json({ success: true, updated });
  } catch (err) {
    next(err);
  }
}

// PUT /api/v1/provider/notifications/:id/read  [auth]
export async function markNotificationRead(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await notificationService.markRead(req.params.id, req.user!.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

import { AppDataSource } from '../config/database';
import { Notification } from '../models/notification.entity';
import { NotificationType } from '../types';

interface ListOptions {
  page: number;
  limit: number;
  unreadOnly?: boolean;
}

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
): Promise<void> {
  const repo = AppDataSource.getRepository(Notification);
  await repo.save(repo.create({ userId, type, title, message }));
}

export async function listForUser(
  userId: string,
  options: ListOptions,
): Promise<{ data: Notification[]; total: number; unreadCount: number }> {
  const repo = AppDataSource.getRepository(Notification);
  const { page, limit, unreadOnly } = options;

  const qb = repo
    .createQueryBuilder('n')
    .where('n.user_id = :userId', { userId })
    .orderBy('n.created_at', 'DESC')
    .skip((page - 1) * limit)
    .take(limit);

  if (unreadOnly) {
    qb.andWhere('n.read_at IS NULL');
  }

  const [data, total] = await qb.getManyAndCount();
  const unreadCount = await repo.count({ where: { userId, readAt: undefined as unknown as Date } });

  return { data, total, unreadCount };
}

export async function markRead(notificationId: string, userId: string): Promise<void> {
  const repo = AppDataSource.getRepository(Notification);
  const notification = await repo.findOne({ where: { id: notificationId, userId } });
  if (!notification) return;
  if (!notification.readAt) {
    notification.readAt = new Date();
    await repo.save(notification);
  }
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await AppDataSource.query<{ affected: number }>(
    `UPDATE notifications SET read_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return Array.isArray(result) ? (result[1] as number) : 0;
}

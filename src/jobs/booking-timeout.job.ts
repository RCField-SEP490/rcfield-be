import cron from 'node-cron';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { transition } from '../services/booking.service';
import { processRefund } from '../services/payment.service';
import { UserRole } from '../types';

/** Runs every minute — expires PENDING bookings and marks CONFIRMED no-shows */
export function scheduleBookingTimeout(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const expired: { id: string }[] = await AppDataSource.query(
        `SELECT id FROM bookings
         WHERE status = 'PENDING'
           AND payment_expires_at < NOW()
           AND deleted_at IS NULL`,
      );

      if (expired.length > 0) {
        logger.info('BookingTimeout', `expiring ${expired.length} booking(s)`);
        for (const row of expired) {
          await transition(row.id, 'PAYMENT_TIMEOUT').catch((err) => {
            logger.error('BookingTimeout', `failed to expire bookingId=${row.id}`, err);
          });
        }
      }

      // NO_SHOW: CONFIRMED bookings where slot_start + 30 min has passed
      const noShows: { id: string }[] = await AppDataSource.query(
        `SELECT id FROM bookings
         WHERE status = 'CONFIRMED'
           AND slot_start + INTERVAL '30 minutes' < NOW()
           AND updated_at <= slot_start
           AND deleted_at IS NULL`,
      );

      if (noShows.length > 0) {
        logger.info('BookingTimeout', `marking ${noShows.length} booking(s) as NO_SHOW`);
        for (const row of noShows) {
          await transition(row.id, 'NO_SHOW')
            .then(() => processRefund(row.id, UserRole.PROVIDER, true))
            .catch((err) => {
              logger.error('BookingTimeout', `failed to NO_SHOW bookingId=${row.id}`, err);
            });
        }
      }
    } catch (err) {
      logger.error('BookingTimeout', 'job error', err);
    }
  });
}

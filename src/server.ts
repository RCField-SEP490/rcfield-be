import 'dotenv/config';
import { createServer } from 'http';
import { app } from './app';
import { AppDataSource } from './config/database';
import { redis } from './config/redis';
import { env } from './config/env';
import { logger } from './config/logger';
import { wsService } from './services/websocket.service';
import { scheduleQuotaReset } from './jobs/quota-reset.job';
import { startSubscriptionLifecycleJobs } from './jobs/subscription-lifecycle.job';
import { scheduleBookingTimeout } from './jobs/booking-timeout.job';
import { startPackageExpiryJob } from './jobs/package-expiry.job';
import { fbChatWorker } from './workers/fb-chat.worker';

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    logger.database(`PostgreSQL connected on port ${env.db.port}`);

    // Note: Database notification type column was migrated to VARCHAR(255), so pg_enum checks are no longer required.

    await redis.connect();
    logger.info('Redis', `Connected on port ${env.redis.port}`);

    const httpServer = createServer(app);
    wsService.init(httpServer);
    scheduleQuotaReset();
    startSubscriptionLifecycleJobs();
    scheduleBookingTimeout();
    startPackageExpiryJob();

    httpServer.listen(env.PORT, () => {
      logger.server(`Running on http://localhost:${env.PORT}`);
    });

    const shutdown = async () => {
      logger.server('Shutting down...');
      await fbChatWorker.close();
      httpServer.close(() => process.exit(0));
    };
    process.once('SIGTERM', () => void shutdown());
    process.once('SIGINT', () => void shutdown());
  } catch (err) {
    logger.error('Bootstrap', 'Failed to start', err);
    process.exit(1);
  }
}

void bootstrap();

import 'dotenv/config';
import { app } from './app';
import { AppDataSource } from './config/database';
import { redis } from './config/redis';
import { env } from './config/env';
import { logger } from './config/logger';

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    logger.info(`[DB] PostgreSQL connected on port ${env.db.port}`);

    await redis.connect();
    logger.info(`[Redis] Connected to Redis on port ${env.redis.port}`);

    app.listen(env.PORT, () => {
      logger.info(`[Server] Running on http://localhost:${env.PORT}`);
    });
  } catch (err) {
    logger.error('[Bootstrap] Failed to start', { error: err });
    process.exit(1);
  }
}

bootstrap();

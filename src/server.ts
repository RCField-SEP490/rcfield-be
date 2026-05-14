import 'dotenv/config';
import { app } from './app';
import { AppDataSource } from './config/database';
import { redis } from './config/redis';
import { env } from './config/env';
import { logger } from './config/logger';

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    logger.database(`PostgreSQL connected on port ${env.db.port}`);

    await redis.connect();
    logger.info('Redis', `Connected on port ${env.redis.port}`);

    app.listen(env.PORT, () => {
      logger.server(`Running on http://localhost:${env.PORT}`);
    });
  } catch (err) {
    logger.error('Bootstrap', 'Failed to start', err);
    process.exit(1);
  }
}

bootstrap();

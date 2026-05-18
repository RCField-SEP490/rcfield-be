import 'dotenv/config';
import { createServer } from 'http';
import { app } from './app';
import { AppDataSource } from './config/database';
import { redis } from './config/redis';
import { env } from './config/env';
import { logger } from './config/logger';
import { wsService } from './services/websocket.service';

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    logger.database(`PostgreSQL connected on port ${env.db.port}`);

    await redis.connect();
    logger.info('Redis', `Connected on port ${env.redis.port}`);

    const httpServer = createServer(app);
    wsService.init(httpServer);

    httpServer.listen(env.PORT, () => {
      logger.server(`Running on http://localhost:${env.PORT}`);
    });
  } catch (err) {
    logger.error('Bootstrap', 'Failed to start', err);
    process.exit(1);
  }
}

void bootstrap();

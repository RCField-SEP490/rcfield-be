import 'dotenv/config';
import { app } from './app';
import { AppDataSource } from './config/database';
import { redis } from './config/redis';
import { env } from './config/env';

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    console.log('[DB] PostgreSQL connected on port', env.db.port);

    await redis.connect();
    console.log('[Redis] Connected to Redis on port', env.redis.port);

    app.listen(env.PORT, () => {
      console.log(`[Server] Running on http://localhost:${env.PORT}`);
    });
  } catch (err) {
    console.error('[Bootstrap] Failed to start:', err);
    process.exit(1);
  }
}

bootstrap();

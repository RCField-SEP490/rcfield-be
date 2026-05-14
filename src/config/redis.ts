import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password,
  lazyConnect: true,
});

redis.on('error', (err) => {
  logger.error('Redis', 'Connection error', err);
});

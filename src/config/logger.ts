import winston from 'winston';
import { env } from './env';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const hasMeta = Object.keys(meta).length > 0;
  if (hasMeta) {
    const entry: Record<string, unknown> = { event: stack ?? message, ...meta };
    return `[${ts}] ${level}:\n` + JSON.stringify(entry, null, 2);
  }
  return `[${ts}] ${level}: ${stack ?? message}`;
});

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'HH:mm:ss' }),
    env.NODE_ENV === 'production'
      ? winston.format.json()
      : combine(colorize(), devFormat),
  ),
  transports: [new winston.transports.Console()],
});

export { logger };

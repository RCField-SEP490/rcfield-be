import { Worker } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { processEvent } from '../controllers/fb-webhook.controller';
import type { FbChatJobData } from '../queues/fb-chat.queue';

const connection = {
  host: env.redis.host,
  port: env.redis.port,
  ...(env.redis.password && { password: env.redis.password }),
};

export const fbChatWorker = new Worker<FbChatJobData>(
  'fb-chat',
  async (job) => {
    const { event, pageId } = job.data;
    await processEvent(event, pageId);
  },
  {
    connection,
    concurrency: 10,
    limiter: { max: 100, duration: 1000 },
  },
);

fbChatWorker.on('completed', (job) => {
  logger.info('FbChatWorker', 'job completed', { jobId: job.id });
});

fbChatWorker.on('failed', (job, err) => {
  logger.error('FbChatWorker', 'job failed', { jobId: job?.id, error: err.message });
});

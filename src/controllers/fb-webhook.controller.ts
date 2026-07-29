import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, ChannelStatus, ChannelType, FbMessagingEvent } from '../types';
import { CafeChannel } from '../models/cafe-channel.entity';
import { incrementAIQuota } from '../services/subscription.service';
import { decryptToken } from '../utils/crypto';
import {
  checkGate,
  route,
  fastAnswer,
  thanksAnswer,
  farewellAnswer,
  ragChat,
} from '../services/chat.service';
import { FbMessengerFormatter } from '../services/fb-messenger.formatter';
import { sendMessage, sendText, markSeen, typingOn } from '../services/fb-messenger.service';
import { fbChatQueue } from '../queues/fb-chat.queue';

interface FbWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    messaging: FbMessagingEvent[];
  }>;
}

export async function processEvent(event: FbMessagingEvent, pageId: string): Promise<void> {
  if (event.message?.is_echo) return;
  if (!event.message?.text) return;

  const psid = event.sender.id;
  const text = event.message.text;
  const mid = event.message.mid;

  // Resolve channel — page_id maps 1:1 to a cafe
  const channel = await AppDataSource.getRepository(CafeChannel).findOne({
    where: { pageId, channelType: ChannelType.FACEBOOK_MESSENGER, status: ChannelStatus.CONNECTED },
  });
  if (!channel) {
    logger.warn('Facebook Webhook', 'unknown page_id', { pageId });
    return;
  }
  const pageToken = decryptToken(channel.encryptedPageToken, env.facebook.encryptionKey as Buffer);
  const cafeId = channel.cafeId;

  // Dedup by message mid
  const dedup = await redis.set(`facebook:processed:${pageId}:${mid}`, '1', 'EX', 300, 'NX');
  if (!dedup) return;

  // ── Process chat message ─────────────────────────────────────────────────────
  const providerRows = await AppDataSource.query<{ provider_id: string; role: string }[]>(
    `SELECT c.provider_id, u.role FROM cafes c JOIN users u ON u.id = c.provider_id WHERE c.id = $1`,
    [cafeId],
  );
  const providerId = providerRows[0]?.provider_id;
  const providerRole = providerRows[0]?.role;

  const typingAt = Date.now();
  await Promise.all([markSeen(psid, pageToken), typingOn(psid, pageToken)]);

  try {
    await checkGate(cafeId);
    if (providerId && providerRole !== 'ADMIN') await incrementAIQuota(providerId);

    const { route: chatRoute, confidence } = await route(text);
    let response;
    if (chatRoute === 'fast') response = await fastAnswer(cafeId);
    else if (chatRoute === 'thanks') response = thanksAnswer();
    else if (chatRoute === 'farewell') response = farewellAnswer();
    else response = await ragChat(cafeId, text, [], confidence);

    const formatted = FbMessengerFormatter.format(response);

    const elapsed = Date.now() - typingAt;
    if (elapsed < 1500) await new Promise((r) => setTimeout(r, 1500 - elapsed));

    await sendMessage(psid, formatted, pageToken);
    logger.info('Facebook Webhook', 'replied', { cafeId, pageId, psid });
  } catch (err) {
    if (
      err instanceof AppError &&
      (err.code === 'AI_DISABLED' ||
        err.code === 'QUOTA_EXCEEDED' ||
        err.code === 'AI_QUOTA_EXCEEDED')
    ) {
      if (err.code === 'AI_QUOTA_EXCEEDED') {
        logger.warn('Facebook Webhook', 'AI quota exceeded', { providerId, cafeId });
      }
      await sendText(
        psid,
        'Xin lỗi, dịch vụ hỗ trợ tự động hiện không khả dụng. Vui lòng liên hệ trực tiếp chi nhánh.',
        pageToken,
      );
      return;
    }
    logger.error('Facebook Webhook', 'processing error', err);
  }
}

// GET /api/v1/webhook/facebook
export function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.facebook.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

// POST /api/v1/webhook/facebook
export function handleWebhookEvent(req: Request, res: Response): void {
  res.sendStatus(200);

  const payload = req.body as FbWebhookPayload;
  if (payload?.object !== 'page') return;

  for (const entry of payload.entry ?? []) {
    const pageId = entry.id;
    for (const event of entry.messaging ?? []) {
      fbChatQueue
        .add('process', { event, pageId })
        .then((job) => {
          logger.info('Facebook Webhook', 'enqueued', {
            jobId: job.id,
            pageId,
            psid: event.sender.id,
          });
        })
        .catch((err) => {
          logger.error('Facebook Webhook', 'failed to enqueue event', err);
        });
    }
  }
}

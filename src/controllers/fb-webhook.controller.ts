import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, ChannelStatus, ChannelType } from '../types';
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

interface FbMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: unknown[];
    quick_reply?: { payload: string };
  };
  postback?: { payload: string; title: string };
}

interface FbWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    messaging: FbMessagingEvent[];
  }>;
}

const SESSION_TTL = 86400; // 24 hours
const RESET_KEYWORDS = ['đổi chi nhánh', 'chọn lại chi nhánh', 'change branch'];
const CAFE_SELECT_PREFIX = 'CAFE_SELECT:';

function sessionKey(pageId: string, psid: string): string {
  return `fb:cafe-session:${pageId}:${psid}`;
}

// All cafes belonging to the same provider who owns this page
async function getCafesForPage(pageId: string): Promise<{ id: string; name: string }[]> {
  return AppDataSource.query<{ id: string; name: string }[]>(
    `SELECT c.id, c.name
     FROM cafes c
     WHERE c.provider_id = (
       SELECT ca.provider_id FROM cafes ca
       JOIN cafe_channels ch ON ch.cafe_id::uuid = ca.id
       WHERE ch.page_id = $1
         AND ch.channel_type = 'FACEBOOK_MESSENGER'
         AND ch.status = 'CONNECTED'
         AND ch.deleted_at IS NULL
       LIMIT 1
     )
     AND c.deleted_at IS NULL
     ORDER BY c.name`,
    [pageId],
  );
}

async function sendCafeSelection(
  psid: string,
  cafes: { id: string; name: string }[],
  pageToken: string,
): Promise<void> {
  await sendMessage(
    psid,
    {
      text: 'Xin chào! Vui lòng chọn chi nhánh bạn muốn hỏi:',
      quickReplies: cafes.slice(0, 13).map((c) => ({
        // FB limit: max 13 quick replies
        content_type: 'text' as const,
        title: c.name.slice(0, 20), // FB limit: 20 chars per title
        payload: `${CAFE_SELECT_PREFIX}${c.id}`,
      })),
    },
    pageToken,
  );
}

async function processEvent(event: FbMessagingEvent, pageId: string): Promise<void> {
  if (event.message?.is_echo) return;
  if (!event.message?.text && !event.postback) return;

  const psid = event.sender.id;

  // Resolve channel — needed for pageToken regardless of flow
  const channel = await AppDataSource.getRepository(CafeChannel).findOne({
    where: { pageId, channelType: ChannelType.FACEBOOK_MESSENGER, status: ChannelStatus.CONNECTED },
  });
  if (!channel) {
    logger.warn('Facebook Webhook', 'unknown page_id', { pageId });
    return;
  }
  const pageToken = decryptToken(channel.encryptedPageToken, env.facebook.encryptionKey as Buffer);

  // ── Handle postback (e.g. persistent menu buttons) ──────────────────────────
  if (event.postback) {
    const payload = event.postback.payload;
    if (payload.startsWith(CAFE_SELECT_PREFIX)) {
      await handleCafeSelect(psid, payload.slice(CAFE_SELECT_PREFIX.length), pageId, pageToken);
    }
    return;
  }

  const text = event.message!.text!;
  const mid = event.message!.mid;
  const quickReplyPayload = event.message?.quick_reply?.payload;

  // Dedup by message mid
  const dedup = await redis.set(`facebook:processed:${pageId}:${mid}`, '1', 'EX', 300, 'NX');
  if (!dedup) return;

  // ── Handle cafe selection quick reply ────────────────────────────────────────
  if (quickReplyPayload?.startsWith(CAFE_SELECT_PREFIX)) {
    await handleCafeSelect(
      psid,
      quickReplyPayload.slice(CAFE_SELECT_PREFIX.length),
      pageId,
      pageToken,
    );
    return;
  }

  // ── Resolve cafeId from session ──────────────────────────────────────────────
  const key = sessionKey(pageId, psid);
  const isReset = RESET_KEYWORDS.some((k) => text.toLowerCase().includes(k));

  if (isReset) {
    await redis.del(key);
    logger.info('Facebook Webhook', 'session reset by user', { pageId, psid });
  }

  let cafeId = isReset ? null : await redis.get(key);

  if (!cafeId) {
    const cafes = await getCafesForPage(pageId);

    if (!cafes.length) {
      logger.warn('Facebook Webhook', 'no cafes found for page', { pageId });
      return;
    }

    if (cafes.length === 1) {
      // Single branch — auto-select silently
      cafeId = cafes[0].id;
      await redis.set(key, cafeId, 'EX', SESSION_TTL);
      logger.info('Facebook Webhook', 'auto-selected single cafe', { cafeId, pageId, psid });
    } else {
      // Multiple branches — prompt user to choose
      await Promise.all([markSeen(psid, pageToken), sendCafeSelection(psid, cafes, pageToken)]);
      return;
    }
  }

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

async function handleCafeSelect(
  psid: string,
  cafeId: string,
  pageId: string,
  pageToken: string,
): Promise<void> {
  const cafeRows = await AppDataSource.query<{ name: string }[]>(
    `SELECT name FROM cafes WHERE id = $1 AND deleted_at IS NULL`,
    [cafeId],
  );
  if (!cafeRows.length) {
    await sendText(psid, 'Chi nhánh không tồn tại. Vui lòng thử lại.', pageToken);
    return;
  }

  await redis.set(sessionKey(pageId, psid), cafeId, 'EX', SESSION_TTL);
  await sendText(
    psid,
    `Đã chọn chi nhánh **${cafeRows[0].name}**. Bạn cần hỏi gì không?`,
    pageToken,
  );
  logger.info('Facebook Webhook', 'cafe selected', { cafeId, pageId, psid });
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
      processEvent(event, pageId).catch((err) => {
        logger.error('Facebook Webhook', 'unhandled error in processEvent', err);
      });
    }
  }
}

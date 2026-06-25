import { logger } from '../config/logger';
import { AppError, FbFormattedMessage } from '../types';

const FB_GRAPH = 'https://graph.facebook.com/v21.0';

async function sendSenderAction(
  psid: string,
  action: 'mark_seen' | 'typing_on' | 'typing_off',
  pageToken: string,
): Promise<void> {
  await fetch(`${FB_GRAPH}/me/messages?access_token=${pageToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: psid }, sender_action: action }),
  });
}

export async function markSeen(psid: string, pageToken: string): Promise<void> {
  await sendSenderAction(psid, 'mark_seen', pageToken);
}

export async function typingOn(psid: string, pageToken: string): Promise<void> {
  await sendSenderAction(psid, 'typing_on', pageToken);
}

export async function sendMessage(
  psid: string,
  formatted: FbFormattedMessage,
  pageToken: string,
): Promise<void> {
  const messagePayload: Record<string, unknown> =
    formatted.buttons && formatted.buttons.length > 0
      ? {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: formatted.text,
              buttons: formatted.buttons,
            },
          },
        }
      : { text: formatted.text };

  if (formatted.quickReplies.length > 0) {
    messagePayload.quick_replies = formatted.quickReplies;
  }

  const body: Record<string, unknown> = {
    recipient: { id: psid },
    messaging_type: 'RESPONSE',
    message: messagePayload,
  };

  const res = await fetch(`${FB_GRAPH}/me/messages?access_token=${pageToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    logger.error('FbMessenger', 'send failed', { psid, status: res.status, errorText });
    throw new AppError(`FB send failed: ${res.status}`, 502, 'FB_SEND_ERROR');
  }
}

export async function sendText(psid: string, text: string, pageToken: string): Promise<void> {
  await sendMessage(psid, { text, quickReplies: [] }, pageToken);
}

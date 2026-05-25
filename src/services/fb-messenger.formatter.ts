import { ChatResponse, FbFormattedMessage } from '../types';

const MAX_TEXT_LEN = 2000;
const MAX_QUICK_REPLIES = 5;
const MAX_TITLE_LEN = 20;

export class FbMessengerFormatter {
  static format(response: ChatResponse): FbFormattedMessage {
    const clean = this.stripMarkdown(response.answer);
    const text =
      clean.length > MAX_TEXT_LEN
        ? clean.substring(0, clean.lastIndexOf(' ', MAX_TEXT_LEN)) ||
          clean.substring(0, MAX_TEXT_LEN)
        : clean;

    const quickReplies = (response.quickReplies ?? []).slice(0, MAX_QUICK_REPLIES).map((title) => ({
      content_type: 'text' as const,
      title: title.substring(0, MAX_TITLE_LEN),
      payload: `QR_${title
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_')
        .substring(0, 900)}`,
    }));

    return { text, quickReplies };
  }

  private static stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/\*(.+?)\*/gs, '$1')
      .replace(/`{1,3}[\s\S]*?`{1,3}/g, (m) => m.replace(/`/g, '').trim())
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .trim();
  }
}

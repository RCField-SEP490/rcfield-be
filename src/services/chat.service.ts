import { DataSource } from 'typeorm';
import { GoogleGenAI } from '@google/genai';
import { AppDataSource } from '../config/database';
import { env } from '../config/env';
import { classifyIntent } from '../config/nlu';
import { logger } from '../config/logger';
import { AppError, ChatResponse, SlotItem } from '../types';
import { CafeWidgetConfig } from '../models/cafe-widget-config.entity';
import { kbService } from './kb.service';
import { ragCache } from './rag-cache';

const ai = new GoogleGenAI({ apiKey: env.ai.googleApiKey });

type ChatRoute = 'fast' | 'thanks' | 'farewell' | 'slot_check' | 'rag';

interface QuotaConfig {
  monthly_quota: number;
  used_this_month: number;
  quota_reset_day: number;
}

interface HistoryMessage {
  role: 'user' | 'model';
  content: string;
}

// Verifies feature flag AI_CHATBOT is enabled and quota not exceeded for the cafe
export async function checkGate(cafeId: string): Promise<void> {
  const ds: DataSource = AppDataSource;
  const rows = await ds.query<{ is_enabled: boolean; config: QuotaConfig }[]>(
    `SELECT is_enabled, config FROM feature_flags
     WHERE feature_key = 'AI_CHATBOT'
       AND entity_type = 'CAFE'
       AND entity_id = $1`,
    [cafeId],
  );

  if (!rows.length || !rows[0].is_enabled) {
    throw new AppError(
      'Dịch vụ AI chat chưa được kích hoạt cho chi nhánh này.',
      503,
      'AI_DISABLED',
    );
  }

  const cfg = rows[0].config as QuotaConfig;
  if (cfg.used_this_month >= cfg.monthly_quota) {
    throw new AppError('Gói AI của chi nhánh đã hết lượt tháng này.', 429, 'QUOTA_EXCEEDED');
  }
}

// Increments used_this_month after a successful chat request
export async function incrementQuota(cafeId: string): Promise<void> {
  const ds: DataSource = AppDataSource;
  await ds.query(
    `UPDATE feature_flags
     SET config = jsonb_set(config, '{used_this_month}', ((config->>'used_this_month')::int + 1)::text::jsonb)
     WHERE feature_key = 'AI_CHATBOT'
       AND entity_type = 'CAFE'
       AND entity_id = $1`,
    [cafeId],
  );
}

// Classifies message intent and returns routing decision + confidence
export async function route(message: string): Promise<{ route: ChatRoute; confidence: number }> {
  const nlu = await classifyIntent(message);
  logger.info('Chat', 'intent classified', { intent: nlu.intent, confidence: nlu.confidence });

  if (nlu.intent === 'greeting' && !nlu.needs_llm_fallback && nlu.confidence >= 0.6) {
    return { route: 'fast', confidence: nlu.confidence };
  }
  if (nlu.intent === 'thanks' && !nlu.needs_llm_fallback && nlu.confidence >= 0.6) {
    return { route: 'thanks', confidence: nlu.confidence };
  }
  if (nlu.intent === 'farewell' && !nlu.needs_llm_fallback && nlu.confidence >= 0.6) {
    return { route: 'farewell', confidence: nlu.confidence };
  }
  if (nlu.intent === 'slot_check' && !nlu.needs_llm_fallback && nlu.confidence >= 0.6) {
    return { route: 'slot_check', confidence: nlu.confidence };
  }
  // needs_llm_fallback=true means NLU is uncertain → force Pro model (confidence=0)
  return { route: 'rag', confidence: nlu.needs_llm_fallback ? 0 : nlu.confidence };
}

// Returns immediate greeting response from widget config without calling any external service
export async function fastAnswer(cafeId: string): Promise<ChatResponse> {
  const ds: DataSource = AppDataSource;
  const config = await ds.getRepository(CafeWidgetConfig).findOne({ where: { cafeId } });

  const greetingMessage = config?.greetingMessage ?? 'Xin chào! Tôi có thể giúp gì cho bạn?';
  const quickReplies = config?.quickReplies ?? [];

  return {
    answer: greetingMessage,
    responseType: 'greeting',
    quickReplies,
  };
}

export function thanksAnswer(): ChatResponse {
  const replies = [
    'Không có gì! Nếu cần thêm thông tin gì cứ hỏi nhé 😊',
    'Rất vui được giúp bạn! Có gì cần thêm không?',
    'Dạ không có chi! Bạn cần hỏi thêm gì nữa không?',
  ];
  return {
    answer: replies[Math.floor(Math.random() * replies.length)],
    responseType: 'thanks',
    quickReplies: ['Hỏi về giá', 'Kiểm tra lịch trống', 'Xem dịch vụ'],
  };
}

export function farewellAnswer(): ChatResponse {
  const replies = [
    'Tạm biệt bạn! Hẹn gặp lại tại sân xe RC nhé 🏎️',
    'Bye bạn! Mong sớm được phục vụ bạn.',
    'Tạm biệt! Chúc bạn một ngày vui vẻ 😊',
  ];
  return {
    answer: replies[Math.floor(Math.random() * replies.length)],
    responseType: 'farewell',
    quickReplies: [],
  };
}

// Parses Vietnamese date expressions from message text
export function parseDate(message: string): Date {
  const lower = message.toLowerCase();
  const today = new Date();

  if (lower.includes('ngày mai') || lower.includes('tomorrow')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow;
  }

  // Match "thứ X" where X is 2-8 (Vietnamese weekdays: thứ 2=Monday ... thứ 8=Sunday)
  const thuMatch = lower.match(/thứ\s*([2-8])/);
  if (thuMatch) {
    const thuNum = parseInt(thuMatch[1], 10);
    // thứ 2=Mon(1), thứ 3=Tue(2), ..., thứ 7=Sat(6), chủ nhật/thứ 8=Sun(0)
    const targetDay = thuNum === 8 ? 0 : thuNum - 1;
    const result = new Date(today);
    const currentDay = result.getDay();
    let daysAhead = targetDay - currentDay;
    if (daysAhead <= 0) daysAhead += 7;
    result.setDate(today.getDate() + daysAhead);
    return result;
  }

  if (lower.includes('cuối tuần')) {
    const result = new Date(today);
    const day = result.getDay();
    const daysToSat = day === 6 ? 7 : 6 - day;
    result.setDate(today.getDate() + daysToSat);
    return result;
  }

  // Default to today
  return today;
}

// Queries bookings table for available slots and returns slot_list response
export async function slotCheck(cafeId: string, message: string): Promise<ChatResponse> {
  const ds: DataSource = AppDataSource;
  const date = parseDate(message);
  const dateStr = date.toISOString().split('T')[0];

  // Get cafe max_concurrent_bookings
  const cafeRows = await ds.query<{ max_concurrent_bookings: number; name: string }[]>(
    `SELECT max_concurrent_bookings, name FROM cafes WHERE id = $1`,
    [cafeId],
  );
  if (!cafeRows.length) {
    throw new AppError('Cafe not found', 404, 'CAFE_NOT_FOUND');
  }
  const maxConcurrent = cafeRows[0].max_concurrent_bookings ?? 3;

  const rows = await ds.query<{ slot_time: Date; available_count: number }[]>(
    `SELECT
       gs.slot_time,
       $2::int - COUNT(b.id) AS available_count
     FROM generate_series(
       $3::date,
       $3::date + interval '1 day' - interval '30 minutes',
       interval '30 minutes'
     ) AS gs(slot_time)
     LEFT JOIN bookings b
       ON b.cafe_id = $1
       AND b.status IN ('PENDING', 'CONFIRMED')
       AND b.slot_start <= gs.slot_time
       AND b.slot_end > gs.slot_time
     GROUP BY gs.slot_time
     HAVING ($2::int - COUNT(b.id)) > 0
     ORDER BY gs.slot_time`,
    [cafeId, maxConcurrent, dateStr],
  );

  const slots: SlotItem[] = rows.map((r) => ({
    time: new Date(r.slot_time).toTimeString().slice(0, 5),
    availableCount: Number(r.available_count),
  }));

  if (!slots.length) {
    return {
      answer: `Rất tiếc, ngày ${dateStr} không còn slot trống. Bạn có muốn xem ngày khác không?`,
      responseType: 'slot_list',
      data: { date: dateStr, slots: [] },
      quickReplies: ['Xem ngày mai', 'Xem cuối tuần'],
    };
  }

  return {
    answer: `Ngày ${dateStr} còn ${slots.length} khung giờ trống bạn nhé!`,
    responseType: 'slot_list',
    data: { date: dateStr, slots },
    quickReplies: ['Đặt lịch ngay', 'Xem ngày khác'],
  };
}

// Generates 3 contextual quick-reply suggestions using Flash (called in parallel with main stream)
async function generateQuickReplies(message: string, cafeName: string): Promise<string[]> {
  try {
    const response = await ai.models.generateContent({
      model: env.ai.model,
      contents: `Khách hỏi cafe xe RC "${cafeName}": "${message}"
Tạo đúng 3 câu hỏi gợi ý ngắn (tối đa 8 từ tiếng Việt) liên quan mà khách có thể muốn hỏi tiếp.
Chỉ trả về JSON array, không markdown: ["câu 1", "câu 2", "câu 3"]`,
    });
    const text = (response.text ?? '').trim().replace(/^```json\n?|```\n?$/g, '');
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length >= 2) return parsed.slice(0, 3);
  } catch {
    // fall through to defaults
  }
  return ['Hỏi thêm về dịch vụ', 'Kiểm tra lịch trống', 'Xem bảng giá'];
}

function buildSystemPrompt(
  cafe: { name: string; address: string | null; operating_hours: unknown },
  chunks: string[],
  customSystemPrompt?: string | null,
): string {
  const parts: string[] = [];

  if (customSystemPrompt?.trim()) {
    parts.push(customSystemPrompt.trim());
    parts.push('---');
  }

  parts.push(`Bạn là trợ lý AI của cafe xe RC "${cafe.name}".`);
  parts.push(
    `Chỉ trả lời dựa trên thông tin dưới đây. Nếu không có thông tin, nói thẳng là không biết và gợi ý liên hệ trực tiếp chi nhánh.`,
  );
  parts.push(`Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng.`);
  parts.push(
    `Nếu các tài liệu có thông tin mâu thuẫn nhau, ưu tiên tài liệu có ngày cập nhật mới hơn.`,
  );
  parts.push('');
  parts.push(`Thông tin chi nhánh:`);
  parts.push(`- Địa chỉ: ${cafe.address ?? 'Chưa cập nhật'}`);
  parts.push(`- Giờ mở cửa: ${JSON.stringify(cafe.operating_hours ?? {})}`);
  parts.push('');
  parts.push(`Knowledge base:`);
  parts.push(chunks.length ? chunks.join('\n---\n') : '(Chưa có tài liệu knowledge base)');

  return parts.join('\n');
}

// Rephrases a cached answer using Flash so repeated questions feel natural, not robotic
async function rephraseAnswer(answer: string, cafeId?: string): Promise<string> {
  logger.info('RAG', `cache rephrase via ${env.ai.model}`, { cafeId });
  try {
    const response = await ai.models.generateContent({
      model: env.ai.model,
      contents: `Câu trả lời gốc: "${answer}"
Viết lại câu này với cách diễn đạt khác nhưng giữ nguyên đầy đủ thông tin. Ngắn gọn, tự nhiên, bằng tiếng Việt.
Chỉ trả về câu viết lại, không thêm tiêu đề hay giải thích.`,
    });
    return (response.text ?? '').trim() || answer;
  } catch (err) {
    logger.warn('RAG', 'rephrase failed, returning original', err);
    return answer;
  }
}

// Embeds the message, retrieves relevant KB chunks, and generates answer via Gemini 2.0 Flash
export async function ragChat(
  cafeId: string,
  message: string,
  history: HistoryMessage[],
  nluConfidence = 0,
): Promise<ChatResponse> {
  const ds: DataSource = AppDataSource;

  const queryEmbedding = await kbService.embedText(message);

  const cached = ragCache.get(cafeId, queryEmbedding);
  if (cached) {
    const answer = await rephraseAnswer(cached.answer, cafeId);
    return {
      answer,
      responseType: 'text',
      sources: cached.sources,
      quickReplies: cached.quickReplies,
    };
  }

  const [cafeRows, docRows, widgetConfig] = await Promise.all([
    ds.query<{ name: string; address: string; operating_hours: unknown }[]>(
      `SELECT name, address, operating_hours FROM cafes WHERE id = $1`,
      [cafeId],
    ),
    ds.query<{ title: string }[]>(
      `SELECT DISTINCT d.title FROM kb_chunks c
       JOIN kb_documents d ON c.document_id = d.id
       WHERE c.cafe_id = $1 AND d.deleted_at IS NULL`,
      [cafeId],
    ),
    ds.getRepository(CafeWidgetConfig).findOne({ where: { cafeId } }),
  ]);

  if (!cafeRows.length) throw new AppError('Cafe not found', 404, 'CAFE_NOT_FOUND');
  const cafe = cafeRows[0];
  const sources = docRows.map((r) => r.title);

  const chunks = await kbService.retrieveChunks(ds, cafeId, queryEmbedding);

  const systemPrompt = buildSystemPrompt(cafe, chunks, widgetConfig?.systemPrompt);

  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const selectedModel = nluConfidence >= 0.7 ? env.ai.model : env.ai.supportModel;
  logger.info('Chat', `model selected: ${selectedModel}`, { cafeId, nluConfidence });

  try {
    const [response, quickReplies] = await Promise.all([
      ai.models.generateContent({
        model: selectedModel,
        config: { systemInstruction: systemPrompt },
        contents,
      }),
      generateQuickReplies(message, cafe.name),
    ]);
    const answer = response.text ?? '';

    ragCache.set(cafeId, message, queryEmbedding, answer, sources, quickReplies);
    return { answer, responseType: 'text', sources, quickReplies };
  } catch (err) {
    logger.error('Chat', 'Gemini error', err);
    throw new AppError(
      'Trợ lý tạm thời không khả dụng, vui lòng thử lại sau.',
      503,
      'AI_UNAVAILABLE',
    );
  }
}

export async function ragChatStream(
  cafeId: string,
  message: string,
  history: HistoryMessage[],
  _nluConfidence = 0,
): Promise<{
  stream: AsyncGenerator<string>;
  sources: string[];
  quickRepliesPromise: Promise<string[]>;
}> {
  const ds: DataSource = AppDataSource;
  const t = () => `+${Date.now() - t0}ms`;
  const t0 = Date.now();

  logger.info('RAG', 'Embed: ', { cafeId });
  const queryEmbedding = await kbService.embedText(message);
  logger.info('RAG', `Embed done (${queryEmbedding.length} dims)  ${t()}`, { cafeId });

  const cached = ragCache.get(cafeId, queryEmbedding);
  if (cached) {
    const hit = cached;
    async function* cachedStream(): AsyncGenerator<string> {
      logger.info('RAG', `cache rephrase stream via ${env.ai.model}`, { cafeId });
      try {
        const stream = await ai.models.generateContentStream({
          model: env.ai.model,
          contents: `Câu trả lời gốc: "${hit.answer}"
Viết lại câu này với cách diễn đạt khác nhưng giữ nguyên đầy đủ thông tin. Ngắn gọn, tự nhiên, bằng tiếng Việt.
Chỉ trả về câu viết lại, không thêm tiêu đề hay giải thích.`,
        });
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) yield text;
        }
      } catch {
        yield hit.answer;
      }
    }
    return {
      stream: cachedStream(),
      sources: hit.sources,
      quickRepliesPromise: Promise.resolve(hit.quickReplies),
    };
  }

  const [cafeRows, docRows, widgetConfig] = await Promise.all([
    ds.query<{ name: string; address: string; operating_hours: unknown }[]>(
      `SELECT name, address, operating_hours FROM cafes WHERE id = $1`,
      [cafeId],
    ),
    ds.query<{ title: string }[]>(
      `SELECT DISTINCT d.title FROM kb_chunks c
       JOIN kb_documents d ON c.document_id = d.id
       WHERE c.cafe_id = $1 AND d.deleted_at IS NULL`,
      [cafeId],
    ),
    ds.getRepository(CafeWidgetConfig).findOne({ where: { cafeId } }),
  ]);

  if (!cafeRows.length) throw new AppError('Cafe not found', 404, 'CAFE_NOT_FOUND');
  const cafe = cafeRows[0];
  const sources = docRows.map((r) => r.title);

  logger.info('RAG', `Pgvector retrieval...  ${t()}`, { cafeId });
  const chunks = await kbService.retrieveChunks(ds, cafeId, queryEmbedding);
  logger.info('RAG', `Retrieved ${chunks.length} chunk(s)  ${t()}`, { cafeId, sources });

  const systemPrompt = buildSystemPrompt(cafe, chunks, widgetConfig?.systemPrompt);

  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const selectedModel = env.ai.model;
  logger.info('RAG', `Calling ${selectedModel} Streaming  ${t()}`, { cafeId });

  // Fire quick-replies generation in background — do NOT await before streaming starts
  const quickRepliesPromise = generateQuickReplies(message, cafe.name);
  const stream = await ai.models.generateContentStream({
    model: selectedModel,
    config: { systemInstruction: systemPrompt },
    contents,
  });

  let firstToken = true;
  async function* tokenStream(): AsyncGenerator<string> {
    let fullAnswer = '';
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        if (firstToken) {
          logger.info('RAG', `First token  ${t()}`, { cafeId });
          firstToken = false;
        }
        fullAnswer += text;
        yield text;
      }
    }
    logger.info('RAG', `Stream complete  ${t()}`, { cafeId });
    const quickReplies = await quickRepliesPromise;
    ragCache.set(cafeId, message, queryEmbedding, fullAnswer, sources, quickReplies);
  }

  return { stream: tokenStream(), sources, quickRepliesPromise };
}

// Widget config helpers used by controller
export async function getWidgetConfigForCafe(cafeId: string): Promise<CafeWidgetConfig | null> {
  return AppDataSource.getRepository(CafeWidgetConfig).findOne({ where: { cafeId } });
}

export async function upsertWidgetConfig(
  cafeId: string,
  updates: Partial<{
    greetingMessage: string;
    position: string;
    primaryColor: string;
    avatarUrl: string | null;
    quickReplies: string[];
    systemPrompt: string | null;
  }>,
): Promise<CafeWidgetConfig> {
  const ds: DataSource = AppDataSource;

  const setParts: string[] = [];
  if (updates.greetingMessage !== undefined)
    setParts.push(`greeting_message = EXCLUDED.greeting_message`);
  if (updates.position !== undefined) setParts.push(`position = EXCLUDED.position`);
  if (updates.primaryColor !== undefined) setParts.push(`primary_color = EXCLUDED.primary_color`);
  if (updates.avatarUrl !== undefined) setParts.push(`avatar_url = EXCLUDED.avatar_url`);
  if (updates.quickReplies !== undefined) setParts.push(`quick_replies = EXCLUDED.quick_replies`);
  if (updates.systemPrompt !== undefined) setParts.push(`system_prompt = EXCLUDED.system_prompt`);

  const setClause = setParts.length ? `, ${setParts.join(', ')}` : '';

  await ds.query(
    `INSERT INTO cafe_widget_configs (cafe_id, greeting_message, position, primary_color, avatar_url, quick_replies, system_prompt)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (cafe_id) DO UPDATE SET updated_at = now()${setClause}`,
    [
      cafeId,
      updates.greetingMessage ?? 'Xin chào! Tôi có thể giúp gì cho bạn?',
      updates.position ?? 'BOTTOM_RIGHT',
      updates.primaryColor ?? '#2563EB',
      updates.avatarUrl ?? null,
      JSON.stringify(updates.quickReplies ?? []),
      updates.systemPrompt ?? null,
    ],
  );

  const config = await ds.getRepository(CafeWidgetConfig).findOne({ where: { cafeId } });
  return config!;
}

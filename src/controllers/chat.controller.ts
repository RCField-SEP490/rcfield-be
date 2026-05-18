import { Request, Response, NextFunction } from 'express';
import { AppError, AuthRequest } from '../types';
import { ChatMessageSchema, WidgetConfigSchema } from '../validate';
import { env } from '../config/env';
import {
  checkGate,
  incrementQuota,
  route,
  fastAnswer,
  thanksAnswer,
  farewellAnswer,
  slotCheck,
  ragChat,
  ragChatStream,
  getWidgetConfigForCafe,
  upsertWidgetConfig,
} from '../services/chat.service';
import { logger } from '../config/logger';

const DEFAULT_CONFIG = {
  greeting_message: 'Xin chào! Tôi có thể giúp gì cho bạn?',
  position: 'bottom-right',
  primary_color: '#2563EB',
  avatar_url: null,
  quick_replies: [] as string[],
  is_default: true,
};

// POST /api/v1/cafes/:cafeId/chat
export async function chat(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { cafeId } = req.params;

    const parsed = ChatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'));
    }

    const { message, history } = parsed.data;

    logger.info('Chat', 'request', { cafeId, message });

    await checkGate(cafeId);

    const { route: chatRoute, confidence } = await route(message);
    const modelUsed =
      chatRoute === 'rag' ? (confidence >= 0.7 ? env.ai.supportModel : env.ai.model) : '(no LLM)';
    logger.info('Chat', `route → ${chatRoute}  model: ${modelUsed}`, { cafeId });

    const t0 = Date.now();
    let response;
    if (chatRoute === 'fast') {
      response = await fastAnswer(cafeId);
    } else if (chatRoute === 'thanks') {
      response = thanksAnswer();
    } else if (chatRoute === 'farewell') {
      response = farewellAnswer();
    } else if (chatRoute === 'slot_check') {
      response = await slotCheck(cafeId, message);
    } else {
      response = await ragChat(cafeId, message, history, confidence);
    }
    logger.info('Chat', `done in ${Date.now() - t0}ms`, {
      cafeId,
      responseType: response.responseType,
    });

    await incrementQuota(cafeId);

    res.json({
      answer: response.answer,
      response_type: response.responseType,
      ...(response.data !== undefined && { data: response.data }),
      ...(response.sources !== undefined && { sources: response.sources }),
      ...(response.quickReplies !== undefined && { quick_replies: response.quickReplies }),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/cafes/:cafeId/chat/stream  — SSE streaming
export async function chatStream(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { cafeId } = req.params;

    const parsed = ChatMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'));
    }

    const { message, history } = parsed.data;

    await checkGate(cafeId);

    const { route: chatRoute, confidence } = await route(message);
    logger.info('Chat', `stream route → ${chatRoute}`, { cafeId, message });

    // Non-RAG routes: return JSON immediately (no streaming needed)
    if (chatRoute !== 'rag') {
      let response;
      if (chatRoute === 'fast') response = await fastAnswer(cafeId);
      else if (chatRoute === 'thanks') response = thanksAnswer();
      else if (chatRoute === 'farewell') response = farewellAnswer();
      else response = await slotCheck(cafeId, message);
      await incrementQuota(cafeId);
      res.json({
        answer: response.answer,
        response_type: response.responseType,
        ...(response.data !== undefined && { data: response.data }),
        ...(response.quickReplies !== undefined && { quick_replies: response.quickReplies }),
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const t0 = Date.now();
    const { stream, sources, quickReplies } = await ragChatStream(
      cafeId,
      message,
      history,
      confidence,
    );

    let fullAnswer = '';
    for await (const token of stream) {
      fullAnswer += token;
      send('chunk', { text: token });
    }

    await incrementQuota(cafeId);
    logger.info('Chat', `stream done in ${Date.now() - t0}ms`, { cafeId });
    logger.info('Chat', `answer: "${fullAnswer}"`, { cafeId });

    send('done', {
      response_type: 'text',
      sources,
      quick_replies: quickReplies,
      full_answer: fullAnswer,
    });
    res.end();
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/cafes/:cafeId/chat/config
export async function getWidgetConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { cafeId } = req.params;
    const config = await getWidgetConfigForCafe(cafeId);

    if (!config) {
      res.json(DEFAULT_CONFIG);
      return;
    }

    res.json({
      greeting_message: config.greetingMessage,
      position: config.position.toLowerCase().replace('_', '-'),
      primary_color: config.primaryColor,
      avatar_url: config.avatarUrl,
      quick_replies: config.quickReplies,
      is_default: false,
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/v1/cafes/:cafeId/chat/config  [auth]
export async function updateWidgetConfig(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { cafeId } = req.params;
    const providerId = req.user!.userId;

    const { AppDataSource } = await import('../config/database');
    const cafeRows = await AppDataSource.query<{ provider_id: string }[]>(
      `SELECT provider_id FROM cafes WHERE id = $1`,
      [cafeId],
    );
    if (!cafeRows.length) {
      return next(new AppError('Cafe không tồn tại.', 404, 'CAFE_NOT_FOUND'));
    }
    if (cafeRows[0].provider_id !== providerId) {
      return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
    }

    const parsed = WidgetConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'));
    }

    const body = parsed.data;
    const config = await upsertWidgetConfig(cafeId, {
      ...(body.greeting_message !== undefined && { greetingMessage: body.greeting_message }),
      ...(body.position !== undefined && { position: body.position }),
      ...(body.primary_color !== undefined && { primaryColor: body.primary_color }),
      ...(body.avatar_url !== undefined && { avatarUrl: body.avatar_url }),
      ...(body.quick_replies !== undefined && { quickReplies: body.quick_replies }),
    });

    res.json({
      greeting_message: config.greetingMessage,
      position: config.position.toLowerCase().replace('_', '-'),
      primary_color: config.primaryColor,
      avatar_url: config.avatarUrl,
      quick_replies: config.quickReplies,
      is_default: false,
    });
  } catch (err) {
    next(err);
  }
}

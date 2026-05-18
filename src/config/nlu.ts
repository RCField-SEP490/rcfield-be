import { logger } from './logger';

const NLU_URL = process.env.NLU_SERVICE_URL ?? 'http://nlu-service:8000';
const NLU_TIMEOUT = parseInt(process.env.NLU_TIMEOUT_MS ?? '2000', 10);

export interface NluResult {
  intent: string;
  confidence: number;
  needs_llm_fallback: boolean;
}

const FALLBACK: NluResult = { intent: 'rag_query', confidence: 0, needs_llm_fallback: false };

export async function classifyIntent(text: string): Promise<NluResult> {
  logger.info('NLU', `→ "${text}"`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NLU_TIMEOUT);
  try {
    const res = await fetch(`${NLU_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    const result = (await res.json()) as NluResult;
    logger.info(
      'NLU',
      `← ${result.intent} (${result.confidence})${result.needs_llm_fallback ? ' [fallback]' : ''}`,
    );
    return result;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    logger.warn(
      'NLU',
      isTimeout
        ? `timeout after ${NLU_TIMEOUT}ms — is NLU running? (npm run nlu) — falling back to rag_query`
        : `unreachable at ${NLU_URL} — is NLU running? (npm run nlu) — falling back to rag_query`,
    );
    return FALLBACK;
  } finally {
    clearTimeout(timer);
  }
}

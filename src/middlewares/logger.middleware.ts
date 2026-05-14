import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

const SENSITIVE = new Set(['password', 'token', 'refresh_token', 'id_token', 'access_token']);

function maskBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE.has(k) ? '********' : v,
    ]),
  );
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const hasBody =
    ['POST', 'PUT', 'PATCH'].includes(req.method) &&
    req.body &&
    Object.keys(req.body).length > 0;

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const ms = Date.now() - start;
    const status = res.statusCode;

    const entry: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      status,
    };

    if (hasBody) entry.body = maskBody(req.body);

    if (status >= 400 && body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      entry.error = { code: b.code, message: b.message };
      if (b.errors) entry.errors = b.errors;
    }

    if (status >= 500)      logger.error('request', entry);
    else if (status >= 400) logger.warn('request', entry);
    else                    logger.http('request', entry);

    return originalJson(body);
  };

  next();
}

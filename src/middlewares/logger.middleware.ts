import { Request, Response, NextFunction } from 'express';

const SENSITIVE = new Set(['password', 'token', 'refresh_token', 'id_token', 'access_token']);

function maskBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE.has(k) ? '***' : v,
    ]),
  );
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0;

  // Override res.json to capture response body
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';

    console.log(`\n[${timestamp()}] ${req.method} ${req.path}`);
    if (hasBody) {
      console.log(`  Body:`, maskBody(req.body));
    }

    if (status >= 400 && body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      console.log(`  ${color}→ ${status}${reset} ${b.code ?? ''} ${b.message ? `"${b.message}"` : ''} (${ms}ms)`);
      if (b.errors) console.log(`  Errors:`, b.errors);
    } else {
      console.log(`  ${color}→ ${status}${reset} (${ms}ms)`);
    }

    return originalJson(body);
  };

  next();
}

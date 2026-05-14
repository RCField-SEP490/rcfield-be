import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { env } from '../config/env';

// ── ANSI color helpers ────────────────────────────────────────────────────────
const c = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  // text
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  green:   '\x1b[32m',
  cyan:    '\x1b[36m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
};

function colorMethod(method: string): string {
  const map: Record<string, string> = {
    GET:    c.green,
    POST:   c.cyan,
    PUT:    c.yellow,
    PATCH:  c.magenta,
    DELETE: c.red,
  };
  return `${c.bold}${map[method] ?? c.white}${method}${c.reset}`;
}

function colorStatus(status: number): string {
  const color = status >= 500 ? c.red : status >= 400 ? c.yellow : c.green;
  return `${c.bold}${color}${status}${c.reset}`;
}

function key(label: string): string {
  return `${c.white}${label}${c.reset}`;
}

function colorJson(obj: unknown, baseIndent = '  '): string {
  return JSON.stringify(obj, null, 2)
    .split('\n')
    .map((line, i) => {
      if (i === 0) return line;
      // "key": value
      const match = line.match(/^(\s*)("[\w@.-]+")(:\s*)(.+)$/);
      if (match) {
        const [, space, k, colon, val] = match;
        const valColor = val.includes('********') ? c.yellow : c.gray;
        return baseIndent + space + c.white + k + c.reset + c.dim + colon + c.reset + valColor + val + c.reset;
      }
      return baseIndent + c.dim + line + c.reset;
    })
    .join('\n');
}

// ── Body masking ──────────────────────────────────────────────────────────────
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

function indent(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n');
}

// ── Middleware ────────────────────────────────────────────────────────────────
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const isProd = env.NODE_ENV === 'production';
  const start = Date.now();
  const hasBody =
    ['POST', 'PUT', 'PATCH'].includes(req.method) &&
    req.body &&
    Object.keys(req.body).length > 0;

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const ms = Date.now() - start;
    const status = res.statusCode;

    if (isProd) {
      // Production: plain JSON one-liner for log aggregators
      const meta: Record<string, unknown> = { method: req.method, path: req.path, status, ms };
      if (hasBody) meta.body = maskBody(req.body);
      if (status >= 400 && body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        meta.code = b.code;
        meta.message = b.message;
      }
      const msg = JSON.stringify(meta);
      if (status >= 500)      logger.error(msg);
      else if (status >= 400) logger.warn(msg);
      else                    logger.http(msg);
      return originalJson(body);
    }

    // Development: colored multi-line
    const lines: string[] = [
      `${colorMethod(req.method)} ${c.white}${req.path}${c.reset}`,
    ];

    if (hasBody) {
      lines.push(`  ${key('body: ')} ${colorJson(maskBody(req.body))}`);
    }

    if (status >= 400 && body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      lines.push(`  ${key('status:  ')} ${colorStatus(status)} ${c.yellow}${b.code ?? ''}${c.reset}`);
      if (b.message) lines.push(`  ${key('message: ')} ${c.yellow}"${b.message}"${c.reset}`);
      if (b.errors)  lines.push(`  ${key('errors:  ')} ${c.dim}${indent(b.errors)}${c.reset}`);
    } else {
      lines.push(`  ${key('status: ')} ${colorStatus(status)}`);
    }

    const msg = '\n' + lines.join('\n');

    if (status >= 500)      logger.error(msg);
    else if (status >= 400) logger.warn(msg);
    else                    logger.http(msg);

    return originalJson(body);
  };

  next();
}

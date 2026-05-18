import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AuthPayload } from '../types';

export class WebSocketService {
  private wss!: WebSocketServer;
  private clients = new Map<string, Set<WebSocket>>();

  init(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    logger.info('WebSocket', 'server started', { path: '/ws' });
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const token = new URL(req.url ?? '/', 'ws://host').searchParams.get('token');
    if (!token) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    try {
      const payload = jwt.verify(token, env.jwt.secret) as AuthPayload;
      const userId = payload.userId;
      if (!this.clients.has(userId)) this.clients.set(userId, new Set());
      this.clients.get(userId)!.add(ws);
      ws.on('close', () => this.clients.get(userId)?.delete(ws));
      logger.info('WebSocket', 'client connected', { userId });
    } catch {
      ws.close(4001, 'Invalid token');
    }
  }

  pushToUser(userId: string, event: string, data: unknown): void {
    const sockets = this.clients.get(userId);
    if (!sockets?.size) return;
    const payload = JSON.stringify({ event, data });
    sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    });
  }
}

export const wsService = new WebSocketService();

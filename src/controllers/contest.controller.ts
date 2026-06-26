import type { NextFunction, Response } from 'express';
import { AppError, AuthRequest, UserRole } from '../types';
import * as contestService from '../services/contest.service';
import * as auditService from '../services/contest-audit.service';
import {
  CafeIdParamsSchema,
  ContestIdParamsSchema,
  ContestListQuerySchema,
  CreateContestSchema,
  UpdateContestSchema,
} from '../validate';

function viewer(req: AuthRequest) {
  return req.user ? { userId: req.user.userId, role: req.user.role } : undefined;
}

function providerId(req: AuthRequest): string {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  if (req.user.role !== UserRole.PROVIDER) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  return req.user.userId;
}

function assertImageFile(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) {
    throw new AppError('File la bat buoc.', 400, 'FILE_REQUIRED');
  }

  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);
  if (!allowed.has(file.mimetype)) {
    throw new AppError('Chi ho tro anh JPG, PNG, WEBP.', 422, 'UNSUPPORTED_FORMAT');
  }
}

export const contestController = {
  // GET /api/v1/contests
  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = ContestListQuerySchema.parse(req.query);
      const result = await contestService.listContests(query, viewer(req));
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/contests
  async listByCafe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { cafeId } = CafeIdParamsSchema.parse(req.params);
      const query = ContestListQuerySchema.parse(req.query);
      const result = await contestService.listCafeContests(cafeId, query, viewer(req));
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id
  async detail(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const query = ContestListQuerySchema.parse(req.query);
      const data = await contestService.getContestDetail(
        id,
        viewer(req),
        query.notify_within_hours,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests [auth]
  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = CreateContestSchema.parse(req.body);
      const data = await contestService.createContest(providerId(req), body);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/banner [auth]
  async uploadBanner(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const file = req.file;
      assertImageFile(file);
      const data = await contestService.uploadContestBanner(id, providerId(req), file);
      res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/v1/contests/:id [auth]
  async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const body = UpdateContestSchema.parse(req.body);
      const data = await contestService.updateContest(id, providerId(req), body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/open [auth]
  async open(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await contestService.openContest(id, providerId(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/contests/:id/close [auth]
  async close(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await contestService.closeContest(id, providerId(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
  // POST /api/v1/contests/:id/cancel [auth]
  async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      const data = await contestService.cancelContest(id, providerId(req));
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id/audit-logs [auth]
  async listAuditLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const data = await auditService.listContestAuditLogs(id, {
        userId: req.user.userId,
        role: req.user.role,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/contests/:id/metrics [auth]
  async getMetrics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = ContestIdParamsSchema.parse(req.params);
      if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      const data = await auditService.getContestMetrics(id, {
        userId: req.user.userId,
        role: req.user.role,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

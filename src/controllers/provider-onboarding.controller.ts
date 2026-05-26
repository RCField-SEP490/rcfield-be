import { Request, Response, NextFunction } from 'express';
import { AppError, AuthRequest, ProviderStatus, UserRole } from '../types';
import { RegisterProviderSchema, AdminRejectSchema, AdminProviderQuerySchema } from '../validate';
import * as providerOnboardingService from '../services/provider-onboarding.service';

export const providerOnboardingController = {
  // POST /api/v1/auth/register-provider
  async registerProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = RegisterProviderSchema.parse(req.body);
      const user = await providerOnboardingService.register(body);
      res.status(201).json({ success: true, data: { id: user.id, email: user.email } });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/admin/providers  [auth]
  async getProviders(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = AdminProviderQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return next(new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'));
      }
      const { status, page, limit } = parsed.data;
      const result = await providerOnboardingService.listProviders({
        status: status as ProviderStatus | undefined,
        page,
        limit,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/admin/providers/:id  [auth]
  async getProviderDetail(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await providerOnboardingService.getProviderDetail(req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/admin/providers/:id/approve  [auth]
  async approveProvider(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await providerOnboardingService.approve(req.params.id, req.user!.userId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/admin/providers/:id/reject  [auth]
  async rejectProvider(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reason } = AdminRejectSchema.parse(req.body);
      await providerOnboardingService.reject(req.params.id, req.user!.userId, reason);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/admin/providers/:id/suspend  [auth]
  async suspendProvider(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reason } = AdminRejectSchema.parse(req.body);
      await providerOnboardingService.suspend(req.params.id, req.user!.userId, reason);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/admin/providers/:id/unsuspend  [auth]
  async unsuspendProvider(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await providerOnboardingService.unsuspend(req.params.id, req.user!.userId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/provider/me  [auth]
  async getProviderMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || req.user.role !== UserRole.PROVIDER) {
        return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
      }
      const data = await providerOnboardingService.getProviderDetail(req.user.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

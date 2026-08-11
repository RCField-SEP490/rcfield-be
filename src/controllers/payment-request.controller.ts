import { Response, NextFunction } from 'express';
import { AppError, AuthRequest, PaymentRequestStatus } from '../types';
import {
  SubmitPaymentRequestSchema,
  AdminRejectSchema,
  AdminPaymentRequestQuerySchema,
  AdminConfirmPaymentSchema,
} from '../validate';
import * as paymentRequestService from '../services/payment-request.service';
import * as subscriptionService from '../services/subscription.service';
import { AppDataSource } from '../config/database';
import { ProviderProfile } from '../models/provider-profile.entity';

export const paymentRequestController = {
  // GET /api/v1/provider/subscription  [auth]
  async getSubscriptionStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const providerId = req.user!.userId;
      const sub = await subscriptionService.getActive(providerId);

      // Trả kèm ở cấp ngoài chứ không nhét vào `data`: `getActive` trả null khi
      // gói đã hết hạn, mà đó lại đúng lúc giao diện cần biết suất dùng thử đã
      // tiêu hay chưa để khoá nút.
      const profile = await AppDataSource.getRepository(ProviderProfile).findOne({
        where: { userId: providerId },
      });

      res.json({
        success: true,
        data: sub,
        trial_used_at: profile?.trialUsedAt ?? null,
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/provider/payment-requests  [auth]
  async submitPaymentRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = SubmitPaymentRequestSchema.parse(req.body);
      const request = await paymentRequestService.submit(req.user!.userId, body);
      res.status(201).json({ success: true, data: request });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/provider/payment-requests  [auth]
  async listMyPaymentRequests(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
      const result = await paymentRequestService.listForProvider(req.user!.userId, { page, limit });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/admin/payment-requests  [auth]
  async listAllPaymentRequests(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = AdminPaymentRequestQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return next(new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'));
      }
      const { status, page, limit } = parsed.data;
      const result = await paymentRequestService.listAll({
        status: status as PaymentRequestStatus | undefined,
        page,
        limit,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/admin/payment-requests/:id/confirm  [auth]
  async confirmPaymentRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { notes } = AdminConfirmPaymentSchema.parse(req.body);
      await paymentRequestService.confirm(req.params.id, req.user!.userId, notes);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/admin/payment-requests/:id/reject  [auth]
  async rejectPaymentRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reason } = AdminRejectSchema.parse(req.body);
      await paymentRequestService.reject(req.params.id, req.user!.userId, reason);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};

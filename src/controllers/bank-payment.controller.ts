import type { NextFunction, Response } from 'express';
import * as bankTransactionService from '../services/bank-transaction.service';
import * as settingsService from '../services/cafe-payment-settings.service';
import { resolvePaymentMethodsForCafe } from '../services/payment-method-resolver';
import {
  AppError,
  AuthRequest,
  BankTransactionMatchStatus,
  CafePaymentMethod,
  UserRole,
} from '../types';
import {
  AssignBankTransactionSchema,
  IgnoreBankTransactionSchema,
  ListBankTransactionsQuerySchema,
  UpdateCafePaymentSettingsSchema,
} from '../validate';

function requireUser(req: AuthRequest) {
  if (!req.user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  return req.user;
}

export const bankPaymentController = {
  // GET /api/v1/cafes/:cafeId/payment-methods
  async listPaymentMethods(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const methods = await resolvePaymentMethodsForCafe(req.params.cafeId);
      res.json({ success: true, data: { methods } });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/payment-settings  [auth PROVIDER]
  async getSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const data = await settingsService.getSettings(req.params.cafeId, user.userId);
      // Chưa cấu hình trả `null` với 200 chứ không 404: "chưa khai" là trạng
      // thái hợp lệ của mọi chi nhánh, không phải lỗi.
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/payment-settings/edit  [auth PROVIDER]
  async getSettingsForEdit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const data = await settingsService.getSettingsForEdit(req.params.cafeId, user.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/v1/cafes/:cafeId/payment-settings  [auth PROVIDER]
  async updateSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const body = UpdateCafePaymentSettingsSchema.parse(req.body);
      const data = await settingsService.updateSettings(req.params.cafeId, user.userId, {
        method: body.method as CafePaymentMethod,
        bank_code: body.bank_code,
        account_number: body.account_number,
        account_name: body.account_name,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/payment-settings/sample-qr  [auth PROVIDER]
  async getSampleQr(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const data = await settingsService.buildSampleQr(req.params.cafeId, user.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/cafes/:cafeId/payment-settings/verify  [auth PROVIDER]
  async verifySettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const data = await settingsService.verifySettings(req.params.cafeId, user.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/bank-transactions  [auth PROVIDER]
  async listTransactions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const query = ListBankTransactionsQuerySchema.parse(req.query);
      const data = await bankTransactionService.listForOwner(req.params.cafeId, user.userId, {
        ...query,
        status: query.status as BankTransactionMatchStatus | undefined,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/v1/cafes/:cafeId/bank-transactions/pending  [auth PROVIDER|STAFF]
  async listPendingTransactions(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = requireUser(req);
      const data = await bankTransactionService.listPendingForOperator(req.params.cafeId, {
        userId: user.userId,
        role: user.role,
      });
      // Cố ý trả mảng phẳng: không có chỗ nào để lỡ tay nhét con số tổng vào
      // phản hồi mà nhân viên không được phép thấy.
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/bank-transactions/:id/assign  [auth PROVIDER|STAFF]
  async assignTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      const body = AssignBankTransactionSchema.parse(req.body);
      const data = await bankTransactionService.assignToBooking(
        req.params.id,
        { userId: user.userId, role: user.role },
        body,
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/bank-transactions/:id/ignore  [auth PROVIDER]
  async ignoreTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = requireUser(req);
      if (user.role !== UserRole.PROVIDER) {
        throw new AppError('Chỉ chủ chi nhánh mới bỏ qua được khoản tiền', 403, 'FORBIDDEN');
      }
      const body = IgnoreBankTransactionSchema.parse(req.body);
      const data = await bankTransactionService.markIgnored(req.params.id, user.userId, body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};

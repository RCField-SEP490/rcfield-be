import { Router } from 'express';
import { bankPaymentController } from '../controllers/bank-payment.controller';
import { authenticate, authorize, requireActiveProvider } from '../middlewares/auth.middleware';
import { UserRole } from '../types';

/**
 * Cấu hình nhận tiền và sổ đối soát ngân hàng.
 *
 * Phân quyền đặt ở tầng router (Nguyên tắc VI), và service còn kiểm quyền sở
 * hữu một lần nữa. Ranh giới quan trọng nhất ở đây:
 *
 * - Cấu hình tài khoản ngân hàng và sổ đầy đủ: **chỉ PROVIDER chủ sở hữu**.
 *   ADMIN cũng không vào được — nhất quán với quyết định rằng tài chính của
 *   chủ doanh nghiệp là riêng tư với nền tảng.
 * - Hàng đợi giao dịch treo: nhân viên được phân công vào được, vì họ là người
 *   đối mặt khách đang đứng chờ ở quầy.
 */

// Mount dưới `/cafes/:cafeId` nên cần mergeParams để đọc được `:cafeId`.
export const cafeBankPaymentRouter = Router({ mergeParams: true });

// Công khai: màn thanh toán cần biết có phải hiện lựa chọn phương thức không.
cafeBankPaymentRouter.get('/payment-methods', bankPaymentController.listPaymentMethods);

// ── Cấu hình nhận tiền — chỉ chủ chi nhánh ───────────────────────────────────

cafeBankPaymentRouter.get(
  '/payment-settings',
  authenticate,
  authorize(UserRole.PROVIDER),
  bankPaymentController.getSettings,
);

cafeBankPaymentRouter.get(
  '/payment-settings/edit',
  authenticate,
  authorize(UserRole.PROVIDER),
  bankPaymentController.getSettingsForEdit,
);

cafeBankPaymentRouter.put(
  '/payment-settings',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  bankPaymentController.updateSettings,
);

cafeBankPaymentRouter.get(
  '/payment-settings/sample-qr',
  authenticate,
  authorize(UserRole.PROVIDER),
  bankPaymentController.getSampleQr,
);

cafeBankPaymentRouter.post(
  '/payment-settings/verify',
  authenticate,
  authorize(UserRole.PROVIDER),
  requireActiveProvider,
  bankPaymentController.verifySettings,
);

// ── Sổ đối soát ──────────────────────────────────────────────────────────────

cafeBankPaymentRouter.get(
  '/bank-transactions',
  authenticate,
  authorize(UserRole.PROVIDER),
  bankPaymentController.listTransactions,
);

cafeBankPaymentRouter.get(
  '/bank-transactions/pending',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  bankPaymentController.listPendingTransactions,
);

// ── Thao tác trên một giao dịch (không nằm dưới :cafeId) ─────────────────────

export const bankTransactionRouter = Router();

bankTransactionRouter.post(
  '/:id/assign',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.STAFF),
  bankPaymentController.assignTransaction,
);

bankTransactionRouter.post(
  '/:id/ignore',
  authenticate,
  authorize(UserRole.PROVIDER),
  bankPaymentController.ignoreTransaction,
);

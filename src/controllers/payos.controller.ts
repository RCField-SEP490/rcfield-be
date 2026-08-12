/* eslint-disable no-console */
import { Request, Response, NextFunction } from 'express';
import * as payosService from '../services/payos.service';
import { AppDataSource } from '../config/database';
import { PaymentRequest } from '../models/payment-request.entity';
import { AppError } from '../types';

export const payosController = {
  /**
   * Xử lý webhook tự động từ PayOS gửi về khi trạng thái giao dịch thay đổi
   */
  async handleWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const webhookData = await payosService.verifyWebhookData(req.body);

      console.log('Received PayOS Webhook verified data:', webhookData);

      // Tìm PaymentRequest dựa trên orderCode lưu ở transferReference
      const repo = AppDataSource.getRepository(PaymentRequest);
      const request = await repo.findOne({
        where: { transferReference: String(webhookData.orderCode) },
      });

      if (request) {
        // Nếu giao dịch thành công (PayOS webhook data báo thành công)
        // Lưu ý: data của webhook có code hoặc success. Theo tài liệu PayOS, webhookData.code === "00" là thành công
        const isSuccess = webhookData.code === '00';

        if (isSuccess) {
          await payosService.handlePayOSPaid(request);
          console.log(`PaymentRequest ${request.id} paid via PayOS Webhook (pending approval)`);
        } else {
          const reason = `PayOS Webhook báo giao dịch thất bại. Code: ${webhookData.code}`;
          await payosService.handlePaymentFailed(request, reason);
          console.log(`PaymentRequest ${request.id} rejected via PayOS Webhook`);
        }
      } else {
        console.warn(`No PaymentRequest found matching PayOS orderCode: ${webhookData.orderCode}`);
      }

      // Luôn trả về phản hồi thành công theo đúng đặc tả của PayOS để dừng việc gửi lại webhook
      res.json({
        code: '00',
        desc: 'success',
        data: null,
      });
    } catch (err) {
      console.error('PayOS Webhook handling error:', err);
      // Mặc dù lỗi nhưng vẫn trả về code 00 cho PayOS để tránh việc họ retry liên tục làm treo hệ thống
      res.json({
        code: '00',
        desc: 'processed with error',
        data: null,
      });
    }
  },

  /**
   * API cho FE gọi lên kiểm tra nhanh trạng thái thanh toán ngay khi redirect
   * POST /api/v1/payments/payos/verify-payment
   */
  async verifyPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orderCode } = req.body;
      if (!orderCode) {
        return next(new AppError('Thiếu thông tin mã đơn hàng orderCode', 400, 'VALIDATION_ERROR'));
      }

      const numOrderCode = Number(orderCode);
      if (Number.isNaN(numOrderCode)) {
        return next(new AppError('orderCode phải là một số hợp lệ', 400, 'VALIDATION_ERROR'));
      }

      const request = await payosService.verifyPaymentStatus(numOrderCode);
      res.json({
        success: true,
        data: request,
      });
    } catch (err) {
      next(err);
    }
  },
};

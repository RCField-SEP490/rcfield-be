/* eslint-disable no-console */
import { PayOS, Webhook } from '@payos/node';
import { env } from '../config/env';
import { AppDataSource } from '../config/database';
import { PaymentRequest } from '../models/payment-request.entity';
import { AppError, NotificationType, PaymentRequestStatus } from '../types';
import { createNotification } from './notification.service';
import { activateFromPayment } from './subscription.service';

let payOS: PayOS | null = null;

function getPayOSInstance(): PayOS {
  if (!payOS) {
    if (!env.payos.clientId || !env.payos.apiKey || !env.payos.checksumKey) {
      throw new AppError(
        'PayOS credentials are not fully configured in env',
        500,
        'PAYOS_NOT_CONFIGURED',
      );
    }
    payOS = new PayOS({
      clientId: env.payos.clientId,
      apiKey: env.payos.apiKey,
      checksumKey: env.payos.checksumKey,
    });
  }
  return payOS;
}

export interface PayOSLinkResult {
  checkoutUrl: string;
  orderCode: number;
}

/**
 * Tạo link thanh toán PayOS cho một PaymentRequest
 */
export async function createPaymentLink(
  request: PaymentRequest,
  planName: string,
): Promise<PayOSLinkResult> {
  const payOSInstance = getPayOSInstance();

  // Sinh orderCode duy nhất là số nguyên (sử dụng Timestamp và 3 số ngẫu nhiên để tránh trùng lặp)
  const orderCode = Number(
    String(Date.now()).substring(3) + String(Math.floor(Math.random() * 900) + 100),
  );

  const returnUrl = `${env.frontendUrl}/provider/subscriptions/callback?status=success&orderCode=${orderCode}`;
  const cancelUrl = `${env.frontendUrl}/provider/subscriptions/callback?status=cancel&orderCode=${orderCode}`;

  // Rút gọn description của PayOS (giới hạn 25 kí tự, không dấu, không kí tự đặc biệt)
  const cleanPlanName = planName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 15);
  const description = `RCField ${cleanPlanName}`.slice(0, 25);

  const amount = Number(request.transferAmount);

  const paymentData = {
    orderCode,
    amount,
    description,
    returnUrl,
    cancelUrl,
  };

  try {
    const paymentLinkData = await payOSInstance.paymentRequests.create(paymentData);

    // Cập nhật orderCode này vào trường transferReference của PaymentRequest để đối soát sau này
    const repo = AppDataSource.getRepository(PaymentRequest);
    request.transferReference = String(orderCode);
    request.status = PaymentRequestStatus.PENDING;
    await repo.save(request);

    return {
      checkoutUrl: paymentLinkData.checkoutUrl,
      orderCode,
    };
  } catch (error) {
    console.error('PayOS create link failed:', error);
    throw new AppError(
      'Không thể tạo liên kết thanh toán với PayOS: ' +
        (error instanceof Error ? error.message : String(error)),
      500,
      'PAYOS_API_ERROR',
    );
  }
}

/**
 * Xử lý khi thanh toán thành công
 */
export async function handlePaymentSuccess(request: PaymentRequest): Promise<void> {
  if (request.status === PaymentRequestStatus.CONFIRMED) {
    return;
  }

  await AppDataSource.transaction(async (manager) => {
    request.status = PaymentRequestStatus.CONFIRMED;
    request.reviewedAt = new Date();
    request.adminNotes = 'Thanh toán tự động qua PayOS.';
    await manager.save(request);

    await activateFromPayment(request.providerId, request.planId);

    // Kích hoạt lại các quán cafe của provider bị xóa tạm thời (do hết hạn subscription)
    await manager.query(
      `UPDATE cafes SET deleted_at = NULL, updated_at = NOW()
       WHERE provider_id = $1 AND deleted_at IS NOT NULL`,
      [request.providerId],
    );
  });

  await createNotification(
    request.providerId,
    NotificationType.PAYMENT_REQUEST_CONFIRMED,
    'Thanh toán được xác nhận',
    'Gói đăng ký của bạn đã được kích hoạt thành công qua cổng PayOS.',
  );
}

/**
 * Xử lý khi thanh toán thất bại hoặc hủy
 */
export async function handlePaymentFailed(
  request: PaymentRequest,
  reason = 'Thanh toán bị huỷ hoặc thất bại.',
): Promise<void> {
  if (
    request.status === PaymentRequestStatus.CONFIRMED ||
    request.status === PaymentRequestStatus.REJECTED
  ) {
    return;
  }

  const repo = AppDataSource.getRepository(PaymentRequest);
  request.status = PaymentRequestStatus.REJECTED;
  request.reviewedAt = new Date();
  request.adminNotes = reason;
  await repo.save(request);

  await createNotification(
    request.providerId,
    NotificationType.PAYMENT_REQUEST_REJECTED,
    'Thanh toán không thành công',
    `Giao dịch thanh toán PayOS bị huỷ hoặc hết hạn. Chi tiết: ${reason}. Vui lòng thử lại.`,
  );
}

/**
 * Xác thực dữ liệu webhook của PayOS
 */
export async function verifyWebhookData(body: unknown) {
  const payOSInstance = getPayOSInstance();
  return payOSInstance.webhooks.verify(body as Webhook);
}

/**
 * Query trực tiếp từ PayOS và đồng bộ trạng thái đơn hàng về database
 */
export async function verifyPaymentStatus(orderCode: number): Promise<PaymentRequest> {
  const payOSInstance = getPayOSInstance();
  const repo = AppDataSource.getRepository(PaymentRequest);

  const request = await repo.findOne({
    where: { transferReference: String(orderCode) },
  });

  if (!request) {
    throw new AppError('Yêu cầu thanh toán không tồn tại', 404, 'NOT_FOUND');
  }

  // Nếu trạng thái đã được CONFIRMED rồi thì không cần gọi PayOS làm gì nữa
  if (request.status === PaymentRequestStatus.CONFIRMED) {
    return request;
  }

  try {
    const payosOrder = await payOSInstance.paymentRequests.get(orderCode);

    if (payosOrder.status === 'PAID') {
      await handlePaymentSuccess(request);
    } else if (['CANCELLED', 'EXPIRED'].includes(payosOrder.status)) {
      const reason =
        payosOrder.status === 'CANCELLED' ? 'Người dùng hủy thanh toán.' : 'Giao dịch hết hạn.';
      await handlePaymentFailed(request, reason);
    }

    // Fetch lại dữ liệu mới nhất sau khi cập nhật
    const updatedRequest = await repo.findOne({ where: { id: request.id } });
    return updatedRequest || request;
  } catch (error) {
    console.error('Verify PayOS status failed:', error);
    // Nếu PayOS trả về lỗi 404 nghĩa là link thanh toán chưa được thanh toán thành công và có thể đã bị huỷ
    // Chúng ta giữ nguyên trạng thái PENDING để có thể query lại sau
    return request;
  }
}

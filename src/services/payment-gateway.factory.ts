import { AppError } from '../types';
import {
  type PaymentGateway,
  type SupportedPaymentGateway,
  isSupportedPaymentGateway,
} from './payment-gateway.interface';
import { mockGateway } from './mock.gateway';
import { vnpayGateway } from './vnpay.gateway';

const gatewayMap: Record<SupportedPaymentGateway, PaymentGateway> = {
  vnpay: vnpayGateway,
  mock: mockGateway,
};

export function getPaymentGateway(gatewayName: string): PaymentGateway {
  const normalized = gatewayName.toLowerCase().trim();
  if (!isSupportedPaymentGateway(normalized)) {
    throw new AppError(
      `Unsupported payment gateway: ${gatewayName}`,
      400,
      'UNSUPPORTED_PAYMENT_GATEWAY',
    );
  }
  return gatewayMap[normalized];
}

export function getDefaultPaymentGateway(): PaymentGateway {
  return vnpayGateway;
}

export { mockGateway, vnpayGateway };
export type { PaymentGateway };

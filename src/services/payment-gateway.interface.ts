export interface CreatePaymentUrlInput {
  amount: number;
  txnRef: string;
  orderInfo: string;
  ipAddr: string;
  returnUrl?: string;
  orderType?: string;
  bankCode?: string;
}

export interface PaymentUrlResult {
  payment_url: string;
  txn_ref: string;
  gateway: string;
  /** Human-readable hint for the frontend (e.g. 'redirect' or 'mock_page'). */
  flow: 'redirect' | 'mock_page';
}

export interface PaymentVerificationResult {
  isValid: boolean;
  isSuccess: boolean;
  txnRef: string;
  amount: number;
  responseCode: string;
  transactionStatus?: string;
  transactionNo?: string;
  bankCode?: string;
  payDate?: string;
  raw: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly name: string;
  createPaymentUrl(input: CreatePaymentUrlInput): PaymentUrlResult;
  verifyCallback(params: Record<string, unknown>): PaymentVerificationResult;
}

export interface ProcessConfirmationResult {
  rspCode: string;
  message: string;
  success: boolean;
}

/** Gateways supported by the booking payment flow. */
export const SUPPORTED_PAYMENT_GATEWAYS = ['vnpay', 'mock'] as const;
export type SupportedPaymentGateway = (typeof SUPPORTED_PAYMENT_GATEWAYS)[number];

export function isSupportedPaymentGateway(value: string): value is SupportedPaymentGateway {
  return (SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(value);
}

import { PaymentComponent } from '../models/payment-component.entity';
import { PaymentTransaction } from '../models/payment-transaction.entity';
import {
  PaymentComponentStatus,
  PaymentComponentType,
  PaymentTransactionStatus,
  PaymentTransactionType,
} from '../types';

export type FinancialLineGroup = 'PREPAID' | 'ON_SITE';

export interface FinancialPaymentReference {
  transactionId: string;
  txnRef: string;
  gateway: string;
  paidAt: string;
}

export interface FinancialLine {
  componentId: string;
  type: PaymentComponentType;
  label: string;
  amount: number;
  status: PaymentComponentStatus;
  group: FinancialLineGroup;
  payment?: FinancialPaymentReference;
}

export interface BookingFinancialSummary {
  prepaidLines: FinancialLine[];
  additionalLines: FinancialLine[];
  prepaidServiceTotal: number;
  prepaidDiscountAmount: number;
  prepaidPaidAmount: number;
  additionalTotal: number;
  additionalPaidAmount: number;
  additionalOutstandingAmount: number;
  totalPaidAmount: number;
  totalRefundedAmount: number;
  outstandingAmount: number;
  isSettled: boolean;
}

type TransactionComponentSnapshot = {
  id?: string;
  type?: string;
  amount?: number;
};

type PaymentRequestSnapshot = {
  additionalPayment?: boolean;
  counterSettlement?: boolean;
  components?: TransactionComponentSnapshot[];
};

function asPaymentRequestSnapshot(value: object | null): PaymentRequestSnapshot {
  return (value ?? {}) as PaymentRequestSnapshot;
}

function isAdditionalPayment(transaction: PaymentTransaction): boolean {
  const request = asPaymentRequestSnapshot(transaction.rawRequest);
  return (
    request.additionalPayment === true ||
    request.counterSettlement === true ||
    transaction.txnRef.startsWith('ctr_')
  );
}

function componentSnapshots(transaction: PaymentTransaction): TransactionComponentSnapshot[] {
  const value = asPaymentRequestSnapshot(transaction.rawRequest).components;
  return Array.isArray(value) ? value : [];
}

function componentLabel(component: PaymentComponent): string {
  switch (component.type) {
    case PaymentComponentType.SLOT_FEE:
      return 'Phí lịch chơi';
    case PaymentComponentType.RENTAL_FEE:
      return 'Phí thuê xe';
    case PaymentComponentType.FB_PREORDER:
      // Historical records used this type for both preorder and at-counter F&B.
      // HELD identifies the amount collected with the original booking.
      return component.status === PaymentComponentStatus.HELD
        ? 'Đồ ăn & thức uống đặt trước'
        : 'Đồ ăn & thức uống gọi tại quầy';
    case PaymentComponentType.FNB_ON_SITE:
      return 'Đồ ăn & thức uống gọi tại quầy';
    case PaymentComponentType.EXTENSION_FEE:
      return 'Phí gia hạn ca chơi';
    case PaymentComponentType.DAMAGE_CHARGE:
      return 'Phí bồi thường hư hỏng';
    case PaymentComponentType.SECURITY_DEPOSIT:
      return 'Tiền cọc xe';
    default:
      return 'Khoản thanh toán khác';
  }
}

function isPrepaidComponent(component: PaymentComponent): boolean {
  return (
    component.type === PaymentComponentType.SLOT_FEE ||
    component.type === PaymentComponentType.RENTAL_FEE ||
    (component.type === PaymentComponentType.FB_PREORDER &&
      component.status === PaymentComponentStatus.HELD)
  );
}

function findSuccessfulPayment(
  component: PaymentComponent,
  transactions: PaymentTransaction[],
  additional: boolean,
): FinancialPaymentReference | undefined {
  const successfulTransactions = transactions.filter(
    (transaction) =>
      transaction.type === PaymentTransactionType.PAYMENT &&
      transaction.status === PaymentTransactionStatus.SUCCESS &&
      isAdditionalPayment(transaction) === additional,
  );

  const transaction = successfulTransactions.find((candidate) =>
    componentSnapshots(candidate).some(
      (snapshot) =>
        snapshot.id === component.id ||
        (!snapshot.id &&
          snapshot.type === component.type &&
          Number(snapshot.amount) === Number(component.amount)),
    ),
  );

  if (!transaction) return undefined;
  return {
    transactionId: transaction.id,
    txnRef: transaction.txnRef,
    gateway: transaction.gateway,
    paidAt: transaction.updatedAt.toISOString(),
  };
}

/**
 * Financial source of truth shared by customer booking and staff session views.
 * F&B orders remain operational records; only payment components may determine
 * the amount due/paid in a settlement.
 */
export function buildBookingFinancialSummary(
  components: PaymentComponent[],
  transactions: PaymentTransaction[],
  discountAmount = 0,
): BookingFinancialSummary {
  const chargeComponents = components.filter(
    (component) => component.type !== PaymentComponentType.SECURITY_DEPOSIT,
  );
  const prepaidComponents = chargeComponents.filter(isPrepaidComponent);
  const additionalComponents = chargeComponents.filter(
    (component) => !isPrepaidComponent(component),
  );

  const prepaidLines = prepaidComponents.map((component) => ({
    componentId: component.id,
    type: component.type,
    label: componentLabel(component),
    amount: Number(component.amount),
    status: component.status,
    group: 'PREPAID' as const,
    payment: findSuccessfulPayment(component, transactions, false),
  }));
  const additionalLines = additionalComponents.map((component) => ({
    componentId: component.id,
    type: component.type,
    label: componentLabel(component),
    amount: Number(component.amount),
    status: component.status,
    group: 'ON_SITE' as const,
    payment: findSuccessfulPayment(component, transactions, true),
  }));

  const successfulPayments = transactions.filter(
    (transaction) =>
      transaction.type === PaymentTransactionType.PAYMENT &&
      transaction.status === PaymentTransactionStatus.SUCCESS,
  );
  const successfulRefunds = transactions.filter(
    (transaction) =>
      transaction.type === PaymentTransactionType.REFUND &&
      transaction.status === PaymentTransactionStatus.SUCCESS,
  );
  const prepaidPayments = successfulPayments.filter(
    (transaction) => !isAdditionalPayment(transaction),
  );
  const additionalPayments = successfulPayments.filter(isAdditionalPayment);

  const prepaidServiceTotal = prepaidLines.reduce((sum, line) => sum + line.amount, 0);
  const normalizedDiscountAmount = Math.max(0, Number(discountAmount) || 0);
  const additionalTotal = additionalLines.reduce((sum, line) => sum + line.amount, 0);
  const additionalOutstandingAmount = additionalLines
    .filter((line) => line.status === PaymentComponentStatus.PENDING)
    .reduce((sum, line) => sum + line.amount, 0);
  const totalRefundedAmount = successfulRefunds.reduce(
    (sum, transaction) => sum + Number(transaction.amount),
    0,
  );

  return {
    prepaidLines,
    additionalLines,
    prepaidServiceTotal,
    prepaidDiscountAmount: normalizedDiscountAmount,
    prepaidPaidAmount: prepaidPayments.reduce(
      (sum, transaction) => sum + Number(transaction.amount),
      0,
    ),
    additionalTotal,
    additionalPaidAmount: additionalPayments.reduce(
      (sum, transaction) => sum + Number(transaction.amount),
      0,
    ),
    additionalOutstandingAmount,
    totalPaidAmount:
      successfulPayments.reduce((sum, transaction) => sum + Number(transaction.amount), 0) -
      totalRefundedAmount,
    totalRefundedAmount,
    outstandingAmount: additionalOutstandingAmount,
    isSettled: additionalOutstandingAmount === 0,
  };
}

import { PaymentComponent } from '../../models/payment-component.entity';
import { PaymentTransaction } from '../../models/payment-transaction.entity';
import {
  PaymentComponentStatus,
  PaymentComponentType,
  PaymentTransactionStatus,
  PaymentTransactionType,
} from '../../types';
import { buildBookingFinancialSummary } from '../../lib/booking-financial-summary';

function component(
  id: string,
  type: PaymentComponentType,
  amount: number,
  status: PaymentComponentStatus,
): PaymentComponent {
  return { id, type, amount, status } as PaymentComponent;
}

function payment(id: string, amount: number, rawRequest: object): PaymentTransaction {
  return {
    id,
    txnRef: id,
    amount,
    type: PaymentTransactionType.PAYMENT,
    status: PaymentTransactionStatus.SUCCESS,
    gateway: 'VNPAY',
    rawRequest,
    updatedAt: new Date('2026-07-24T10:00:00.000Z'),
  } as PaymentTransaction;
}

describe('buildBookingFinancialSummary', () => {
  it('separates prepaid and on-site fees without treating an F&B order as a second source of money', () => {
    const summary = buildBookingFinancialSummary(
      [
        component('slot', PaymentComponentType.SLOT_FEE, 50_000, PaymentComponentStatus.HELD),
        component('rental', PaymentComponentType.RENTAL_FEE, 150_000, PaymentComponentStatus.HELD),
        component(
          'preorder',
          PaymentComponentType.FB_PREORDER,
          140_000,
          PaymentComponentStatus.HELD,
        ),
        component(
          'onsite',
          PaymentComponentType.FNB_ON_SITE,
          25_000,
          PaymentComponentStatus.DISBURSED,
        ),
        component(
          'damage',
          PaymentComponentType.DAMAGE_CHARGE,
          60_000,
          PaymentComponentStatus.PENDING,
        ),
        component(
          'legacy-deposit',
          PaymentComponentType.SECURITY_DEPOSIT,
          500_000,
          PaymentComponentStatus.HELD,
        ),
      ],
      [
        payment('initial-payment', 340_000, {
          components: [
            { id: 'slot', type: PaymentComponentType.SLOT_FEE, amount: 50_000 },
            { id: 'rental', type: PaymentComponentType.RENTAL_FEE, amount: 150_000 },
            { id: 'preorder', type: PaymentComponentType.FB_PREORDER, amount: 140_000 },
          ],
        }),
        payment('ctr-onsite', 25_000, {
          additionalPayment: true,
          components: [{ id: 'onsite', type: PaymentComponentType.FNB_ON_SITE, amount: 25_000 }],
        }),
      ],
    );

    expect(summary.prepaidLines.map((line) => line.label)).toEqual([
      'Phí lịch chơi',
      'Phí thuê xe',
      'Đồ ăn & thức uống đặt trước',
    ]);
    expect(summary.prepaidServiceTotal).toBe(340_000);
    expect(summary.prepaidPaidAmount).toBe(340_000);
    expect(summary.additionalLines.map((line) => line.label)).toEqual([
      'Đồ ăn & thức uống gọi tại quầy',
      'Phí bồi thường hư hỏng',
    ]);
    expect(summary.additionalTotal).toBe(85_000);
    expect(summary.additionalPaidAmount).toBe(25_000);
    expect(summary.additionalOutstandingAmount).toBe(60_000);
    expect(summary.totalPaidAmount).toBe(365_000);
    expect(summary.isSettled).toBe(false);
  });
});

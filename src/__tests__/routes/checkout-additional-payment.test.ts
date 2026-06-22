import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import {
  PaymentComponentStatus,
  PaymentComponentType,
  PaymentTransactionStatus,
  UserRole,
} from '../../types';
import { createTestCafe, createTestUser, generateToken } from '../helpers';
import { Booking } from '../../models/booking.entity';
import { PaymentComponent } from '../../models/payment-component.entity';
import { PaymentTransaction } from '../../models/payment-transaction.entity';

import { User } from '../../models/user.entity';
import { Cafe } from '../../models/cafe.entity';
import { env } from '../../config/env';

describe('POST /api/v1/bookings/:id/checkout-additional-payment', () => {
  let customer: User;
  let customerToken: string;
  let cafe: Cafe;
  let booking: Booking;

  beforeAll(() => {
    const mutableVnpay = env.vnpay as unknown as {
      mockEnabled: boolean;
      tmnCode: string;
      hashSecret: string;
      paymentUrl: string;
    };
    mutableVnpay.mockEnabled = true;
    mutableVnpay.tmnCode = 'MOCK_TMN';
    mutableVnpay.hashSecret = 'MOCK_SECRET';
    mutableVnpay.paymentUrl = 'https://mock.vnpay.vn';
  });

  beforeEach(async () => {
    // 1. Create a customer and token
    customer = await createTestUser({ role: UserRole.CUSTOMER });
    customerToken = generateToken(customer);

    // 2. Create a cafe
    cafe = await createTestCafe();

    // 3. Get a track type
    const [trackType] = await AppDataSource.query(`SELECT id FROM track_types LIMIT 1`);
    const trackTypeId = trackType?.id;

    // 4. Create a completed booking in database
    const [insertedBooking] = await AppDataSource.query(
      `INSERT INTO bookings (customer_id, cafe_id, slot_start, slot_end, play_mode, status, source, payment_expires_at, track_type_id)
       VALUES ($1, $2, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'BYOC', 'COMPLETED', 'APP', NOW() + INTERVAL '15 minutes', $3)
       RETURNING *`,
      [customer.id, cafe.id, trackTypeId],
    );
    booking = insertedBooking;

    // 4. Create a pending payment component representing extra charges (e.g. F&B onsite)
    await AppDataSource.query(
      `INSERT INTO payment_components (booking_id, type, amount, status)
       VALUES ($1, $2, $3, $4)`,
      [booking.id, PaymentComponentType.FB_PREORDER, 150000, PaymentComponentStatus.PENDING],
    );
  });

  it('tạo checkout payment thành công cho phí phát sinh → 201 và tự động disburses components khi mock enabled', async () => {
    const res = await request(app)
      .post(`/api/v1/bookings/${booking.id}/checkout-additional-payment`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.payment_url).toBeTruthy();
    expect(res.body.data.total_amount).toBe(150000);

    // Because vnpay.mockEnabled is true in test/dev, processMockConfirmation should have run automatically
    // 1. Check transaction was created and marked SUCCESS
    const txRepo = AppDataSource.getRepository(PaymentTransaction);
    const tx = await txRepo.findOne({ where: { txnRef: res.body.data.txn_ref } });
    expect(tx).toBeTruthy();
    expect(tx!.status).toBe(PaymentTransactionStatus.SUCCESS);
    expect(Number(tx!.amount)).toBe(150000);

    // 2. Check the payment component status has transitioned to DISBURSED
    const compRepo = AppDataSource.getRepository(PaymentComponent);
    const comps = await compRepo.find({ where: { bookingId: booking.id } });
    expect(comps.length).toBe(1);
    expect(comps[0].status).toBe(PaymentComponentStatus.DISBURSED);
  });

  it('trả về 400 nếu không có khoản phí phát sinh nào cần thanh toán', async () => {
    // Mark the existing component as DISBURSED
    await AppDataSource.query(`UPDATE payment_components SET status = $1 WHERE booking_id = $2`, [
      PaymentComponentStatus.DISBURSED,
      booking.id,
    ]);

    const res = await request(app)
      .post(`/api/v1/bookings/${booking.id}/checkout-additional-payment`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(400);

    expect(res.body.code).toBe('NO_PENDING_ADDITIONAL_FEES');
  });

  it('từ chối nếu không phải chủ sở hữu booking → 403', async () => {
    const otherCustomer = await createTestUser({ role: UserRole.CUSTOMER });
    const otherToken = generateToken(otherCustomer);

    const res = await request(app)
      .post(`/api/v1/bookings/${booking.id}/checkout-additional-payment`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    expect(res.body.code).toBe('NOT_BOOKING_OWNER');
  });
});

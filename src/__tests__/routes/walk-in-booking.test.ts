import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { env } from '../../config/env';
import { redis } from '../../config/redis';
import {
  BookingStatus,
  BookingParticipantType,
  BookingMode,
  UserRole,
  PaymentTransactionStatus,
  PaymentComponentStatus,
  PaymentComponentType,
} from '../../types';
import { createTestCafe, createTestUser, createTestVehicle } from '../helpers';
import { User } from '../../models/user.entity';
import { Booking } from '../../models/booking.entity';
import { BookingParticipant } from '../../models/booking-participant.entity';
import { PaymentTransaction } from '../../models/payment-transaction.entity';
import { PaymentComponent } from '../../models/payment-component.entity';

describe('POST /api/v1/staff/bookings (Walk-In Booking API)', () => {
  let staffUser: User;
  let staffToken: string;
  let cafe: { id: string };
  let trackTypeId: string;
  let vehicle: { id: string };

  beforeEach(async () => {
    // 1. Create a staff user and cafe
    staffUser = await createTestUser({ role: UserRole.STAFF });
    cafe = await createTestCafe();

    // Link staff to cafe in JWT token
    staffToken = jwt.sign(
      { userId: staffUser.id, email: staffUser.email, role: UserRole.STAFF, cafeId: cafe.id },
      env.jwt.secret,
      { expiresIn: '1h' },
    );

    // 2. Get a track type and create cafe track config
    const [trackType] = await AppDataSource.query(`SELECT id FROM track_types LIMIT 1`);
    trackTypeId = trackType.id;

    await AppDataSource.query(
      `INSERT INTO cafe_track_configs (cafe_id, track_type_id, max_concurrent, byoc_capacity, is_active)
       VALUES ($1, $2, 10, 5, true)`,
      [cafe.id, trackTypeId],
    );

    // 3. Create a vehicle
    vehicle = await createTestVehicle({ cafe_id: cafe.id, tier: 'STANDARD' });
  });

  afterEach(async () => {
    // Clean up Redis locks
    const keys = await redis.keys('slot:lock:vehicle:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
    const byocKeys = await redis.keys('slot:byoc:*');
    if (byocKeys.length > 0) {
      await redis.del(byocKeys);
    }
  });

  it('tạo booking BYOC thành công, tự sinh tài khoản guest, ghi nhận audit và thanh toán', async () => {
    const slotStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
    slotStart.setMinutes(0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

    const body = {
      play_mode: 'BYOC',
      track_type_id: trackTypeId,
      slot_start: slotStart.toISOString(),
      slot_end: slotEnd.toISOString(),
      payment_method: 'CASH',
      vehicle_ids: [],
      participants: [
        {
          guest_name: 'Khách Vãng Lai A',
          guest_phone: '0912345678',
          participant_type: 'WALK_IN_GUEST',
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/staff/bookings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body);

    console.log('BYOC Booking Fail Detail:', res.body);
    expect(res.status).toBe(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.bookingId).toBeTruthy();
    expect(res.body.data.status).toBe(BookingStatus.CONFIRMED);
    expect(res.body.data.paymentStatus).toBe('CAPTURED');

    // 1. Verify Guest User was automatically created
    const userRepo = AppDataSource.getRepository(User);
    const guestUser = await userRepo.findOne({ where: { phone: '0912345678' } });
    expect(guestUser).toBeTruthy();
    expect(guestUser!.email).toBe('0912345678@guest.rcfield.local');
    expect(guestUser!.password_hash).toBeNull();
    expect(guestUser!.is_active).toBe(true);

    // 2. Verify Booking is confirmed and correct source
    const bookingRepo = AppDataSource.getRepository(Booking);
    const booking = await bookingRepo.findOne({ where: { id: res.body.data.bookingId } });
    expect(booking).toBeTruthy();
    expect(booking!.status).toBe(BookingStatus.CONFIRMED);
    expect((booking!.snapshot as Record<string, unknown>).created_by_staff_id).toBe(staffUser.id);

    // 3. Verify PaymentComponents are marked DISBURSED
    const compRepo = AppDataSource.getRepository(PaymentComponent);
    const comps = await compRepo.find({ where: { bookingId: booking!.id } });
    expect(comps.length).toBe(1);
    expect(comps[0].type).toBe(PaymentComponentType.SLOT_FEE);
    expect(comps[0].status).toBe(PaymentComponentStatus.DISBURSED);

    // 4. Verify PaymentTransaction is SUCCESS with audit
    const txRepo = AppDataSource.getRepository(PaymentTransaction);
    const tx = await txRepo.findOne({ where: { bookingId: booking!.id } });
    expect(tx).toBeTruthy();
    expect(tx!.status).toBe(PaymentTransactionStatus.SUCCESS);
    expect(tx!.gateway).toBe('COUNTER_CASH');
    expect((tx!.rawRequest as Record<string, unknown>).created_by_staff_id).toBe(staffUser.id);
  });

  it('tạo booking RENTAL thành công, có xe thuê và ghi nhận phí xe + cọc xe', async () => {
    const slotStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
    slotStart.setMinutes(0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

    const body = {
      play_mode: 'RENTAL',
      track_type_id: trackTypeId,
      slot_start: slotStart.toISOString(),
      slot_end: slotEnd.toISOString(),
      payment_method: 'BANK_TRANSFER',
      vehicle_ids: [vehicle.id],
      participants: [
        {
          guest_name: 'Khách Thuê Xe',
          guest_phone: '0987654321',
          participant_type: 'WALK_IN_GUEST',
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/staff/bookings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)
      .expect(201);

    expect(res.body.success).toBe(true);

    const compRepo = AppDataSource.getRepository(PaymentComponent);
    const comps = await compRepo.find({ where: { bookingId: res.body.data.bookingId } });
    expect(comps.length).toBe(3); // SLOT_FEE, RENTAL_FEE, SECURITY_DEPOSIT

    const types = comps.map((c) => c.type);
    expect(types).toContain(PaymentComponentType.SLOT_FEE);
    expect(types).toContain(PaymentComponentType.RENTAL_FEE);
    expect(types).toContain(PaymentComponentType.SECURITY_DEPOSIT);

    comps.forEach((c) => {
      expect(c.status).toBe(PaymentComponentStatus.DISBURSED);
    });
  });

  it('từ chối nếu play_mode là RENTAL nhưng vehicle_ids trống (zod superRefine)', async () => {
    const slotStart = new Date(Date.now() + 4 * 60 * 60 * 1000);
    slotStart.setMinutes(0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

    const body = {
      play_mode: 'RENTAL',
      track_type_id: trackTypeId,
      slot_start: slotStart.toISOString(),
      slot_end: slotEnd.toISOString(),
      payment_method: 'CASH',
      vehicle_ids: [],
      participants: [
        {
          guest_name: 'Khách Lỗi',
          guest_phone: '0911223344',
          participant_type: 'WALK_IN_GUEST',
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/staff/bookings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)
      .expect(400);

    expect(res.body.errors[0].message).toContain(
      'Chế độ chơi RENTAL yêu cầu chọn ít nhất 1 xe thuê',
    );
  });

  it('từ chối nếu play_mode là BYOC nhưng có chọn xe (zod superRefine)', async () => {
    const slotStart = new Date(Date.now() + 4 * 60 * 60 * 1000);
    slotStart.setMinutes(0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

    const body = {
      play_mode: 'BYOC',
      track_type_id: trackTypeId,
      slot_start: slotStart.toISOString(),
      slot_end: slotEnd.toISOString(),
      payment_method: 'CASH',
      vehicle_ids: [vehicle.id],
      participants: [
        {
          guest_name: 'Khách Lỗi BYOC',
          guest_phone: '0911223344',
          participant_type: 'WALK_IN_GUEST',
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/staff/bookings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)
      .expect(400);

    expect(res.body.errors[0].message).toContain(
      'Chế độ chơi BYOC không được chọn xe của cửa hàng',
    );
  });

  it('hỗ trợ đăng ký nhiều người chơi (multi-participant): tạo 1 user chính, lưu đầy đủ BookingParticipant', async () => {
    const slotStart = new Date(Date.now() + 5 * 60 * 60 * 1000);
    slotStart.setMinutes(0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

    const body = {
      play_mode: 'BYOC',
      track_type_id: trackTypeId,
      slot_start: slotStart.toISOString(),
      slot_end: slotEnd.toISOString(),
      payment_method: 'CASH',
      vehicle_ids: [],
      participants: [
        {
          guest_name: 'Người chịu trách nhiệm',
          guest_phone: '0999000111',
          participant_type: 'WALK_IN_GUEST',
        },
        {
          guest_name: 'Bạn chơi 1',
          guest_phone: '0999000222',
          participant_type: 'WALK_IN_GUEST',
        },
        {
          guest_name: 'Bạn chơi 2',
          guest_phone: '0999000333',
          participant_type: 'WALK_IN_GUEST',
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/staff/bookings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)
      .expect(201);

    // 1. Only primary participant should have User created in DB
    const userRepo = AppDataSource.getRepository(User);
    const primaryUser = await userRepo.findOne({ where: { phone: '0999000111' } });
    expect(primaryUser).toBeTruthy();

    const companion1 = await userRepo.findOne({ where: { phone: '0999000222' } });
    expect(companion1).toBeNull(); // Should NOT be created as user in database

    // 2. All 3 participants must be saved in BookingParticipant
    const bpRepo = AppDataSource.getRepository(BookingParticipant);
    const participants = await bpRepo.find({ where: { bookingId: res.body.data.bookingId } });
    expect(participants.length).toBe(3);

    const bookers = participants.filter((p) => p.participantType === BookingParticipantType.BOOKER);
    expect(bookers.length).toBe(1);
    expect(bookers[0].userId).toBe(primaryUser!.id);

    const guests = participants.filter(
      (p) => p.participantType === BookingParticipantType.WALK_IN_GUEST,
    );
    expect(guests.length).toBe(2);
    expect(guests.map((g) => g.guestName)).toContain('Bạn chơi 1');
    expect(guests.map((g) => g.guestName)).toContain('Bạn chơi 2');
  });

  it('trả về lỗi 409 conflict nếu xe đã bị trùng lịch đặt', async () => {
    const slotStart = new Date(Date.now() + 6 * 60 * 60 * 1000);
    slotStart.setMinutes(0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

    const body = {
      play_mode: 'RENTAL',
      track_type_id: trackTypeId,
      slot_start: slotStart.toISOString(),
      slot_end: slotEnd.toISOString(),
      payment_method: 'CASH',
      vehicle_ids: [vehicle.id],
      participants: [
        {
          guest_name: 'Khách A',
          guest_phone: '0922334455',
          participant_type: 'WALK_IN_GUEST',
        },
      ],
    };

    // First booking succeeds
    await request(app)
      .post('/api/v1/staff/bookings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)
      .expect(201);

    // Second booking fails with 409
    const res = await request(app)
      .post('/api/v1/staff/bookings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body)
      .expect(409);

    expect(res.body.code).toBe('SLOT_LOCKED');
  });
});

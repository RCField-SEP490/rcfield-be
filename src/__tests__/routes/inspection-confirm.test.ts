import request from 'supertest';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { PaymentComponentType, UserRole } from '../../types';
import { createTestCafe, createTestUser, generateToken } from '../helpers';

const rentalInspectionPhotos = [
  { angle: 'FRONT', url: 'https://example.com/inspection-front.jpg' },
  { angle: 'BACK', url: 'https://example.com/inspection-back.jpg' },
  { angle: 'LEFT', url: 'https://example.com/inspection-left.jpg' },
  { angle: 'RIGHT', url: 'https://example.com/inspection-right.jpg' },
];

async function seedSession(opts: { sessionStatus: string }) {
  const customer = await createTestUser({ role: UserRole.CUSTOMER });
  const staff = await createTestUser({ role: UserRole.STAFF });
  const cafe = await createTestCafe();

  const [trackType] = await AppDataSource.query(`SELECT id FROM track_types LIMIT 1`);

  const [booking] = await AppDataSource.query(
    `INSERT INTO bookings
       (customer_id, cafe_id, slot_start, slot_end, play_mode, status, source, payment_expires_at, track_type_id)
     VALUES ($1, $2, NOW() - INTERVAL '2 hours', NOW() + INTERVAL '1 hour',
             'RENTAL', 'CONFIRMED', 'APP', NOW() + INTERVAL '15 minutes', $3)
     RETURNING *`,
    [customer.id, cafe.id, trackType?.id ?? null],
  );

  const [session] = await AppDataSource.query(
    `INSERT INTO sessions (booking_id, cafe_id, status, planned_end_at, actual_start_at, checked_in_by)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW() - INTERVAL '1 hour', $4)
     RETURNING *`,
    [booking.id, cafe.id, opts.sessionStatus, staff.id],
  );

  return {
    customer,
    staff,
    customerToken: generateToken(customer),
    staffToken: generateToken(staff),
    booking,
    session,
  };
}

describe('POST /api/v1/sessions/:sessionId/inspections/:inspectionId/confirm — customerConfirmInspection', () => {
  it('bắt đầu phiên ngay khi staff hoàn tất bàn giao và khóa biên bản giao xe với khách', async () => {
    const { customerToken, staffToken, session } = await seedSession({
      sessionStatus: 'CHECKED_IN',
    });

    const firstRes = await request(app)
      .post(`/api/v1/staff/sessions/${session.id}/inspections`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'CHECK_IN', photos: rentalInspectionPhotos })
      .expect(201);
    const firstInspectionId = firstRes.body.data.inspectionId;

    const [startedSession] = await AppDataSource.query<{ status: string }[]>(
      `SELECT status FROM sessions WHERE id = $1`,
      [session.id],
    );
    expect(startedSession.status).toBe('ACTIVE');

    // Handover is verified at the counter, so the customer cannot change it
    // after the session has started.
    const response = await request(app)
      .post(`/api/v1/sessions/${session.id}/inspections/${firstInspectionId}/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ agreed: false, disagreementNote: 'Xe co vet xuoc lon' })
      .expect(400);
    expect(response.body.code).toBe('CHECK_IN_INSPECTION_READ_ONLY');

    // Re-submitting cannot create a second handover record for the same session.
    const secondRes = await request(app)
      .post(`/api/v1/staff/sessions/${session.id}/inspections`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'CHECK_IN', photos: rentalInspectionPhotos })
      .expect(201);
    expect(secondRes.body.data.id).toBe(firstInspectionId);

    const [sessionAfter] = await AppDataSource.query<{ status: string }[]>(
      `SELECT status FROM sessions WHERE id = $1`,
      [session.id],
    );
    expect(sessionAfter.status).toBe('ACTIVE');
  });

  it('trả về biên bản CHECK_IN cũ khi staff submit lại', async () => {
    const { staffToken, session } = await seedSession({ sessionStatus: 'CHECKED_IN' });

    const firstRes = await request(app)
      .post(`/api/v1/staff/sessions/${session.id}/inspections`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'CHECK_IN', photos: rentalInspectionPhotos })
      .expect(201);

    await request(app)
      .post(`/api/v1/staff/sessions/${session.id}/inspections`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'CHECK_IN', photos: rentalInspectionPhotos })
      .expect(201);

    // No new inspection is created for the same handover.
    const inspections = await AppDataSource.query<{ id: string }[]>(
      `SELECT id FROM inspections WHERE session_id = $1 AND type = 'CHECK_IN'`,
      [session.id],
    );
    expect(inspections).toHaveLength(1);
    expect(inspections[0].id).toBe(firstRes.body.data.inspectionId);
  });

  it('không cho khách xác nhận biên bản CHECK_IN khi phiên đã ACTIVE', async () => {
    const { customerToken, staffToken, session } = await seedSession({
      sessionStatus: 'ACTIVE',
    });

    const inspectionRes = await request(app)
      .post(`/api/v1/staff/sessions/${session.id}/inspections`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'CHECK_IN', photos: rentalInspectionPhotos })
      .expect(201);

    const response = await request(app)
      .post(
        `/api/v1/sessions/${session.id}/inspections/${inspectionRes.body.data.inspectionId}/confirm`,
      )
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ agreed: true })
      .expect(400);
    expect(response.body.code).toBe('CHECK_IN_INSPECTION_READ_ONLY');

    const [sessionAfter] = await AppDataSource.query<{ status: string }[]>(
      `SELECT status FROM sessions WHERE id = $1`,
      [session.id],
    );
    expect(sessionAfter.status).toBe('ACTIVE');
  });

  it('từ chối xác nhận CHECK_OUT khi session không ở trạng thái CHECKING_OUT', async () => {
    const { customerToken, staff, session } = await seedSession({ sessionStatus: 'ACTIVE' });

    const [inspection] = await AppDataSource.query(
      `INSERT INTO inspections
         (session_id, type, subject_type, performed_by, damage_noted, pre_existing_flag, customer_confirmed)
       VALUES ($1, 'CHECK_OUT', 'RENTAL_VEHICLE', $2, false, true, false)
       RETURNING *`,
      [session.id, staff.id],
    );

    const res = await request(app)
      .post(`/api/v1/sessions/${session.id}/inspections/${inspection.id}/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ agreed: true })
      .expect(400);

    expect(res.body.code).toBe('INVALID_SESSION_STATE');
  });

  it('cho phép xác nhận CHECK_OUT khi session đang CHECKING_OUT', async () => {
    const { customerToken, staff, booking, session } = await seedSession({
      sessionStatus: 'CHECKING_OUT',
    });

    await AppDataSource.query(
      `INSERT INTO payment_components (booking_id, type, amount, status)
       VALUES ($1, $2, $3, 'HELD')`,
      [booking.id, PaymentComponentType.SECURITY_DEPOSIT, 300000],
    );

    const [inspection] = await AppDataSource.query(
      `INSERT INTO inspections
         (session_id, type, subject_type, performed_by, damage_noted, pre_existing_flag, customer_confirmed)
       VALUES ($1, 'CHECK_OUT', 'RENTAL_VEHICLE', $2, false, true, false)
       RETURNING *`,
      [session.id, staff.id],
    );

    await request(app)
      .post(`/api/v1/sessions/${session.id}/inspections/${inspection.id}/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ agreed: true })
      .expect(200);

    const [sessionAfter] = await AppDataSource.query<{ status: string }[]>(
      `SELECT status FROM sessions WHERE id = $1`,
      [session.id],
    );
    expect(sessionAfter.status).toBe('COMPLETED');
  });
});

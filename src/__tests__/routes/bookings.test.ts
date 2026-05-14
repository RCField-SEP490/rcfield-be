import request from 'supertest';
import { app } from '../../app';
import { UserRole } from '../../types';
import { createTestUser, createTestCafe, createTestVehicle, generateToken } from '../helpers';
import { beforeEach, describe, it } from 'node:test';

// Template — bổ sung khi implement BookingController

describe('POST /api/v1/bookings', () => {
  let customerToken: string;
  let cafeId: string;
  let vehicleId: string;

  beforeEach(async () => {
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    customerToken = generateToken(customer);

    const cafe = await createTestCafe({ track_types: ['DRIFT', 'CIRCUIT'] });
    cafeId = cafe.id;

    const vehicle = await createTestVehicle({ cafe_id: cafeId, tier: 'STANDARD' });
    vehicleId = vehicle.id;
  });

  it.todo('tạo booking RENTAL thành công → 201 + status PENDING');
  it.todo('tạo booking BYOC thành công → 201 + vehicle_id null');
  it.todo('từ chối nếu cafe status != ACTIVE → 400 CAFE_NOT_ACTIVE');
  it.todo('từ chối nếu xe đã bị đặt trong cùng slot → 409 SLOT_UNAVAILABLE');
  it.todo('từ chối nếu BYOC capacity đã đầy → 409 BYOC_CAPACITY_FULL');
  it.todo('từ chối nếu không có token → 401 UNAUTHORIZED');
  it.todo('slot_start phải nằm trong boundary của cafe → 400 INVALID_SLOT');
});

describe('GET /api/v1/bookings/:id', () => {
  it.todo('customer lấy được booking của mình');
  it.todo('customer không lấy được booking của người khác → 403');
  it.todo('staff lấy được mọi booking trong chi nhánh mình');
});

describe('PATCH /api/v1/bookings/:id/cancel', () => {
  it.todo('huỷ trước 24h → hoàn 100%');
  it.todo('huỷ 12-24h → hoàn 50% slot_fee');
  it.todo('huỷ dưới 12h → hoàn 0% slot_fee');
  it.todo('không thể huỷ booking đang ACTIVE → 400');
});

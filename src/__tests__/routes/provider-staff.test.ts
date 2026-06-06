import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../../app';
import { AppDataSource } from '../../config/database';
import { ProviderStatus, SubscriptionStatus, UserRole } from '../../types';
import { createTestCafe, createTestUser, generateToken } from '../helpers';

async function activateProvider(providerId: string): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO provider_profiles (user_id, business_name, registration_status)
     VALUES ($1, $2, $3)`,
    [providerId, 'Test RC Business', ProviderStatus.ACTIVE],
  );

  const [plan] = await AppDataSource.query<{ id: string }[]>(
    `SELECT id FROM subscription_plans WHERE is_trial = true LIMIT 1`,
  );

  await AppDataSource.query(
    `INSERT INTO provider_subscriptions
       (provider_id, plan_id, status, started_at, expires_at, ai_quota_reset_at)
     VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '14 days', NOW() + INTERVAL '30 days')`,
    [providerId, plan.id, SubscriptionStatus.TRIAL],
  );
}

async function createStaffViaApi(
  provider: { id: string; email: string; role: UserRole },
  cafeId: string,
  overrides: Partial<{
    full_name: string;
    email: string;
    phone: string;
    password: string;
  }> = {},
) {
  const body = {
    cafe_id: cafeId,
    full_name: overrides.full_name ?? 'Nguyen Staff',
    email:
      overrides.email ?? `staff_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
    phone: overrides.phone ?? '0901234567',
    password: overrides.password ?? 'secret123',
  };

  const res = await request(app)
    .post('/api/v1/provider/staff')
    .set('Authorization', `Bearer ${generateToken(provider)}`)
    .send(body)
    .expect(201);

  return { body, staff: res.body.data };
}

describe('POST /api/v1/provider/staff', () => {
  it('provider ACTIVE tạo được tài khoản STAFF và gán vào cafe của mình', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });

    const res = await request(app)
      .post('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        cafe_id: cafe.id,
        full_name: 'Nguyen Staff',
        email: 'Staff.New@Example.com',
        phone: '0901234567',
        password: 'secret123',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      email: 'staff.new@example.com',
      fullName: 'Nguyen Staff',
      phone: '0901234567',
      role: UserRole.STAFF,
      cafeId: cafe.id,
      assignedBy: provider.id,
    });
    expect(res.body.data).not.toHaveProperty('password_hash');
    expect(res.body.data).not.toHaveProperty('access_token');
    expect(res.body.data).not.toHaveProperty('refresh_token');

    const [staff] = await AppDataSource.query<
      { id: string; email: string; role: string; password_hash: string; is_active: boolean }[]
    >(`SELECT id, email, role, password_hash, is_active FROM users WHERE id = $1`, [
      res.body.data.id,
    ]);
    expect(staff.email).toBe('staff.new@example.com');
    expect(staff.role).toBe(UserRole.STAFF);
    expect(staff.is_active).toBe(true);
    await expect(bcrypt.compare('secret123', staff.password_hash)).resolves.toBe(true);

    const [assignment] = await AppDataSource.query<
      { staff_id: string; cafe_id: string; assigned_by: string }[]
    >(`SELECT staff_id, cafe_id, assigned_by FROM staff_cafe_assignments WHERE staff_id = $1`, [
      staff.id,
    ]);
    expect(assignment).toEqual({
      staff_id: staff.id,
      cafe_id: cafe.id,
      assigned_by: provider.id,
    });
  });

  it('không cho tạo staff khi không đăng nhập', async () => {
    const res = await request(app).post('/api/v1/provider/staff').send({}).expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('không cho CUSTOMER tạo staff', async () => {
    const customer = await createTestUser({ role: UserRole.CUSTOMER });

    const res = await request(app)
      .post('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(customer)}`)
      .send({})
      .expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('không cho provider chưa ACTIVE tạo staff', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await AppDataSource.query(
      `INSERT INTO provider_profiles (user_id, business_name, registration_status)
       VALUES ($1, $2, $3)`,
      [provider.id, 'Pending RC Business', ProviderStatus.PENDING],
    );

    const res = await request(app)
      .post('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({})
      .expect(403);

    expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('không cho provider tạo staff cho cafe thuộc provider khác', async () => {
    const owner = await createTestUser({ role: UserRole.PROVIDER });
    const other = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(other.id);
    const cafe = await createTestCafe({ provider_id: owner.id });

    const res = await request(app)
      .post('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(other)}`)
      .send({
        cafe_id: cafe.id,
        full_name: 'Blocked Staff',
        email: 'blocked@example.com',
        password: 'secret123',
      })
      .expect(404);

    expect(res.body.code).toBe('CAFE_NOT_FOUND');

    const [{ count }] = await AppDataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::int AS count FROM users WHERE email = $1`,
      ['blocked@example.com'],
    );
    expect(Number(count)).toBe(0);
  });

  it('không tạo staff nếu email đã tồn tại', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    await createTestUser({ email: 'exists@example.com', role: UserRole.CUSTOMER });

    const res = await request(app)
      .post('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        cafe_id: cafe.id,
        full_name: 'Duplicate Staff',
        email: 'EXISTS@example.com',
        password: 'secret123',
      })
      .expect(409);

    expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');

    const [{ count }] = await AppDataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::int AS count FROM staff_cafe_assignments`,
    );
    expect(Number(count)).toBe(0);
  });

  it('validate body trước khi tạo staff', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);

    const res = await request(app)
      .post('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({
        cafe_id: 'not-a-uuid',
        full_name: 'A',
        email: 'not-email',
        phone: '123',
        password: '123',
      })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('Provider staff management routes', () => {
  it('list staff của provider, filter theo cafe_id và is_active, có meta phân trang', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    const otherProvider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    await activateProvider(otherProvider.id);
    const cafeA = await createTestCafe({ provider_id: provider.id });
    const cafeB = await createTestCafe({ provider_id: provider.id });
    const otherCafe = await createTestCafe({ provider_id: otherProvider.id });
    const staffA = await createStaffViaApi(provider, cafeA.id, { email: 'staff-a@example.com' });
    const staffB = await createStaffViaApi(provider, cafeB.id, { email: 'staff-b@example.com' });
    await createStaffViaApi(otherProvider, otherCafe.id, { email: 'other-staff@example.com' });

    await AppDataSource.query(`UPDATE users SET is_active = false WHERE id = $1`, [
      staffB.staff.id,
    ]);

    const listRes = await request(app)
      .get('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(listRes.body.meta.total).toBe(2);
    expect(listRes.body.data.map((item: { id: string }) => item.id).sort()).toEqual(
      [staffA.staff.id, staffB.staff.id].sort(),
    );
    expect(listRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: staffA.staff.id, cafeId: cafeA.id, isActive: true }),
        expect.objectContaining({ id: staffB.staff.id, cafeId: cafeB.id, isActive: false }),
      ]),
    );

    const cafeFilterRes = await request(app)
      .get(`/api/v1/provider/staff?cafe_id=${cafeA.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .expect(200);
    expect(cafeFilterRes.body.meta.total).toBe(1);
    expect(cafeFilterRes.body.data[0].id).toBe(staffA.staff.id);

    const activeFilterRes = await request(app)
      .get('/api/v1/provider/staff?is_active=false&page=1&limit=1')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .expect(200);
    expect(activeFilterRes.body.meta).toMatchObject({ total: 1, page: 1, limit: 1 });
    expect(activeFilterRes.body.data[0]).toMatchObject({ id: staffB.staff.id, isActive: false });
  });

  it('detail staff trả thông tin assignment và không trả dữ liệu nhạy cảm', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const { staff } = await createStaffViaApi(provider, cafe.id, { email: 'detail@example.com' });

    const res = await request(app)
      .get(`/api/v1/provider/staff/${staff.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .expect(200);

    expect(res.body.data).toMatchObject({
      id: staff.id,
      email: 'detail@example.com',
      role: UserRole.STAFF,
      isActive: true,
      cafeId: cafe.id,
      cafeName: cafe.name,
      assignedBy: provider.id,
    });
    expect(res.body.data).not.toHaveProperty('password_hash');
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(res.body.data).not.toHaveProperty('access_token');
    expect(res.body.data).not.toHaveProperty('refresh_token');
  });

  it('provider không xem hoặc sửa được staff thuộc provider khác', async () => {
    const owner = await createTestUser({ role: UserRole.PROVIDER });
    const other = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(owner.id);
    await activateProvider(other.id);
    const ownerCafe = await createTestCafe({ provider_id: owner.id });
    const otherCafe = await createTestCafe({ provider_id: other.id });
    const { staff } = await createStaffViaApi(owner, ownerCafe.id, { email: 'owner@example.com' });

    const token = generateToken(other);
    await request(app)
      .get(`/api/v1/provider/staff/${staff.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Blocked' })
      .expect(404);
    await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/assignment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cafe_id: otherCafe.id })
      .expect(404);
    await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: false })
      .expect(404);
    await request(app)
      .post(`/api/v1/provider/staff/${staff.id}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('update profile đổi full_name, phone, email và chặn duplicate email/body rỗng', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const { staff } = await createStaffViaApi(provider, cafe.id, { email: 'old@example.com' });
    await createTestUser({ email: 'taken@example.com', role: UserRole.CUSTOMER });

    const updateRes = await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ full_name: 'Updated Staff', phone: null, email: 'NEW@example.com' })
      .expect(200);

    expect(updateRes.body.data).toMatchObject({
      id: staff.id,
      fullName: 'Updated Staff',
      phone: null,
      email: 'new@example.com',
    });

    const duplicateRes = await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ email: 'TAKEN@example.com' })
      .expect(409);
    expect(duplicateRes.body.code).toBe('EMAIL_ALREADY_EXISTS');

    const emptyRes = await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({})
      .expect(400);
    expect(emptyRes.body.code).toBe('VALIDATION_ERROR');
  });

  it('chuyển assignment sang cafe khác thuộc cùng provider và giữ 1 assignment duy nhất', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    const otherProvider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    await activateProvider(otherProvider.id);
    const cafeA = await createTestCafe({ provider_id: provider.id });
    const cafeB = await createTestCafe({ provider_id: provider.id });
    const otherCafe = await createTestCafe({ provider_id: otherProvider.id });
    const { staff } = await createStaffViaApi(provider, cafeA.id, { email: 'move@example.com' });

    const moveRes = await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/assignment`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ cafe_id: cafeB.id })
      .expect(200);

    expect(moveRes.body.data).toMatchObject({ id: staff.id, cafeId: cafeB.id });
    const assignments = await AppDataSource.query<{ cafe_id: string }[]>(
      `SELECT cafe_id FROM staff_cafe_assignments WHERE staff_id = $1`,
      [staff.id],
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0].cafe_id).toBe(cafeB.id);

    const wrongCafeRes = await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/assignment`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ cafe_id: otherCafe.id })
      .expect(404);
    expect(wrongCafeRes.body.code).toBe('CAFE_NOT_FOUND');
  });

  it('khóa/mở khóa staff bằng is_active và staff bị khóa không login được', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const { body, staff } = await createStaffViaApi(provider, cafe.id, {
      email: 'status@example.com',
      password: 'oldsecret',
    });

    const lockRes = await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/status`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ is_active: false })
      .expect(200);
    expect(lockRes.body.data.isActive).toBe(false);

    const lockedLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(403);
    expect(lockedLogin.body.code).toBe('ACCOUNT_LOCKED');

    const unlockRes = await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/status`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .send({ is_active: true })
      .expect(200);
    expect(unlockRes.body.data.isActive).toBe(true);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(200);
    expect(loginRes.body.data.user.role).toBe(UserRole.STAFF);
  });

  it('reset password sinh password tạm, xóa refresh token cũ và chỉ password mới login được', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const { body, staff } = await createStaffViaApi(provider, cafe.id, {
      email: 'reset@example.com',
      password: 'oldsecret',
    });

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(200);
    expect(oldLogin.body.data.refresh_token).toBeTruthy();

    const resetRes = await request(app)
      .post(`/api/v1/provider/staff/${staff.id}/reset-password`)
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .expect(200);

    expect(resetRes.body.data.staff).toMatchObject({ id: staff.id, email: body.email });
    expect(resetRes.body.data.temporaryPassword).toMatch(/^RCF-/);
    expect(resetRes.body.data.staff).not.toHaveProperty('password_hash');

    const [{ count }] = await AppDataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE user_id = $1`,
      [staff.id],
    );
    expect(Number(count)).toBe(0);

    const oldPasswordLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(401);
    expect(oldPasswordLogin.body.code).toBe('INVALID_CREDENTIALS');

    const newPasswordLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: body.email, password: resetRes.body.data.temporaryPassword })
      .expect(200);
    expect(newPasswordLogin.body.data.user.role).toBe(UserRole.STAFF);
  });

  it('validate query, params, assignment và status body', async () => {
    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await activateProvider(provider.id);
    const cafe = await createTestCafe({ provider_id: provider.id });
    const { staff } = await createStaffViaApi(provider, cafe.id);
    const token = generateToken(provider);

    await request(app)
      .get('/api/v1/provider/staff?is_active=yes')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app)
      .get('/api/v1/provider/staff/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/assignment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cafe_id: 'bad' })
      .expect(400);
    await request(app)
      .patch(`/api/v1/provider/staff/${staff.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: 'false' })
      .expect(400);
  });

  it('chặn list khi không đăng nhập, customer, hoặc provider chưa ACTIVE', async () => {
    await request(app).get('/api/v1/provider/staff').expect(401);

    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    await request(app)
      .get('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(customer)}`)
      .expect(403);

    const provider = await createTestUser({ role: UserRole.PROVIDER });
    await AppDataSource.query(
      `INSERT INTO provider_profiles (user_id, business_name, registration_status)
       VALUES ($1, $2, $3)`,
      [provider.id, 'Pending RC Business', ProviderStatus.PENDING],
    );
    const pendingRes = await request(app)
      .get('/api/v1/provider/staff')
      .set('Authorization', `Bearer ${generateToken(provider)}`)
      .expect(403);
    expect(pendingRes.body.code).toBe('ACCOUNT_NOT_ACTIVE');
  });
});

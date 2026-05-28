# RCField Backend

REST API cho hệ thống quản lý sân xe RC — B2B SaaS phục vụ chuỗi chi nhánh.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Language | TypeScript (strict mode) |
| Framework | Express.js |
| Database | PostgreSQL 16 via TypeORM |
| Cache / Lock | Redis 7 |
| Validation | Zod |
| Auth | JWT (access + refresh token) |
| File storage | Cloudinary |
| Container | Docker + Docker Compose |

---

## Yêu cầu

- Node.js >= 22
- npm >= 10
- Docker + Docker Compose

---

## Cài đặt lần đầu

```bash
# 1. Clone và cài dependencies Node.js
npm install

# 2. Dựng toàn bộ stack: PostgreSQL, Redis, NLU service, migration, backend, Swagger
npm run up:all
```

Sau khi chạy xong:

- API: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/api-docs`
- Health check: `GET http://localhost:3000/api/v1/health`

Lưu ý: nếu chưa có `.env`, lệnh `npm run up:all` sẽ tự copy từ `.env.example`. Với các tính năng bên thứ ba như Cloudinary, Google, Email, Facebook, mở `.env` và điền key thật khi cần dùng.

Nếu lệnh báo Docker chưa chạy, mở Docker Desktop trước rồi chạy lại `npm run up:all`.

---

## Biến môi trường

Xem file `.env.example` để biết đầy đủ các biến. Những biến bắt buộc:

| Biến | Mô tả |
|------|-------|
| `DB_HOST` | Host PostgreSQL (mặc định: `localhost`) |
| `DB_NAME` | Tên database (mặc định: `rcfeild_db`) |
| `DB_USERNAME` | User PostgreSQL |
| `DB_PASSWORD` | Password PostgreSQL |
| `JWT_SECRET` | Secret key cho access token — **đổi trước khi deploy** |
| `JWT_REFRESH_SECRET` | Secret key cho refresh token — **đổi trước khi deploy** |
| `REDIS_HOST` | Host Redis (mặc định: `localhost`) |

---

## Scripts

```bash
npm run dev              # Chạy development (hot reload)
npm run swagger          # Alias để chạy backend phục vụ Swagger
npm run up:all           # Một lệnh dựng DB + Redis + NLU + migration + backend + Swagger
npm run build            # Build TypeScript → dist/
npm run start            # Chạy production từ dist/
```

## Swagger

Swagger UI được mount sẵn ở backend:

- UI: `http://localhost:3000/api-docs`
- JSON: `http://localhost:3000/api-docs.json`

### Chạy nhanh

```bash
npm run up:all
```

Sau đó mở `http://localhost:3000/api-docs` trên trình duyệt.

### Migration

```bash
npm run migration:run     # Chạy tất cả migration chưa chạy
npm run migration:revert  # Rollback migration gần nhất
npm run migration:create src/migrations/TenMigration   # Tạo file migration mới (trống)
npm run migration:generate src/migrations/TenMigration # Tự generate migration từ entity diff
```

---

## Docker

```bash
# Khởi động PostgreSQL + Redis
docker compose up -d postgres redis

# Một lệnh dựng toàn bộ stack cần thiết để mở Swagger
npm run up:all

# Tắt (giữ nguyên data)
docker compose stop

# Tắt + xóa container (vẫn giữ data volume)
docker compose down

# Reset hoàn toàn (xóa luôn data)
docker compose down -v
```

| Service | Port | Container |
|---------|------|-----------|
| Backend API / Swagger | 3000 | `rcfeild_backend` |
| PostgreSQL | 5432 | `rcfeild_postgres` |
| Redis | 6379 | `rcfeild_redis` |
| NLU service | internal 8000 | `rcfeild_nlu` |

---

## Testing

### Chạy test

```bash
npm test                        # Chạy toàn bộ test suite
npm run test:watch              # Watch mode — tự chạy lại khi save file
npm run test:coverage           # Chạy kèm coverage report
npm test -- bookings            # Chạy 1 file cụ thể (khớp tên file)
```

### Cơ chế hoạt động

Test dùng **database riêng** (`rcfeild_test`) — hoàn toàn tách biệt với DB development. Không cần setup thêm gì, Jest tự xử lý:

```
globalSetup      → tạo rcfeild_test (nếu chưa có) + chạy migration
beforeEach       → TRUNCATE toàn bộ bảng → mỗi test bắt đầu với DB sạch
afterAll         → đóng connection
```

### Thêm test case mới

```typescript
// src/__tests__/routes/bookings.test.ts
import request from 'supertest';
import { app } from '../../app';
import { createTestUser, createTestCafe, generateToken } from '../helpers';
import { UserRole } from '../../types';

describe('POST /api/v1/bookings', () => {
  let token: string;
  let cafeId: string;

  beforeEach(async () => {
    const customer = await createTestUser({ role: UserRole.CUSTOMER });
    token = generateToken(customer);
    const cafe = await createTestCafe();
    cafeId = cafe.id;
  });

  it('tạo booking BYOC thành công', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ cafe_id: cafeId, mode: 'BYOC', track_type: 'DRIFT', ... });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
  });
});
```

### Helpers có sẵn

| Helper | Mô tả |
|--------|-------|
| `createTestUser({ role, email })` | Tạo user trong DB test |
| `createTestCafe({ status, track_types })` | Tạo cafe trong DB test |
| `createTestVehicle({ cafe_id, tier })` | Tạo xe trong DB test |
| `generateToken(user)` | Tạo JWT token hợp lệ |

### Cấu trúc thư mục test

```
src/__tests__/
├── global-setup.ts      # Tạo DB test + chạy migration (1 lần)
├── global-teardown.ts   # Cleanup sau khi xong
├── load-env.ts          # Load .env.test trước mọi import
├── jest-setup.ts        # TRUNCATE bảng trước mỗi test
├── helpers/
│   └── index.ts         # createTestUser, createTestCafe, generateToken...
└── routes/
    ├── health.test.ts
    └── bookings.test.ts  # (template — bổ sung khi implement controller)
```

---

## Cấu trúc thư mục

```
src/
├── server.ts               # Entry point — khởi động server (dùng khi chạy thật)
├── app.ts                  # Express app — export để test dùng qua supertest
├── config/
│   ├── database.ts         # TypeORM DataSource
│   ├── redis.ts            # ioredis client
│   └── env.ts              # Toàn bộ biến môi trường (type-safe)
├── routes/
│   └── index.ts            # Router gốc /api/v1 — mount tất cả sub-router tại đây
├── controllers/            # Request handlers, parse input, gọi service
├── services/               # Business logic
├── models/                 # TypeORM entities (mapping với DB tables)
├── middlewares/
│   ├── auth.middleware.ts  # authenticate() + authorize(...roles)
│   └── error.middleware.ts # Global error handler (Zod + AppError)
├── jobs/                   # Cron jobs (auto-cancel booking, expire feature flags)
├── migrations/             # DB migration files
└── types/
    └── index.ts            # Enums, AppError, AuthRequest
```

---

## Phân quyền

4 roles trong hệ thống:

| Role | Mô tả |
|------|-------|
| `CUSTOMER` | Khách đặt lịch |
| `PROVIDER` | Chủ chuỗi — quản lý toàn bộ chi nhánh |
| `STAFF` | Nhân viên chi nhánh — vận hành check-in/out |
| `ADMIN` | Team RCField — quản lý hệ thống, feature flags |

Sử dụng trong route:

```typescript
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { UserRole } from '../types';

router.get('/dashboard',
  authenticate,
  authorize(UserRole.PROVIDER, UserRole.ADMIN),
  controller.getDashboard
);
```

---

## Database

26 bảng — xem schema đầy đủ tại `docs/spec/06-database.md`.

Các bảng chính:

| Bảng | Mô tả |
|------|-------|
| `users` | Tất cả users (4 roles) |
| `cafes` | Chi nhánh — config vận hành per-branch |
| `vehicles` | Fleet xe của từng chi nhánh |
| `bookings` | Đơn đặt lịch (RENTAL / BYOC) |
| `payment_components` | Ledger thanh toán (immutable) |
| `inspection_records` | Check-in / check-out kèm ảnh |
| `promotions` | Mã giảm giá (global hoặc per-branch) |

---

## Tài liệu spec

Đọc trước khi implement bất kỳ feature nào:

| File | Nội dung |
|------|---------|
| `docs/spec/00-overview.md` | Tổng quan hệ thống, actors |
| `docs/spec/01-domain-model.md` | Entity và enums |
| `docs/spec/02-state-machine.md` | Booking lifecycle |
| `docs/spec/03-payment-engine.md` | Logic tính tiền, hoàn tiền |
| `docs/spec/04-inspection-flow.md` | Check-in / check-out |
| `docs/spec/05-api-contracts.md` | API endpoints |
| `docs/spec/06-database.md` | Schema đầy đủ 26 bảng |
| `docs/spec/business-rules/` | Business rules theo domain |

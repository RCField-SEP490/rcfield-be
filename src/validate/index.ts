import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import {
  AssetTier,
  BookingParticipantType,
  BookingMode,
  BookingStatus,
  CafeStatus,
  ContestStatus,
  DiscountType,
  PackageBillingPeriod,
  PromotionScheduleMode,
  PromoApplicableTo,
  VehicleSource,
  VehicleStatus,
} from '../types';

extendZodWithOpenApi(z);

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const RegisterSchema = z.object({
  full_name: z.string().min(2).max(255),
  email: z.string().email().max(255),
  phone: z
    .string()
    .regex(/^(84|0[3|5|7|8|9])([0-9]{8})$/)
    .optional(),
  password: z.string().min(6).max(100),
  role: z.enum(['CUSTOMER', 'PROVIDER']).default('CUSTOMER'),
});

export const GoogleSchema = z
  .object({
    id_token: z.string().min(1).optional(),
    credential: z.string().min(1).optional(),
  })
  .refine((value) => value.id_token || value.credential, {
    message: 'Google ID token is required',
  });

export const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const LogoutSchema = z.object({
  refresh_token: z.string().min(1),
});

export const UpdateMeSchema = z
  .object({
    full_name: z.string().min(2).max(255).optional(),
    phone: z.string().min(9).max(20).nullable().optional(),
    avatar_url: z.string().url().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường để cập nhật');

export const CreateStaffSchema = z.object({
  cafe_id: z.string().uuid('cafe_id phải là UUID hợp lệ'),
  full_name: z.string().trim().min(2).max(255),
  email: z.string().trim().email('Email không hợp lệ').max(255),
  phone: z
    .string()
    .trim()
    .regex(/^(84|0[3|5|7|8|9])([0-9]{8})$/, 'Số điện thoại không hợp lệ')
    .optional(),
});

export const ActivateStaffSchema = z.object({
  token: z.string().min(1, 'Token không được để trống'),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(100),
});

export const TransferStaffSchema = z.object({
  cafe_id: z.string().uuid('cafe_id phải là UUID hợp lệ'),
});

// ── ai-chat ───────────────────────────────────────────────────────────────────

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Email không hợp lệ').max(255),
});

export const VerifyPasswordResetCodeSchema = z.object({
  email: z.string().email('Email không hợp lệ').max(255),
  code: z.string().regex(/^\d{6}$/, 'Mã xác nhận phải gồm đúng 6 chữ số'),
});

export const ResetPasswordWithCodeSchema = z.object({
  email: z.string().email('Email không hợp lệ').max(255),
  code: z.string().regex(/^\d{6}$/, 'Mã xác nhận phải gồm đúng 6 chữ số'),
  password: z
    .string()
    .min(6, 'Mật khẩu tối thiểu 6 ký tự')
    .max(100, 'Mật khẩu không được vượt quá 100 ký tự'),
});

export const ChatMessageSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        content: z.string().max(2000),
      }),
    )
    .max(20)
    .optional()
    .default([]),
});

export const UploadDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content_type: z.enum(['POLICY', 'FAQ', 'ANNOUNCEMENT', 'CUSTOM']).optional().default('CUSTOM'),
});

// ── cafes ────────────────────────────────────────────────────────────────────

const TrackTypeSchema = z.string().uuid();

export const CreateTrackTypeSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_]+$/)
    .openapi({ example: 'DRIFT' }),
  name: z.string().min(1).max(100).openapi({ example: 'Drift' }),
  description: z.string().max(1000).nullable().optional().openapi({ example: 'Đường đua drift' }),
  is_active: z.boolean().optional().default(true),
  sort_order: z.number().int().optional().default(0),
});

export const UpdateTrackTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const OperatingHourSchema = z.object({
  open: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  close: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  is_closed: z.boolean().optional(),
});

export const CafeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1).openapi({ example: 1 }),
  limit: z.coerce.number().int().positive().max(100).optional().default(20).openapi({
    example: 20,
  }),
  scope: z.enum(['managed']).optional().openapi({ example: 'managed' }),
  slug: z.string().min(1).max(120).optional().openapi({ example: 'rc-arena-sai-gon' }),
  district: z.string().min(1).max(100).optional().openapi({ example: 'Quan 7' }),
  city: z.string().min(1).max(100).optional().openapi({ example: 'TP. Ho Chi Minh' }),
  track_type: TrackTypeSchema.optional().openapi({
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  status: z.nativeEnum(CafeStatus).optional().openapi({ example: CafeStatus.ACTIVE }),
});

export const CreateCafeSchema = z.object({
  name: z.string().min(2).max(255).openapi({ example: 'RC Arena Sai Gon' }),
  description: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .openapi({ example: 'San RC trong nha voi duong drift va obstacle.' }),
  phone: z.string().min(9).max(20).nullable().optional().openapi({ example: '0901234567' }),
  cover_image_url: z
    .string()
    .url()
    .nullable()
    .optional()
    .openapi({ example: 'https://cdn.rcfield.vn/cafes/rc-arena-cover.jpg' }),
  address: z.string().min(5).max(500).openapi({ example: '15 Hoang Van Thai' }),
  district: z.string().min(1).max(100).openapi({ example: 'Quan 7' }),
  city: z.string().min(1).max(100).openapi({ example: 'TP. Ho Chi Minh' }),
  latitude: z.number().min(-90).max(90).nullable().optional().openapi({ example: 10.7403 }),
  longitude: z.number().min(-180).max(180).nullable().optional().openapi({ example: 106.712 }),
  operating_hours: z.record(OperatingHourSchema).optional().default({}),
  track_types: z
    .array(TrackTypeSchema)
    .min(1)
    .openapi({
      example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
    }),
  slot_duration_minutes: z.number().int().positive().max(1440).optional().default(60).openapi({
    example: 60,
  }),
  slot_fee_rate: z.number().nonnegative().openapi({ example: 50000 }),
  max_concurrent_bookings: z.number().int().positive().optional().default(10).openapi({
    example: 8,
  }),
  min_booking_notice_minutes: z.number().int().nonnegative().optional().default(60).openapi({
    example: 30,
  }),
  byoc_capacity: z.number().int().nonnegative().optional().default(5).openapi({ example: 4 }),
  amenity_ids: z.array(z.string().uuid()).optional().default([]),
  rules: z.array(z.string().min(1).max(500)).optional().default([]),
});

export const UpdateCafeSchema = CreateCafeSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

export const UpdateCafeStatusSchema = z.object({
  status: z.nativeEnum(CafeStatus),
});

const PromotionBaseSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/i, 'Mã ưu đãi chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới')
    .transform((value) => value.trim().toUpperCase()),
  description: z.string().max(2000).nullable().optional(),
  discount_type: z.nativeEnum(DiscountType),
  discount_value: z.coerce.number().positive(),
  max_discount_amount: z.coerce.number().positive().nullable().optional(),
  min_order_amount: z.coerce.number().nonnegative().nullable().optional(),
  max_uses: z.coerce.number().int().positive().nullable().optional(),
  max_uses_per_user: z.coerce.number().int().positive().optional().default(1),
  applicable_to: z.nativeEnum(PromoApplicableTo).optional().default(PromoApplicableTo.ALL),
  starts_at: z.coerce.date(),
  expires_at: z.coerce.date().nullable().optional(),
  schedule_mode: z.nativeEnum(PromotionScheduleMode).optional().default(PromotionScheduleMode.ONCE),
  schedule_start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  schedule_end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  schedule_weekdays: z
    .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
    .optional()
    .default([]),
  is_active: z.boolean().optional().default(true),
});

export const CreatePromotionSchema = PromotionBaseSchema.refine(
  (value) => value.discount_type !== DiscountType.PERCENT || value.discount_value <= 100,
  'Giảm giá phần trăm không được vượt quá 100%',
)
  .refine(
    (value) => !value.expires_at || value.expires_at > value.starts_at,
    'Thời gian hết hạn phải sau thời gian bắt đầu',
  )
  .refine(
    (value) =>
      value.schedule_mode !== PromotionScheduleMode.WEEKLY || value.schedule_weekdays.length > 0,
    'Vui lòng chọn ít nhất một ngày trong tuần',
  )
  .refine(
    (value) =>
      value.schedule_mode === PromotionScheduleMode.ONCE ||
      Boolean(value.schedule_start_time && value.schedule_end_time && value.expires_at),
    'Lịch lặp cần có ngày kết thúc và khung giờ bắt đầu/kết thúc',
  );

export const UpdatePromotionSchema = PromotionBaseSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường để cập nhật')
  .refine(
    (value) =>
      value.discount_type !== DiscountType.PERCENT ||
      value.discount_value === undefined ||
      value.discount_value <= 100,
    'Giảm giá phần trăm không được vượt quá 100%',
  )
  .refine(
    (value) => !value.expires_at || !value.starts_at || value.expires_at > value.starts_at,
    'Thời gian hết hạn phải sau thời gian bắt đầu',
  )
  .refine(
    (value) =>
      value.schedule_mode !== PromotionScheduleMode.WEEKLY ||
      !value.schedule_weekdays ||
      value.schedule_weekdays.length > 0,
    'Vui lòng chọn ít nhất một ngày trong tuần',
  );

export const PromotionIdParamsSchema = z.object({
  promotionId: z.string().uuid(),
});

const PackageBaseSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[A-Z0-9-]+$/i, 'Mã gói chỉ gồm chữ, số hoặc dấu gạch ngang')
    .transform((value) => value.trim().toUpperCase()),
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(2000).nullable().optional(),
  slot_count: z.coerce.number().int().positive(),
  billing_period: z.nativeEnum(PackageBillingPeriod),
  price: z.coerce.number().positive(),
  benefits: z.array(z.string().trim().min(1).max(255)).optional().default([]),
  applicable_play_modes: z
    .array(z.enum(['RENTAL', 'BYOC']))
    .min(1)
    .optional()
    .default(['RENTAL', 'BYOC']),
  is_popular: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
});

export const CreatePackageSchema = PackageBaseSchema;

export const UpdatePackageSchema = PackageBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

export const PackageIdParamsSchema = z.object({
  packageId: z.string().uuid(),
});

// ── contests ─────────────────────────────────────────────────────────────────

const ContestVehicleRuleSchema = z
  .object({
    allowed_sources: z.array(z.nativeEnum(VehicleSource)).min(1).optional(),
    requires_tech_check: z.boolean().optional(),
    notes: z.string().max(1000).optional(),
  })
  .passthrough()
  .optional()
  .default({});

const ContestBaseSchema = z.object({
  name: z.string().trim().min(3).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  track_type_id: z.string().uuid(),
  vehicle_rule: ContestVehicleRuleSchema,
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date(),
  registration_opens_at: z.coerce.date(),
  registration_closes_at: z.coerce.date(),
  capacity: z.coerce.number().int().positive().max(10000),
  entry_fee: z.coerce.number().nonnegative().optional().default(0),
  banner_image_url: z.string().url().nullable().optional(),
  config: z.record(z.any()).optional().default({}),
  participating_cafe_ids: z.array(z.string().uuid()).min(1),
});

function validContestTimeRange(value: {
  starts_at?: Date;
  ends_at?: Date;
  registration_opens_at?: Date;
  registration_closes_at?: Date;
}) {
  if (value.starts_at && value.ends_at && value.ends_at <= value.starts_at) return false;
  if (
    value.registration_opens_at &&
    value.registration_closes_at &&
    value.registration_closes_at <= value.registration_opens_at
  ) {
    return false;
  }
  if (
    value.starts_at &&
    value.registration_closes_at &&
    value.registration_closes_at > value.starts_at
  ) {
    return false;
  }
  return true;
}

export const CreateContestSchema = ContestBaseSchema.refine(validContestTimeRange, {
  message: 'Thời gian contest hoặc thời gian đăng ký không hợp lệ',
});

export const UpdateContestSchema = ContestBaseSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường để cập nhật')
  .refine(validContestTimeRange, {
    message: 'Thời gian contest hoặc thời gian đăng ký không hợp lệ',
  });

export const ContestIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ContestRegistrationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ContestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.nativeEnum(ContestStatus).optional(),
  upcoming: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  notify_within_hours: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .optional(),
});

export const RegisterContestSchema = z
  .object({
    vehicle_source: z.nativeEnum(VehicleSource).optional().default(VehicleSource.BYOC),
    vehicle_id: z.string().uuid().nullable().optional(),
    customer_vehicle_id: z.string().uuid().nullable().optional(),
    metadata: z.record(z.any()).optional().default({}),
  })
  .refine(
    (value) => value.vehicle_source !== VehicleSource.RENTAL || Boolean(value.vehicle_id),
    'Đăng ký xe thuê cần vehicle_id',
  )
  .refine(
    (value) => value.vehicle_source !== VehicleSource.BYOC || !value.vehicle_id,
    'Đăng ký BYOC không dùng vehicle_id thuê của cafe',
  );

export const CheckInContestRegistrationSchema = z.object({
  cafe_id: z.string().uuid(),
});

export const CancelContestRegistrationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const CafeImageCreateSchema = z.object({
  sort_order: z.coerce.number().int().min(0).optional().default(0),
});

export const CafeIdParamsSchema = z.object({
  cafeId: z.string().uuid().openapi({ example: '8e7f7c2a-6a5b-4a4c-9b9e-63b3e8c1f001' }),
});

export const CafeImageIdParamsSchema = z.object({
  id: z.string().uuid().openapi({ example: '9f4c9fb0-9c28-4b6b-a9c2-fdd4d13d1001' }),
});

export const CafeImageUploadSchema = z.object({
  files: z.array(z.string().openapi({ format: 'binary' })).min(1),
  sort_order: z.coerce.number().int().min(0).optional().default(0).openapi({ example: 0 }),
});

export const CafeResponseSchema = z.object({
  id: z.string().uuid().openapi({ example: '8e7f7c2a-6a5b-4a4c-9b9e-63b3e8c1f001' }),
  providerId: z.string().uuid().openapi({ example: '7f8d1fd7-5334-47e5-94a8-a8f69a70d001' }),
  name: z.string().openapi({ example: 'RC Arena Sai Gon' }),
  slug: z.string().openapi({ example: 'rc-arena-sai-gon' }),
  description: z.string().nullable().openapi({
    example: 'San RC trong nha voi duong drift va obstacle.',
  }),
  phone: z.string().nullable().openapi({ example: '0901234567' }),
  status: z.nativeEnum(CafeStatus).openapi({ example: CafeStatus.ACTIVE }),
  coverImageUrl: z.string().nullable().openapi({
    example: 'https://cdn.rcfield.vn/cafes/rc-arena-cover.jpg',
  }),
  address: z.string().openapi({ example: '15 Hoang Van Thai' }),
  district: z.string().openapi({ example: 'Quan 7' }),
  city: z.string().openapi({ example: 'TP. Ho Chi Minh' }),
  latitude: z.number().nullable().openapi({ example: 10.7403 }),
  longitude: z.number().nullable().openapi({ example: 106.712 }),
  operatingHours: z.record(OperatingHourSchema),
  trackTypes: z.array(TrackTypeSchema).openapi({
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  }),
  slotDurationMinutes: z.number().int().openapi({ example: 60 }),
  slotFeeRate: z.string().openapi({ example: '50000.00' }),
  maxConcurrentBookings: z.number().int().openapi({ example: 8 }),
  minBookingNoticeMinutes: z.number().int().openapi({ example: 30 }),
  byocCapacity: z.number().int().openapi({ example: 4 }),
  createdAt: z.string().datetime().openapi({ example: '2026-05-27T09:00:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2026-05-27T09:00:00.000Z' }),
  deletedAt: z.string().datetime().nullable().openapi({ example: null }),
});

export const CafeImageResponseSchema = z.object({
  id: z.string().uuid().openapi({ example: '9f4c9fb0-9c28-4b6b-a9c2-fdd4d13d1001' }),
  cafeId: z.string().uuid().openapi({ example: '8e7f7c2a-6a5b-4a4c-9b9e-63b3e8c1f001' }),
  url: z
    .string()
    .url()
    .openapi({ example: 'https://res.cloudinary.com/rcfield/image/upload/v1/cafes/track-1.png' }),
  sortOrder: z.number().int().openapi({ example: 0 }),
  createdAt: z.string().datetime().openapi({ example: '2026-05-27T09:00:00.000Z' }),
});

export const CreateAmenitySchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().min(1).max(50),
  sort_order: z.number().int().nonnegative().optional().default(0),
});
export const UpdateAmenitySchema = CreateAmenitySchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

// ── menu ─────────────────────────────────────────────────────────────────────

export const MenuListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1).openapi({ example: 1 }),
  limit: z.coerce.number().int().positive().max(100).optional().default(20).openapi({
    example: 20,
  }),
  category: z.string().min(1).max(100).optional().openapi({ example: 'Do uong' }),
  available: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'))
    .openapi({ example: 'true' }),
});

export const CreateMenuItemSchema = z.object({
  name: z.string().trim().min(2).max(255).openapi({ example: 'Cold Brew Nitro' }),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .openapi({ example: 'Ca phe lanh nitro dung kem muoi.' }),
  price: z.coerce.number().nonnegative().openapi({ example: 55000 }),
  category: z.string().trim().max(100).nullable().optional().openapi({ example: 'Do uong' }),
  image_url: z
    .string()
    .trim()
    .url()
    .nullable()
    .optional()
    .openapi({ example: 'https://cdn.rcfield.vn/menu/cold-brew.jpg' }),
  is_available: z.boolean().optional().default(true).openapi({ example: true }),
});

export const UpdateMenuItemSchema = CreateMenuItemSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

export const MenuItemParamsSchema = z.object({
  cafeId: z.string().uuid().openapi({ example: '8e7f7c2a-6a5b-4a4c-9b9e-63b3e8c1f001' }),
  itemId: z.string().uuid().openapi({ example: '56d971ce-83ef-4456-b391-7f5673f88001' }),
});

export const MenuItemResponseSchema = z.object({
  id: z.string().uuid().openapi({ example: '56d971ce-83ef-4456-b391-7f5673f88001' }),
  cafeId: z.string().uuid().openapi({ example: '8e7f7c2a-6a5b-4a4c-9b9e-63b3e8c1f001' }),
  name: z.string().openapi({ example: 'Cold Brew Nitro' }),
  description: z.string().nullable().openapi({ example: 'Ca phe lanh nitro dung kem muoi.' }),
  price: z.string().openapi({ example: '55000.00' }),
  category: z.string().nullable().openapi({ example: 'Do uong' }),
  imageUrl: z.string().nullable().openapi({ example: 'https://cdn.rcfield.vn/menu/cold-brew.jpg' }),
  isAvailable: z.boolean().openapi({ example: true }),
  createdAt: z.string().datetime().openapi({ example: '2026-05-27T09:00:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2026-05-27T09:00:00.000Z' }),
  deletedAt: z.string().datetime().nullable().openapi({ example: null }),
});

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Thời gian phải có định dạng HH:mm');

export const CafeClosureCreateSchema = z.object({
  closed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD'),
  start_time: TimeSchema,
  end_time: TimeSchema,
  reason: z.string().min(1).max(255),
});

export const CafeClosureUpdateSchema = CafeClosureCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

// ── fb-channel ────────────────────────────────────────────────────────────────

export const FbChannelQuerySchema = z.object({
  cafeId: z.string().uuid('cafeId phải là UUID hợp lệ'),
  returnPath: z.string().startsWith('/').optional(),
});

export const CreateVnpayPaymentSchema = z.object({
  amount: z.coerce.number().int().positive('amount phải lớn hơn 0'),
  txn_ref: z.string().trim().min(1).max(100),
  order_info: z.string().trim().min(1).max(255),
  order_type: z.string().trim().min(1).max(100).optional(),
  bank_code: z.string().trim().min(1).max(20).optional(),
  return_url: z.string().url().optional(),
});

// ── provider-onboarding & subscription ───────────────────────────────────────

export const RegisterProviderSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
  full_name: z.string().min(2).max(255),
  phone: z.string().min(9).max(20).optional(),
  business_name: z.string().min(2).max(255),
  business_description: z.string().max(1000).optional(),
});

export const SubmitPaymentRequestSchema = z.object({
  plan_id: z.string().uuid('plan_id phải là UUID hợp lệ'),
  transfer_reference: z.string().min(1).max(255),
  transfer_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'transfer_date phải có định dạng YYYY-MM-DD'),
  transfer_amount: z.number().positive('Số tiền phải lớn hơn 0'),
});

export const AdminRejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const AdminSuspendSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const NotificationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  unread_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const AdminPaymentRequestQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const AdminProviderQuerySchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const AdminConfirmPaymentSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const UpdateSubscriptionPlanSchema = z.object({
  branch_limit: z.number().int().min(-1).optional(),
  ai_quota_per_month: z.number().int().min(-1).optional(),
  channel_limit: z.number().int().min(-1).optional(),
  price_per_month: z.number().min(0).optional(),
});

export const WidgetConfigSchema = z.object({
  greeting_message: z.string().max(200).optional(),
  position: z.enum(['BOTTOM_RIGHT', 'BOTTOM_LEFT']).optional(),
  primary_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  avatar_url: z.string().url().nullable().optional(),
  quick_replies: z.array(z.string().max(50)).max(5).optional(),
  system_prompt: z.string().max(2000).nullable().optional(),
});

// ── vehicle catalog ──────────────────────────────────────────────────────────

const AssetTierSchema = z.nativeEnum(AssetTier);

export const CreateVehicleCatalogSchema = z.object({
  name: z.string().min(2).max(255).openapi({ example: 'Tamiya TT-02 Drift Spec' }),
  description: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .openapi({ example: 'Phù hợp cho người mới bắt đầu chơi drift.' }),
  tier: AssetTierSchema.openapi({ example: AssetTier.STANDARD }),
  hourly_rate: z.number().nonnegative().openapi({ example: 40000 }),
  security_deposit: z.number().nonnegative().openapi({ example: 200000 }),
  damage_multiplier: z
    .number()
    .min(0.1)
    .max(10.0)
    .optional()
    .default(1.0)
    .openapi({ example: 1.0 }),
  compatible_track_types: z
    .array(TrackTypeSchema)
    .min(1)
    .openapi({ example: ['550e8400-e29b-41d4-a716-446655440000'] }),
  cover_image_url: z
    .string()
    .url()
    .nullable()
    .optional()
    .openapi({ example: 'https://res.cloudinary.com/rcfield/image/upload/v1/vehicles/tamiya.jpg' }),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        sort_order: z.number().int().min(0).optional().default(0),
      }),
    )
    .optional()
    .openapi({
      example: [
        {
          url: 'https://res.cloudinary.com/rcfield/image/upload/v1/vehicles/tamiya-2.jpg',
          sort_order: 1,
        },
      ],
    }),
});

export const UpdateVehicleCatalogSchema = CreateVehicleCatalogSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

export const VehicleCatalogIdParamsSchema = z.object({
  catalogId: z.string().uuid().openapi({ example: '9f4c9fb0-9c28-4b6b-a9c2-fdd4d13d1002' }),
});

export const CreateVehicleUnitSchema = z.object({
  status: z.nativeEnum(VehicleStatus).optional().default(VehicleStatus.AVAILABLE),
  identifier: z.string().max(255).nullable().optional(),
  color: z.string().max(100).nullable().optional(),
  distinctive_image_url: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
});

export const UpdateVehicleUnitSchema = z
  .object({
    status: z.nativeEnum(VehicleStatus).optional(),
    last_maintenance_at: z.string().datetime().nullable().optional(),
    identifier: z.string().max(255).nullable().optional(),
    color: z.string().max(100).nullable().optional(),
    distinctive_image_url: z.string().url().nullable().optional(),
    notes: z.string().nullable().optional(),
    metadata: z.record(z.any()).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường để cập nhật');

export const VehicleUnitIdParamsSchema = z.object({
  catalogId: z.string().uuid(),
  unitId: z.string().uuid(),
});

export const ListVehicleUnitsQuerySchema = z.object({
  status: z.nativeEnum(VehicleStatus).optional(),
  catalog_id: z.string().uuid().optional(),
  search: z.string().optional(),
});

// ── cafe widget config ────────────────────────────────────────────────────────
export const UpsertWidgetConfigSchema = z.object({
  greeting_message: z.string().max(500).optional(),
  welcome_message: z.string().max(500).optional(),
  position: z.enum(['BOTTOM_RIGHT', 'BOTTOM_LEFT']).optional(),
  primary_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  avatar_url: z.string().url().nullable().optional(),
  quick_replies: z.array(z.string().max(100)).max(6).optional(),
  system_prompt: z.string().max(4000).nullable().optional(),
  is_enabled: z.boolean().optional(),
  full_page_enabled: z.boolean().optional(),
});

// ── cafe_track_configs ────────────────────────────────────────────────────────

export const CreateCafeTrackConfigSchema = z.object({
  track_type_id: z.string().uuid(),
  max_concurrent: z.number().int().min(1),
  byoc_capacity: z.number().int().min(0),
  description: z.string().max(500).optional(),
  sort_order: z.number().int().min(0).optional().default(0),
});

export const UpdateCafeTrackConfigSchema = z
  .object({
    max_concurrent: z.number().int().min(1).optional(),
    byoc_capacity: z.number().int().min(0).optional(),
    description: z.string().max(500).nullable().optional(),
    images: z.array(z.string().url()).max(20).optional(),
    sort_order: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field required' });

// ── bookings ──────────────────────────────────────────────────────────────────

const ParticipantSchema = z.object({
  user_id: z.string().uuid().optional(),
  participant_type: z.nativeEnum(BookingParticipantType),
  guest_name: z.string().max(255).optional(),
  guest_phone: z.string().max(20).optional(),
});

const FnbItemSchema = z.object({
  menu_item_id: z.string().uuid(),
  quantity: z.number().int().min(1),
  notes: z.string().max(500).optional(),
});

export const CreateBookingSchema = z.object({
  cafe_id: z.string().uuid(),
  play_mode: z.nativeEnum(BookingMode),
  track_type_id: z.string().uuid().optional(),
  track_config_id: z.string().uuid().optional(),
  slot_start: z.string().datetime({ offset: true }),
  slot_end: z.string().datetime({ offset: true }),
  vehicle_ids: z.array(z.string().uuid()).default([]),
  participants: z.array(ParticipantSchema).min(0).default([]),
  fnb_items: z.array(FnbItemSchema).default([]),
  promotion_code: z.string().max(50).optional(),
});

export const CancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const ListCafeBookingsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.nativeEnum(BookingStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ListMyBookingsSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const CheckAvailabilitySchema = z.object({
  slot_start: z.string().datetime({ offset: true }),
  slot_end: z.string().datetime({ offset: true }),
  play_mode: z.nativeEnum(BookingMode),
  track_type_id: z.string().uuid().optional(),
  track_config_id: z.string().uuid().optional(),
});

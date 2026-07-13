import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import {
  AssetTier,
  BookingParticipantType,
  BookingMode,
  BookingStatus,
  CafeStatus,
  ContestParticipantStatus,
  ContestStatus,
  CustomerPackageStatus,
  DiscountType,
  FnbCategory,
  FnbOrderStatus,
  PackageBillingPeriod,
  PromotionScheduleMode,
  PromoApplicableTo,
  ReviewStatus,
  VehicleStatus,
  VehicleSource,
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

export const ChangePasswordSchema = z.object({
  current_password: z.string().min(6, 'Mật khẩu hiện tại tối thiểu 6 ký tự'),
  new_password: z.string().min(6, 'Mật khẩu mới tối thiểu 6 ký tự').max(100),
});

export const UpdateDriverPassportSchema = z
  .object({
    driver_handle: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        'driver_handle chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang',
      )
      .optional(),
    display_name: z.string().trim().min(2).max(120).optional(),
    home_cafe_id: z.string().uuid().nullable().optional(),
    public_profile_enabled: z.boolean().optional(),
    leaderboard_opt_in: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường để cập nhật');

export const GlobalLeaderboardQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'all_time']).optional().default('all_time'),
  city: z.string().trim().min(1).max(100).optional(),
  cafe_id: z.string().uuid().optional(),
  vehicle_source: z.nativeEnum(VehicleSource).optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

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
  query: z.string().trim().min(1).max(200).optional().openapi({ example: 'Ho Chi Minh' }),
  scope: z.enum(['managed']).optional().openapi({ example: 'managed' }),
  slug: z.string().min(1).max(120).optional().openapi({ example: 'rc-arena-sai-gon' }),
  district: z.string().min(1).max(100).optional().openapi({ example: 'Quan 7' }),
  city: z.string().min(1).max(100).optional().openapi({ example: 'TP. Ho Chi Minh' }),
  track_type: TrackTypeSchema.optional().openapi({
    example: '550e8400-e29b-41d4-a716-446655440000',
  }),
  price_min: z.coerce.number().nonnegative().optional().openapi({ example: 50000 }),
  price_max: z.coerce.number().nonnegative().optional().openapi({ example: 200000 }),
  amenities: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return Array.isArray(value)
        ? value.flatMap((item) =>
            item
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean),
          )
        : value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
    })
    .openapi({ example: ['Serious Inspection', 'Mát lạnh Điều hòa'] }),
  vehicle_type: z.string().min(1).max(120).optional().openapi({ example: 'Drift' }),
  sort_by: z
    .enum(['popularity', 'price_asc', 'price_desc', 'rating'])
    .optional()
    .openapi({ example: 'popularity' }),
  popular_filters: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return Array.isArray(value)
        ? value.flatMap((item) =>
            item
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean),
          )
        : value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
    }),
  status: z.nativeEnum(CafeStatus).optional().openapi({ example: CafeStatus.ACTIVE }),
});

const CafeUpsertBaseSchema = z.object({
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
  slot_fee_rate: z.number().positive().openapi({ example: 50000 }),
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

export const CreateCafeSchema = CafeUpsertBaseSchema.refine(
  (value) =>
    value.latitude !== undefined &&
    value.latitude !== null &&
    value.longitude !== undefined &&
    value.longitude !== null &&
    value.latitude !== 0 &&
    value.longitude !== 0,
  {
    message: 'Tọa độ latitude/longitude là bắt buộc và không được bằng 0',
    path: ['latitude'],
  },
);

export const UpdateCafeSchema = CafeUpsertBaseSchema.partial().refine(
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
  show_on_cafe_page: z.boolean().optional().default(true),
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

// ── contests ────────────────────────────────────────────────────────────────

export const ContestCatalogTemplateQuerySchema = z.object({
  contest_type_id: z.string().uuid().optional(),
  contest_format_id: z.string().uuid().optional(),
  active_only: z.coerce.boolean().optional().default(true),
});

export const ContestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  scope: z.enum(['managed']).optional(),
  status: z.nativeEnum(ContestStatus).optional(),
  contest_type_id: z.string().uuid().optional(),
  contest_format_id: z.string().uuid().optional(),
  cafe_id: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(200).optional(),
});

export const MyContestRegistrationsQuerySchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  contest_status: z.nativeEnum(ContestStatus).optional(),
  customer_journey_status: z
    .enum([
      'PENDING_APPROVAL',
      'APPROVED_WAITING_CHECKIN',
      'READY_TO_RACE',
      'IN_BRACKET',
      'ADVANCED',
      'ELIMINATED',
      'FINISHED',
      'CANCELLED',
    ])
    .optional(),
});

export const ContestRegistrationsQuerySchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN']).optional(),
  payment_status: z
    .enum(['NOT_REQUIRED', 'PENDING_PAYMENT', 'PENDING_REVIEW', 'WAIVED', 'MARKED_PAID'])
    .optional(),
});

export const ContestMatchesQuerySchema = z.object({
  round_no: z.coerce.number().int().positive().optional(),
  status: z.enum(['DRAFT', 'READY', 'RUNNING', 'COMPLETED', 'CANCELLED']).optional(),
  cafe_id: z.string().uuid().optional(),
  participant_query: z.string().trim().min(1).max(200).optional(),
});

const ContestVehicleRuleSchema = z.object({
  vehicle_policy: z.enum(['RENTAL_ONLY', 'BYOC_ONLY', 'MIXED']),
  assignment_policy: z.enum(['AT_CHECK_IN', 'PRE_ASSIGNED']).optional().default('AT_CHECK_IN'),
});

const ContestUpsertBaseSchema = z.object({
  name: z.string().trim().min(3).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  contest_type_id: z.string().uuid(),
  contest_format_id: z.string().uuid(),
  contest_template_id: z.string().uuid(),
  track_type_id: z.string().uuid(),
  participating_cafe_ids: z.array(z.string().uuid()).min(1).max(20),
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date(),
  registration_opens_at: z.coerce.date(),
  registration_closes_at: z.coerce.date(),
  capacity: z.number().int().positive(),
  entry_fee: z.coerce.number().nonnegative().optional().default(0),
  banner_image_url: z.string().url().nullable().optional(),
  vehicle_rule: ContestVehicleRuleSchema,
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

export const CreateContestSchema = ContestUpsertBaseSchema.refine(
  (value) => value.ends_at > value.starts_at,
  {
    message: 'ends_at phải sau starts_at',
    path: ['ends_at'],
  },
)
  .refine((value) => value.registration_opens_at < value.registration_closes_at, {
    message: 'registration_closes_at phải sau registration_opens_at',
    path: ['registration_closes_at'],
  })
  .refine((value) => value.registration_closes_at <= value.starts_at, {
    message: 'registration_closes_at phải trước hoặc bằng starts_at',
    path: ['registration_closes_at'],
  });

export const UpdateContestSchema = ContestUpsertBaseSchema.partial().refine(
  (value: Record<string, unknown>) => Object.keys(value).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

export const CreateContestRegistrationSchema = z.object({
  booking_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  vehicle_source: z.nativeEnum(VehicleSource).default(VehicleSource.RENTAL),
});

export const ContestRegistrationActionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const ContestMarkFeePaidSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export const ContestCheckInSchema = z.object({
  checked_in_cafe_id: z.string().uuid(),
});

export const ContestGenerateMatchesSchema = z.object({
  cafe_id: z.string().uuid(),
  track_config_id: z.string().uuid().nullable().optional(),
  registration_ids: z.array(z.string().uuid()).min(1),
  drivers_per_match: z.number().int().positive().max(64).optional(),
  seeding_mode: z.enum(['MANUAL', 'CHECK_IN_ORDER']).optional(),
});

export const ContestMatchParticipantsUpdateSchema = z.object({
  participants: z
    .array(
      z.object({
        registration_id: z.string().uuid(),
        slot_no: z.number().int().positive(),
        lane: z.string().trim().max(20).nullable().optional(),
        grid_position: z.number().int().positive().nullable().optional(),
        seed_no: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(1),
});

export const ContestSubmitResultsSchema = z.object({
  results: z
    .array(
      z.object({
        registration_id: z.string().uuid(),
        finish_position: z.number().int().positive().nullable().optional(),
        score: z.coerce.number().nullable().optional(),
        best_lap_ms: z.number().int().positive().nullable().optional(),
        total_time_ms: z.number().int().positive().nullable().optional(),
        is_winner: z.boolean().optional().default(false),
        result_note: z.string().trim().max(1000).nullable().optional(),
        status: z.nativeEnum(ContestParticipantStatus).optional(),
      }),
    )
    .min(1),
  reason: z.string().trim().min(1).max(1000),
});

export const ContestCorrectResultsSchema = ContestSubmitResultsSchema.extend({
  force_cascade: z.boolean().optional().default(false),
});

export const PromotionIdParamsSchema = z.object({
  promotionId: z.string().uuid(),
});

export const PreviewPromoSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .transform((v) => v.trim().toUpperCase()),
  play_mode: z.enum(['RENTAL', 'BYOC']),
  slot_start: z.string().datetime({ offset: true }),
  subtotal: z.coerce.number().nonnegative(),
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

const CafePromotionSummarySchema = z.object({
  code: z.string().openapi({ example: 'SUMMER25' }),
  description: z.string().nullable().openapi({ example: 'Giảm 25% cho slot đầu tiên' }),
  discount_type: z.nativeEnum(DiscountType).openapi({ example: DiscountType.PERCENT }),
  discount_value: z.number().openapi({ example: 25 }),
  max_discount_amount: z.number().nullable().openapi({ example: 50000 }),
  min_order_amount: z.number().nullable().openapi({ example: 100000 }),
  applicable_to: z.nativeEnum(PromoApplicableTo).openapi({ example: PromoApplicableTo.ALL }),
  expires_at: z.string().datetime().nullable().openapi({ example: '2026-08-01T00:00:00.000Z' }),
});

const TrackTypeResponseSchema = z.object({
  id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  code: z.string().openapi({ example: 'DRIFT' }),
  name: z.string().openapi({ example: 'Drift' }),
  description: z.string().nullable().openapi({ example: 'Đường đua drift' }),
  sortOrder: z.number().int().openapi({ example: 0 }),
  isActive: z.boolean().openapi({ example: true }),
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
  trackTypes: z.array(TrackTypeResponseSchema).openapi({ example: [] }),
  slotDurationMinutes: z.number().int().openapi({ example: 60 }),
  slotFeeRate: z.string().openapi({ example: '50000.00' }),
  maxConcurrentBookings: z.number().int().openapi({ example: 8 }),
  minBookingNoticeMinutes: z.number().int().openapi({ example: 30 }),
  byocCapacity: z.number().int().openapi({ example: 4 }),
  amenityIds: z.array(z.string().uuid()).openapi({ example: [] }),
  amenities: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        description: z.string().nullable(),
        icon: z.string(),
        sortOrder: z.number().int(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
      }),
    )
    .openapi({ example: [] }),
  rating: z.number().openapi({ example: 4.8 }),
  reviewsCount: z.number().int().openapi({ example: 124 }),
  minPrice: z.number().openapi({ example: 50000 }),
  activePromotions: z.array(CafePromotionSummarySchema).openapi({ example: [] }),
  rules: z.array(z.string()).openapi({ example: [] }),
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
  category: z.nativeEnum(FnbCategory).optional().openapi({ example: FnbCategory.DRINK }),
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
  category: z.nativeEnum(FnbCategory).nullable().optional().openapi({ example: FnbCategory.DRINK }),
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

export const CreateComboSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(2000).nullable().optional(),
  price: z.coerce.number().nonnegative(),
  image_url: z.string().trim().url().nullable().optional(),
  is_available: z.boolean().optional().default(true),
  components: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        quantity: z.number().int().positive().max(99),
      }),
    )
    .min(2, 'Combo phải có ít nhất 2 món'),
});

export const UpdateComboSchema = CreateComboSchema.partial().refine(
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
  business_type: z.enum(['INDIVIDUAL', 'BUSINESS'], {
    errorMap: () => ({ message: 'business_type phải là INDIVIDUAL hoặc BUSINESS' }),
  }),
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
  security_deposit: z.number().nonnegative().optional().default(0).openapi({ example: 0 }),
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

export const CreateCafeTrackConfigSchema = z
  .object({
    track_type_id: z.string().uuid(),
    max_concurrent: z.coerce.number().int().min(0),
    byoc_capacity: z.coerce.number().int().min(0),
    description: z.string().max(500).optional(),
    sort_order: z.coerce.number().int().min(0).optional().default(0),
  })
  .refine((b) => b.max_concurrent > 0 || b.byoc_capacity > 0, {
    message: 'Ít nhất một trong hai phải lớn hơn 0: max_concurrent hoặc byoc_capacity',
    path: ['max_concurrent'],
  });

export const UpdateCafeTrackConfigSchema = z
  .object({
    max_concurrent: z.coerce.number().int().min(0).optional(),
    byoc_capacity: z.coerce.number().int().min(0).optional(),
    description: z.string().max(500).nullable().optional(),
    images: z.array(z.string().url()).max(20).optional(),
    sort_order: z.coerce.number().int().min(0).optional(),
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
  customer_package_id: z.string().uuid().optional(),
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

// ── customer_packages ─────────────────────────────────────────────────────────

export const PurchasePackageSchema = z.object({});

export const ListMyPackagesQuerySchema = z.object({
  status: z.nativeEnum(CustomerPackageStatus).optional(),
  cafe_id: z.string().uuid().optional(),
});

// ── staff fnb ─────────────────────────────────────────────────────────────────

export const UpdateFnbOrderStatusSchema = z.object({
  status: z.nativeEnum(FnbOrderStatus),
});

// ── pricing ───────────────────────────────────────────────────────────────────

const PeakHourInputSchema = z
  .object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    multiplier: z.number().min(1.0).max(10.0),
  })
  .refine((d) => d.start < d.end, { message: 'start must be before end' });

export const UpdatePricingRulesSchema = z
  .object({
    weekend_multiplier: z.number().min(1.0).max(10.0).nullable(),
    peak_hours: z.array(PeakHourInputSchema).max(5),
  })
  .refine(
    (d) => {
      const windows = d.peak_hours;
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          if (windows[i].start < windows[j].end && windows[j].start < windows[i].end) return false;
        }
      }
      return true;
    },
    { message: 'Peak hour windows must not overlap' },
  );

export const PricingPreviewQuerySchema = z.object({
  slot_start: z.string().datetime({ offset: true }),
  slot_end: z.string().datetime({ offset: true }),
});

export const CreateHolidaySchema = z.object({
  date: z.string().date(),
  name: z.string().min(1).max(255),
  multiplier: z.number().min(1.0).max(10.0),
});

export const UpdateHolidaySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  multiplier: z.number().min(1.0).max(10.0),
});

export const ListHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(2024).max(2099).optional(),
});

// ── reviews ───────────────────────────────────────────────────────────────────

export const CreateReviewSchema = z.object({
  booking_id: z.string().uuid(),
  overall_score: z.number().int().min(1).max(5),
  vehicle_score: z.number().int().min(1).max(5).nullable().optional(),
  staff_score: z.number().int().min(1).max(5).nullable().optional(),
  facility_score: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const UpdateReviewVisibilitySchema = z.object({
  status: z.nativeEnum(ReviewStatus),
});

export const CreateWalkInBookingSchema = z
  .object({
    play_mode: z.nativeEnum(BookingMode),
    track_type_id: z.string().uuid(),
    slot_start: z.string().datetime({ offset: true }),
    slot_end: z.string().datetime({ offset: true }),
    payment_method: z.enum(['CASH', 'BANK_TRANSFER']),
    vehicle_ids: z.array(z.string().uuid()).default([]),
    participants: z
      .array(
        z.object({
          guest_name: z.string().trim().min(1, 'Tên người chơi không được để trống'),
          guest_phone: z
            .string()
            .trim()
            .regex(/^(84|0[3|5|7|8|9])([0-9]{8})$/, 'Số điện thoại không hợp lệ'),
          participant_type: z.literal(BookingParticipantType.WALK_IN_GUEST),
        }),
      )
      .min(1, 'Phải có ít nhất 1 người chơi tham gia'),
  })
  .superRefine((data, ctx) => {
    if (data.play_mode === BookingMode.RENTAL && data.vehicle_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicle_ids'],
        message: 'Chế độ chơi RENTAL yêu cầu chọn ít nhất 1 xe thuê',
      });
    }
    if (data.play_mode === BookingMode.BYOC && data.vehicle_ids.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicle_ids'],
        message: 'Chế độ chơi BYOC không được chọn xe của cửa hàng',
      });
    }
  });

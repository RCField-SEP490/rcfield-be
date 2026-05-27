import { z } from 'zod';
import { CafeStatus, TrackType } from '../types';

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

const TrackTypeSchema = z.nativeEnum(TrackType);

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
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  district: z.string().min(1).max(100).optional(),
  city: z.string().min(1).max(100).optional(),
  track_type: TrackTypeSchema.optional(),
  status: z.nativeEnum(CafeStatus).optional(),
});

export const CreateCafeSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(2000).nullable().optional(),
  phone: z.string().min(9).max(20).nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
  address: z.string().min(5).max(500),
  district: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  operating_hours: z.record(OperatingHourSchema).optional().default({}),
  track_types: z.array(TrackTypeSchema).min(1),
  slot_duration_minutes: z.number().int().positive().max(1440).optional().default(60),
  slot_fee_rate: z.number().nonnegative(),
  max_concurrent_bookings: z.number().int().positive().optional().default(10),
  min_booking_notice_minutes: z.number().int().nonnegative().optional().default(60),
  byoc_capacity: z.number().int().nonnegative().optional().default(5),
});

export const UpdateCafeSchema = CreateCafeSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

export const UpdateCafeStatusSchema = z.object({
  status: z.nativeEnum(CafeStatus),
});

// ── fb-channel ────────────────────────────────────────────────────────────────

export const FbChannelQuerySchema = z.object({
  cafeId: z.string().uuid('cafeId phải là UUID hợp lệ'),
  returnPath: z.string().startsWith('/').optional(),
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

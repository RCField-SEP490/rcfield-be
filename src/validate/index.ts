import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const GoogleSchema = z.object({
  id_token: z.string().min(1),
});

export const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const LogoutSchema = z.object({
  refresh_token: z.string().min(1),
});

// ── ai-chat ───────────────────────────────────────────────────────────────────

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

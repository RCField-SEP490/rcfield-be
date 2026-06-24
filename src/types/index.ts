// ── User ─────────────────────────────────────────────────────────────────────

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  PROVIDER = 'PROVIDER',
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
}

export enum AuthProvider {
  LOCAL = 'LOCAL',
  GOOGLE = 'GOOGLE',
}

export enum TrustScoreReason {
  NO_SHOW = 'NO_SHOW',
  DAMAGE_CONFIRMED = 'DAMAGE_CONFIRMED',
  DISPUTE_LOST = 'DISPUTE_LOST',
  BOOKING_STREAK = 'BOOKING_STREAK',
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
}

// ── Cafe ─────────────────────────────────────────────────────────────────────

export enum CafeStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export interface TrackTypeDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CafeOperatingHour {
  open?: string;
  close?: string;
  is_closed?: boolean;
}

export type CafeOperatingHours = Record<string, CafeOperatingHour>;

// ── Vehicle ───────────────────────────────────────────────────────────────────

export enum AssetTier {
  STANDARD = 'STANDARD',
  PREMIUM = 'PREMIUM',
  RESTRICTED = 'RESTRICTED',
}

export enum VehicleStatus {
  AVAILABLE = 'AVAILABLE',
  IN_USE = 'IN_USE',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
}

// ── Booking ───────────────────────────────────────────────────────────────────

export enum BookingMode {
  RENTAL = 'RENTAL',
  BYOC = 'BYOC',
}

export enum BookingSource {
  APP = 'APP',
  STAFF_MANUAL = 'STAFF_MANUAL',
}

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  NO_SHOW = 'NO_SHOW',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum SessionStatus {
  CHECKED_IN = 'CHECKED_IN',
  ACTIVE = 'ACTIVE',
  EXTENDING = 'EXTENDING',
  CHECKING_OUT = 'CHECKING_OUT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum BookingParticipantType {
  BOOKER = 'BOOKER',
  REGISTERED_USER = 'REGISTERED_USER',
  WALK_IN_GUEST = 'WALK_IN_GUEST',
}

// ── Payment ───────────────────────────────────────────────────────────────────

export enum PaymentComponentType {
  SLOT_FEE = 'SLOT_FEE',
  RENTAL_FEE = 'RENTAL_FEE',
  SECURITY_DEPOSIT = 'SECURITY_DEPOSIT',
  EXTENSION_FEE = 'EXTENSION_FEE',
  DAMAGE_CHARGE = 'DAMAGE_CHARGE',
  FB_PREORDER = 'FNB_PREORDER',
  PACKAGE_PURCHASE = 'PACKAGE_PURCHASE',
}

export enum CustomerPackageStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  ACTIVE = 'ACTIVE',
  EXHAUSTED = 'EXHAUSTED',
  EXPIRED = 'EXPIRED',
}

export enum PaymentComponentStatus {
  PENDING = 'PENDING',
  HELD = 'HELD',
  DISBURSED = 'DISBURSED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export enum PaymentTransactionType {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
}

export enum PaymentTransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum DiscountType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export enum PromoApplicableTo {
  ALL = 'ALL',
  RENTAL = 'RENTAL',
  BYOC = 'BYOC',
}

export enum PromotionScheduleMode {
  ONCE = 'ONCE',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
}

export enum PackageBillingPeriod {
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export enum PackageStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}

// ── Inspection ────────────────────────────────────────────────────────────────

export enum InspectionType {
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT',
}

// ── Dispute ───────────────────────────────────────────────────────────────────

export enum DisputeStatus {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  RESOLVED = 'RESOLVED',
}

// ── F&B ───────────────────────────────────────────────────────────────────────

export enum FnbOrderType {
  PRE_ORDER = 'PRE_ORDER',
  ON_SITE = 'ON_SITE',
}

export enum FnbOrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// ── Notification ──────────────────────────────────────────────────────────────

export enum NotificationChannel {
  PUSH = 'PUSH',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}

// ── Provider Onboarding & Subscription ───────────────────────────────────────

export enum ProviderStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  GRACE_PERIOD = 'GRACE_PERIOD',
  EXPIRED = 'EXPIRED',
}

export enum PlanName {
  TRIAL = 'TRIAL',
  STARTER = 'STARTER',
  GROWTH = 'GROWTH',
  PRO = 'PRO',
}

export enum PaymentRequestStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

export enum NotificationType {
  ACCOUNT_APPROVED = 'ACCOUNT_APPROVED',
  ACCOUNT_REJECTED = 'ACCOUNT_REJECTED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_UNSUSPENDED = 'ACCOUNT_UNSUSPENDED',
  TRIAL_EXPIRING_SOON = 'TRIAL_EXPIRING_SOON',
  GRACE_PERIOD_STARTED = 'GRACE_PERIOD_STARTED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_ACTIVATED = 'SUBSCRIPTION_ACTIVATED',
  PAYMENT_REQUEST_CONFIRMED = 'PAYMENT_REQUEST_CONFIRMED',
  PAYMENT_REQUEST_REJECTED = 'PAYMENT_REQUEST_REJECTED',
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export enum PricingRuleType {
  WEEKEND = 'WEEKEND',
  PEAK_HOURS = 'PEAK_HOURS',
}

export enum HolidayType {
  SYSTEM = 'SYSTEM',
  CUSTOM = 'CUSTOM',
}

// ── Express extensions ────────────────────────────────────────────────────────

import { Request } from 'express';

export interface AuthPayload {
  userId: string;
  role: UserRole;
  email: string;
  cafeId?: string;
  impersonated_by?: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

// ── AI Chat ───────────────────────────────────────────────────────────────────

export enum KbDocumentStatus {
  PENDING = 'PENDING',
  INDEXED = 'INDEXED',
  FAILED = 'FAILED',
}

export enum KbContentType {
  POLICY = 'POLICY',
  FAQ = 'FAQ',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  CUSTOM = 'CUSTOM',
}

export enum WidgetPosition {
  BOTTOM_RIGHT = 'BOTTOM_RIGHT',
  BOTTOM_LEFT = 'BOTTOM_LEFT',
}

export type ChatResponseType =
  | 'greeting'
  | 'thanks'
  | 'farewell'
  | 'text'
  | 'slot_list'
  | 'vehicle_list';

export interface SlotItem {
  time: string;
  availableCount: number;
}

export interface VehicleItem {
  name: string;
  tier: string;
  hourlyRate: number;
  status: string;
}

export interface ChatResponse {
  answer: string;
  responseType: ChatResponseType;
  data?: {
    date?: string;
    slots?: SlotItem[];
    vehicles?: VehicleItem[];
  };
  sources?: string[];
  quickReplies?: string[];
}

// ── Channel ───────────────────────────────────────────────────────────────────

export enum ChannelType {
  FACEBOOK_MESSENGER = 'FACEBOOK_MESSENGER',
}

export enum ChannelStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
}

export interface FbFormattedMessage {
  text: string;
  quickReplies: FbQuickReply[];
}

export interface FbQuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

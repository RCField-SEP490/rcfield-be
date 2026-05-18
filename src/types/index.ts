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

export enum TrackType {
  DRIFT = 'DRIFT',
  OBSTACLE = 'OBSTACLE',
  HILL_CLIMB = 'HILL_CLIMB',
}

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
  ACTIVE = 'ACTIVE',
  EXTENDING = 'EXTENDING',
  CHECKING_OUT = 'CHECKING_OUT',
  DISPUTED = 'DISPUTED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// ── Payment ───────────────────────────────────────────────────────────────────

export enum PaymentComponentType {
  SLOT_FEE = 'SLOT_FEE',
  RENTAL_FEE = 'RENTAL_FEE',
  SECURITY_DEPOSIT = 'SECURITY_DEPOSIT',
  EXTENSION_FEE = 'EXTENSION_FEE',
  DAMAGE_CHARGE = 'DAMAGE_CHARGE',
  FB_PREORDER = 'FB_PREORDER',
}

export enum PaymentComponentStatus {
  PENDING = 'PENDING',
  HELD = 'HELD',
  DISBURSED = 'DISBURSED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export enum DiscountType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
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

// ── Express extensions ────────────────────────────────────────────────────────

import { Request } from 'express';

export interface AuthPayload {
  userId: string;
  role: UserRole;
  email: string;
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

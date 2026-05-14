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

export enum CafeStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum VehicleTier {
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

export enum InspectionType {
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT',
}

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

export enum NotificationChannel {
  PUSH = 'PUSH',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}

export enum TrustScoreReason {
  NO_SHOW = 'NO_SHOW',
  DAMAGE_CONFIRMED = 'DAMAGE_CONFIRMED',
  DISPUTE_LOST = 'DISPUTE_LOST',
  BOOKING_STREAK = 'BOOKING_STREAK',
  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',
}

export enum DiscountType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

// Express request extension
import { Request } from 'express';

export interface AuthPayload {
  userId: string;
  role: UserRole;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

// AppError
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

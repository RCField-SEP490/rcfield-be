import { ContestBanScopeType, ContestStatus, VehicleSource } from '../../types';
import { Viewer } from '../cafe.service';

export type ListContestsOptions = {
  page: number;
  limit: number;
  scope?: 'managed';
  status?: ContestStatus;
  contest_type_id?: string;
  contest_format_id?: string;
  cafe_id?: string;
  query?: string;
  viewer?: Viewer;
};

export type CreateContestBody = {
  name: string;
  description?: string | null;
  contest_type_id: string;
  contest_format_id: string;
  contest_template_id: string;
  track_type_id: string;
  participating_cafe_ids: string[];
  starts_at: Date;
  ends_at: Date;
  registration_opens_at: Date;
  registration_closes_at: Date;
  capacity: number;
  entry_fee: number;
  banner_image_url?: string | null;
  vehicle_rule: Record<string, unknown>;
  config: Record<string, unknown>;
};

export type UpdateContestBody = Partial<CreateContestBody>;

export type CreateRegistrationBody = {
  booking_id?: string;
  vehicle_id?: string;
  vehicle_source: VehicleSource;
  rental_slot?: {
    cafe_id: string;
    slot_start: string | Date;
    slot_end: string | Date;
    track_config_id?: string | null;
    vehicle_catalog_id?: string | null;
  } | null;
  byoc_vehicle_name?: string;
  byoc_vehicle_brand?: string;
  byoc_vehicle_class?: string;
  byoc_vehicle_notes?: string;
};

export type MyContestRegistrationsQuery = {
  query?: string;
  contest_status?: ContestStatus;
  customer_journey_status?:
    | 'PENDING_APPROVAL'
    | 'APPROVED_WAITING_CHECKIN'
    | 'CHECKED_IN_WAITING_BRACKET'
    | 'IN_BRACKET'
    | 'ADVANCED'
    | 'ELIMINATED'
    | 'FINISHED'
    | 'CANCELLED';
};

export type ContestRegistrationsQuery = {
  query?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'CHECKED_IN';
  payment_status?: 'NOT_REQUIRED' | 'PENDING_PAYMENT' | 'PENDING_REVIEW' | 'WAIVED' | 'MARKED_PAID';
};

export type ContestBanPayload = {
  user_id: string;
  scope_type: ContestBanScopeType;
  reason: string;
  evidence?: Record<string, unknown>;
  expires_at?: Date | null;
};

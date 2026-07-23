import { AppDataSource } from '../config/database';
import { Cafe } from '../models/cafe.entity';
import { CafeTrackConfig } from '../models/cafe-track-config.entity';
import { Contest } from '../models/contest.entity';
import { VehicleCatalog } from '../models/vehicle-catalog.entity';
import { Vehicle } from '../models/vehicle.entity';
import { AppError, BookingMode, BookingSource, BookingStatus, VehicleStatus } from '../types';
import { createBooking, CreateBookingBody } from './booking.service';
import { ContestCafe } from '../models/contest-cafe.entity';

export type ContestRentalSlotInput = {
  cafe_id: string;
  slot_start: string | Date;
  slot_end: string | Date;
  track_config_id?: string | null;
  vehicle_catalog_id?: string | null;
};

export type CreateContestRentalBookingResult = {
  booking_id: string;
  vehicle_id: string;
  total_amount: number;
  breakdown: {
    slot_fee: number;
    rental_fee: number;
    total: number;
  };
};

export type ContestRentalOptions = {
  cafes: Array<{
    id: string;
    name: string;
    city: string | null;
    district: string | null;
  }>;
  track_configs: Array<{
    id: string;
    cafe_id: string;
    track_type_id: string;
    track_type_name: string | null;
    max_concurrent: number;
  }>;
  vehicle_catalogs: Array<{
    id: string;
    cafe_id: string;
    name: string;
    tier: string;
    hourly_rate: number;
    cover_image_url: string | null;
    compatible_track_types: string[];
  }>;
};

export async function createContestRentalBooking(
  contest: Contest,
  customerId: string,
  slot: ContestRentalSlotInput,
): Promise<CreateContestRentalBookingResult> {
  const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
    where: { contestId: contest.id, cafeId: slot.cafe_id },
  });
  if (!contestCafe) {
    throw new AppError('Chi nhánh không tham gia contest', 400, 'CONTEST_CAFE_INVALID');
  }

  const cafe = await AppDataSource.getRepository(Cafe).findOne({
    where: { id: slot.cafe_id },
  });
  if (!cafe) {
    throw new AppError('Cafe không tồn tại', 404, 'CAFE_NOT_FOUND');
  }

  let trackConfigId: string | undefined;
  let trackTypeId: string | undefined;
  if (slot.track_config_id) {
    const trackConfig = await AppDataSource.getRepository(CafeTrackConfig).findOne({
      where: { id: slot.track_config_id, cafeId: slot.cafe_id, isActive: true },
    });
    if (!trackConfig) {
      throw new AppError(
        'Track config không tồn tại hoặc không hoạt động',
        400,
        'TRACK_CONFIG_NOT_FOUND',
      );
    }
    trackConfigId = trackConfig.id;
    trackTypeId = trackConfig.trackTypeId;
  }

  // Validate track type matches contest if track config is provided.
  if (contest.trackTypeId && trackTypeId && trackTypeId !== contest.trackTypeId) {
    throw new AppError(
      'Track config không khớp loại đường đua của contest',
      400,
      'TRACK_TYPE_MISMATCH',
    );
  }

  const vehicle = await resolveContestRentalVehicle(slot, contest.trackTypeId);

  const bookingBody: CreateBookingBody = {
    cafe_id: slot.cafe_id,
    play_mode: BookingMode.RENTAL,
    slot_start:
      typeof slot.slot_start === 'string' ? slot.slot_start : slot.slot_start.toISOString(),
    slot_end: typeof slot.slot_end === 'string' ? slot.slot_end : slot.slot_end.toISOString(),
    vehicle_ids: [vehicle.id],
    participants: [],
    fnb_items: [],
    track_config_id: trackConfigId,
    track_type_id: trackTypeId ?? contest.trackTypeId ?? undefined,
    contest_id: contest.id,
    source: BookingSource.CONTEST,
  };

  const bookingResult = await createBooking(customerId, bookingBody);

  return {
    booking_id: bookingResult.booking_id,
    vehicle_id: vehicle.id,
    total_amount: bookingResult.total_amount,
    breakdown: {
      slot_fee: bookingResult.breakdown.slot_fee,
      rental_fee: bookingResult.breakdown.rental_fee,
      total: bookingResult.breakdown.total,
    },
  };
}

async function resolveContestRentalVehicle(
  slot: ContestRentalSlotInput,
  contestTrackTypeId?: string | null,
): Promise<Vehicle> {
  const vehicleRepo = AppDataSource.getRepository(Vehicle);
  const catalogRepo = AppDataSource.getRepository(VehicleCatalog);

  let catalog: VehicleCatalog | null = null;
  if (slot.vehicle_catalog_id) {
    catalog = await catalogRepo.findOne({
      where: { id: slot.vehicle_catalog_id, cafeId: slot.cafe_id },
    });
    if (!catalog) {
      throw new AppError('Catalog xe không tồn tại', 404, 'VEHICLE_CATALOG_NOT_FOUND');
    }
  }

  if (catalog && contestTrackTypeId && catalog.compatibleTrackTypes.length > 0) {
    if (!catalog.compatibleTrackTypes.includes(contestTrackTypeId)) {
      throw new AppError(
        'Xe không tương thích với loại đường đua của contest',
        400,
        'VEHICLE_TRACK_INCOMPATIBLE',
      );
    }
  }

  if (catalog) {
    const vehicle = await vehicleRepo.findOne({
      where: {
        catalogId: catalog.id,
        cafeId: slot.cafe_id,
        status: VehicleStatus.AVAILABLE,
      },
    });
    if (!vehicle) {
      throw new AppError('Không có xe khả dụng cho catalog này', 400, 'VEHICLE_UNAVAILABLE');
    }
    return vehicle;
  }

  // If no catalog specified, pick any available vehicle at the cafe.
  const vehicle = await vehicleRepo.findOne({
    where: { cafeId: slot.cafe_id, status: VehicleStatus.AVAILABLE },
  });
  if (!vehicle) {
    throw new AppError('Không có xe thuê khả dụng tại chi nhánh này', 400, 'VEHICLE_UNAVAILABLE');
  }
  return vehicle;
}

export async function getContestRentalOptions(contestId: string): Promise<ContestRentalOptions> {
  const contestCafes = await AppDataSource.getRepository(ContestCafe).find({
    where: { contestId },
    order: { displayOrder: 'ASC' },
  });
  const cafeIds = contestCafes.map((item) => item.cafeId);

  const cafes = await AppDataSource.getRepository(Cafe).find({
    where: cafeIds.map((id) => ({ id })),
  });

  const trackConfigs = await AppDataSource.getRepository(CafeTrackConfig).find({
    where: cafeIds.map((id) => ({ cafeId: id, isActive: true })),
  });

  const catalogs = await AppDataSource.getRepository(VehicleCatalog).find({
    where: cafeIds.map((id) => ({ cafeId: id })),
  });

  const trackConfigRows = trackConfigs.map((item) => ({
    id: item.id,
    cafe_id: item.cafeId,
    track_type_id: item.trackTypeId,
    track_type_name: null, // populated by caller if needed
    max_concurrent: item.maxConcurrent,
  }));

  return {
    cafes: cafes.map((item) => ({
      id: item.id,
      name: item.name,
      city: item.city ?? null,
      district: item.district ?? null,
    })),
    track_configs: trackConfigRows,
    vehicle_catalogs: catalogs.map((item) => ({
      id: item.id,
      cafe_id: item.cafeId,
      name: item.name,
      tier: item.tier,
      hourly_rate: Number(item.hourlyRate),
      cover_image_url: item.coverImageUrl ?? null,
      compatible_track_types: item.compatibleTrackTypes,
    })),
  };
}

export async function getContestAvailableRentalVehicles(
  contestId: string,
  slot: ContestRentalSlotInput,
): Promise<
  Array<{
    catalog_id: string;
    catalog_name: string;
    tier: string;
    hourly_rate: number;
    cover_image_url: string | null;
    available_units: Array<{ id: string; identifier: string | null; color: string | null }>;
  }>
> {
  const contestCafe = await AppDataSource.getRepository(ContestCafe).findOne({
    where: { contestId, cafeId: slot.cafe_id },
  });
  if (!contestCafe) {
    throw new AppError('Chi nhánh không tham gia contest', 400, 'CONTEST_CAFE_INVALID');
  }

  const slotStart = new Date(slot.slot_start);
  const slotEnd = new Date(slot.slot_end);

  const catalogs = await AppDataSource.getRepository(VehicleCatalog).find({
    where: { cafeId: slot.cafe_id },
  });
  const vehicles = await AppDataSource.getRepository(Vehicle).find({
    where: { cafeId: slot.cafe_id, status: VehicleStatus.AVAILABLE },
  });

  const bookedVehicleIds = new Set(
    (
      await AppDataSource.query<{ vehicle_id: string }[]>(
        `SELECT DISTINCT bv.vehicle_id
         FROM booking_vehicles bv
         JOIN bookings b ON b.id = bv.booking_id
         WHERE b.cafe_id = $1
           AND b.play_mode = $2
           AND b.status IN ($3, $4)
           AND b.slot_start < $5
           AND b.slot_end > $6`,
        [
          slot.cafe_id,
          BookingMode.RENTAL,
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          slotEnd,
          slotStart,
        ],
      )
    ).map((row) => row.vehicle_id),
  );

  return catalogs.map((catalog) => ({
    catalog_id: catalog.id,
    catalog_name: catalog.name,
    tier: catalog.tier,
    hourly_rate: Number(catalog.hourlyRate),
    cover_image_url: catalog.coverImageUrl ?? null,
    available_units: vehicles
      .filter((vehicle) => vehicle.catalogId === catalog.id && !bookedVehicleIds.has(vehicle.id))
      .map((vehicle) => ({
        id: vehicle.id,
        identifier: vehicle.identifier,
        color: vehicle.color,
      })),
  }));
}

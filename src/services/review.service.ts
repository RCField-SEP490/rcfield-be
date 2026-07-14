import { AppDataSource } from '../config/database';
import { Review } from '../models/review.entity';
import { Booking } from '../models/booking.entity';
import { AppError, BookingMode, BookingStatus, ReviewStatus } from '../types';

const REVIEW_WINDOW_DAYS = 5;

// ── US1: Submit review ────────────────────────────────────────────────────────

export interface CreateReviewBody {
  booking_id: string;
  overall_score: number;
  vehicle_score?: number | null;
  staff_score?: number | null;
  facility_score?: number | null;
  note?: string | null;
}

export async function createReview(customerId: string, body: CreateReviewBody): Promise<Review> {
  const bookingRepo = AppDataSource.getRepository(Booking);
  const reviewRepo = AppDataSource.getRepository(Review);

  const booking = await bookingRepo.findOne({ where: { id: body.booking_id } });
  if (!booking || booking.customerId !== customerId) {
    throw new AppError('Booking không tồn tại hoặc bạn không có quyền', 404, 'BOOKING_NOT_FOUND');
  }

  if (booking.status !== BookingStatus.COMPLETED) {
    throw new AppError('Booking chưa hoàn thành', 400, 'BOOKING_NOT_COMPLETED');
  }

  if (!booking.completedAt) {
    throw new AppError('Booking chưa hoàn thành', 400, 'BOOKING_NOT_COMPLETED');
  }

  const deadline = new Date(booking.completedAt);
  deadline.setDate(deadline.getDate() + REVIEW_WINDOW_DAYS);
  if (new Date() > deadline) {
    throw new AppError('Thời hạn đánh giá đã hết (5 ngày)', 400, 'REVIEW_PERIOD_EXPIRED');
  }

  const existing = await reviewRepo.findOne({ where: { bookingId: body.booking_id } });
  if (existing) {
    throw new AppError('Booking này đã được đánh giá', 409, 'ALREADY_REVIEWED');
  }

  const vehicleScore = booking.playMode === BookingMode.BYOC ? null : (body.vehicle_score ?? null);

  const review = reviewRepo.create({
    bookingId: body.booking_id,
    cafeId: booking.cafeId,
    customerId,
    overallScore: body.overall_score,
    vehicleScore,
    staffScore: body.staff_score ?? null,
    facilityScore: body.facility_score ?? null,
    note: body.note ?? null,
    status: ReviewStatus.VISIBLE,
  });

  return reviewRepo.save(review);
}

// ── US1: Dismiss review reminder ──────────────────────────────────────────────

export async function dismissReview(customerId: string, bookingId: string): Promise<void> {
  const bookingRepo = AppDataSource.getRepository(Booking);

  const booking = await bookingRepo.findOne({ where: { id: bookingId } });
  if (!booking || booking.customerId !== customerId) {
    throw new AppError('Booking không tồn tại hoặc bạn không có quyền', 404, 'BOOKING_NOT_FOUND');
  }

  booking.reviewDismissedAt = new Date();
  await bookingRepo.save(booking);
}

// ── US1: Get pending reviews ──────────────────────────────────────────────────

export interface PendingReviewItem {
  bookingId: string;
  cafeId: string;
  cafeName: string;
  slotStart: Date;
  slotEnd: Date;
  playMode: string;
  completedAt: Date;
}

export async function getPendingReviews(customerId: string): Promise<PendingReviewItem[]> {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() - REVIEW_WINDOW_DAYS);

  const rows = await AppDataSource.query<PendingReviewItem[]>(
    `SELECT
       b.id AS "bookingId",
       b.cafe_id AS "cafeId",
       c.name AS "cafeName",
       b.slot_start AS "slotStart",
       b.slot_end AS "slotEnd",
       b.play_mode AS "playMode",
       b.completed_at AS "completedAt"
     FROM bookings b
     JOIN cafes c ON c.id = b.cafe_id
     WHERE b.customer_id = $1
       AND b.status = 'COMPLETED'
       AND b.completed_at IS NOT NULL
       AND b.completed_at > $2
       AND b.review_dismissed_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM reviews r WHERE r.booking_id = b.id
       )
     ORDER BY b.completed_at DESC`,
    [customerId, deadline],
  );

  return rows;
}

// ── US1: List customer's own reviews ─────────────────────────────────────────

export async function listCustomerReviews(
  customerId: string,
  page: number,
  limit: number,
): Promise<{ data: (Review & { cafeName: string })[]; total: number }> {
  const offset = (page - 1) * limit;
  const [rows, [{ count }]] = await Promise.all([
    AppDataSource.query<(Review & { cafeName: string })[]>(
      `SELECT
         r.id,
         r.booking_id       AS "bookingId",
         r.cafe_id          AS "cafeId",
         r.customer_id      AS "customerId",
         r.rating           AS "overallScore",
         r.vehicle_score    AS "vehicleScore",
         r.staff_score      AS "staffScore",
         r.facility_score   AS "facilityScore",
         r.note,
         r.status,
         r.created_at       AS "createdAt",
         c.name             AS "cafeName"
       FROM reviews r
       JOIN cafes c ON c.id = r.cafe_id
       WHERE r.customer_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset],
    ),
    AppDataSource.query<[{ count: string }]>(
      `SELECT COUNT(*) FROM reviews WHERE customer_id = $1`,
      [customerId],
    ),
  ]);
  return { data: rows, total: parseInt(count, 10) };
}

// ── US3: Mask customer name ───────────────────────────────────────────────────

export function maskName(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/);
  if (tokens.length <= 1) return fullName;
  const ho = tokens[0];
  const rest = tokens.slice(1);
  return `${rest.join(' ')} ${ho[0]}.`;
}

// ── US3: Public cafe review aggregate ────────────────────────────────────────

export interface CafeAggregate {
  cafeId: string;
  reviewCount: number;
  overallAvg: number | null;
  vehicleAvg: number | null;
  staffAvg: number | null;
  facilityAvg: number | null;
}

export async function getCafeAggregate(cafeId: string): Promise<CafeAggregate> {
  const [row] = await AppDataSource.query<CafeAggregate[]>(
    `SELECT
       $1::uuid AS "cafeId",
       COUNT(*)::int AS "reviewCount",
       ROUND(AVG(rating)::numeric, 1) AS "overallAvg",
       ROUND(AVG(vehicle_score)::numeric, 1) AS "vehicleAvg",
       ROUND(AVG(staff_score)::numeric, 1) AS "staffAvg",
       ROUND(AVG(facility_score)::numeric, 1) AS "facilityAvg"
     FROM reviews
     WHERE cafe_id = $1 AND status = 'VISIBLE'`,
    [cafeId],
  );

  if (!row || row.reviewCount === 0) {
    return {
      cafeId,
      reviewCount: 0,
      overallAvg: null,
      vehicleAvg: null,
      staffAvg: null,
      facilityAvg: null,
    };
  }
  return row;
}

// ── US3: Public cafe review list ─────────────────────────────────────────────

export interface PublicReview {
  id: string;
  customerName: string;
  overallScore: number;
  vehicleScore: number | null;
  staffScore: number | null;
  facilityScore: number | null;
  note: string | null;
  createdAt: Date;
}

export async function getCafeReviews(
  cafeId: string,
  page: number,
  limit: number,
): Promise<{ data: PublicReview[]; total: number }> {
  const offset = (page - 1) * limit;

  const [rows, [{ count }]] = await Promise.all([
    AppDataSource.query<(PublicReview & { full_name: string })[]>(
      `SELECT
         r.id,
         u.full_name,
         r.rating AS "overallScore",
         r.vehicle_score AS "vehicleScore",
         r.staff_score AS "staffScore",
         r.facility_score AS "facilityScore",
         r.note,
         r.created_at AS "createdAt"
       FROM reviews r
       JOIN users u ON u.id = r.customer_id
       WHERE r.cafe_id = $1 AND r.status = 'VISIBLE'
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [cafeId, limit, offset],
    ),
    AppDataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM reviews WHERE cafe_id = $1 AND status = 'VISIBLE'`,
      [cafeId],
    ),
  ]);

  const data = rows.map((r) => ({ ...r, customerName: maskName(r.full_name) }));
  return { data, total: parseInt(count, 10) };
}

// ── US4: Provider review list ─────────────────────────────────────────────────

export interface ProviderReviewItem extends Review {
  customerName: string;
  newSince24h?: boolean;
}

export async function getProviderReviews(
  providerId: string,
  options: {
    cafeId?: string;
    status?: ReviewStatus;
    page: number;
    limit: number;
  },
): Promise<{ data: ProviderReviewItem[]; total: number; newSince24h: number }> {
  const { cafeId, status, page, limit } = options;
  const offset = (page - 1) * limit;

  const cafeFilter = cafeId
    ? `AND r.cafe_id = '${cafeId}'::uuid`
    : `AND r.cafe_id IN (SELECT id FROM cafes WHERE provider_id = '${providerId}'::uuid)`;

  const statusFilter = status ? `AND r.status = '${status}'` : '';

  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [rows, [{ count }], [{ newCount }]] = await Promise.all([
    AppDataSource.query<(Review & { full_name: string })[]>(
      `SELECT r.*, u.full_name
       FROM reviews r
       JOIN users u ON u.id = r.customer_id
       WHERE 1=1 ${cafeFilter} ${statusFilter}
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    AppDataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM reviews r WHERE 1=1 ${cafeFilter} ${statusFilter}`,
      [],
    ),
    AppDataSource.query<{ newCount: string }[]>(
      `SELECT COUNT(*)::text AS "newCount" FROM reviews r
       WHERE 1=1 ${cafeFilter} AND r.created_at > $1`,
      [threshold],
    ),
  ]);

  const data: ProviderReviewItem[] = rows.map((r) => ({
    ...r,
    customerName: maskName(r.full_name),
  }));

  return { data, total: parseInt(count, 10), newSince24h: parseInt(newCount, 10) };
}

// ── US4: Set review visibility ────────────────────────────────────────────────

export async function setVisibility(
  reviewId: string,
  providerId: string,
  status: ReviewStatus,
): Promise<Review> {
  const reviewRepo = AppDataSource.getRepository(Review);

  const review = await reviewRepo
    .createQueryBuilder('r')
    .innerJoin('cafes', 'c', 'c.id = r.cafe_id')
    .where('r.id = :reviewId', { reviewId })
    .andWhere('c.provider_id = :providerId', { providerId })
    .getOne();

  if (!review) {
    throw new AppError(
      'Review không tồn tại hoặc không thuộc quyền quản lý của bạn',
      404,
      'REVIEW_NOT_FOUND',
    );
  }

  review.status = status;
  return reviewRepo.save(review);
}

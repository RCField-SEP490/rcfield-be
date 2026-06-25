import { AppDataSource } from '../config/database';

export interface ProviderKpi {
  totalRevenue: number;
  totalBookings: number;
  completedBookings: number;
  cancellationRate: number;
  vehicleUtilizationRate: number;
  totalVehicles: number;
  inUseVehicles: number;
  availableVehicles: number;
  maintenanceVehicles: number;
  newCustomers: number;
}

export interface RevenueTrendItem {
  label: string;
  slotFee: number;
  rentalFee: number;
  fnbPreorder: number;
  securityDeposit: number;
  total: number;
}

export interface RevenueBreakdownItem {
  type: string;
  label: string;
  amount: number;
}

export interface BranchPerformanceItem {
  cafeId: string;
  cafeName: string;
  totalRevenue: number;
  bookingCount: number;
}

export interface RecentBookingItem {
  bookingId: string;
  cafeName: string;
  customerName: string;
  playMode: string;
  slotStart: string;
  status: string;
  totalCharged: number;
}

export async function getProviderKpi(
  providerId: string,
  from?: string,
  to?: string,
  cafeId?: string,
): Promise<ProviderKpi> {
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  // 1. Doanh thu và booking hoàn tất
  const revenueRes = await AppDataSource.query<
    [{ totalRevenue: string; completedBookings: string }]
  >(
    `SELECT
      COALESCE(SUM(pc.amount), 0)::float AS "totalRevenue",
      COUNT(DISTINCT CASE WHEN b.status = 'COMPLETED' THEN b.id END)::int AS "completedBookings"
    FROM bookings b
    JOIN payment_components pc ON pc.booking_id = b.id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $1
      AND pc.status IN ('HELD', 'DISBURSED')
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
      AND ($4::uuid IS NULL OR b.cafe_id = $4)`,
    [providerId, fromDate, toDate, cafeId || null],
  );

  // 2. Tổng booking và cancellation rate
  const bookingsRes = await AppDataSource.query<
    [{ totalBookings: string; cancellationRate: string }]
  >(
    `SELECT
      COUNT(b.id)::int AS "totalBookings",
      COALESCE(
        COUNT(CASE WHEN b.status = 'CANCELLED' THEN 1 END)::float / NULLIF(COUNT(b.id), 0),
        0
      )::float AS "cancellationRate"
    FROM bookings b
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $1
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
      AND ($4::uuid IS NULL OR b.cafe_id = $4)`,
    [providerId, fromDate, toDate, cafeId || null],
  );

  // 3. Fleet status
  const fleetRes = await AppDataSource.query<
    [
      {
        totalVehicles: string;
        inUseVehicles: string;
        availableVehicles: string;
        maintenanceVehicles: string;
      },
    ]
  >(
    `SELECT
      COUNT(v.id)::int AS "totalVehicles",
      COUNT(CASE WHEN v.status = 'IN_USE' THEN 1 END)::int AS "inUseVehicles",
      COUNT(CASE WHEN v.status = 'AVAILABLE' THEN 1 END)::int AS "availableVehicles",
      COUNT(CASE WHEN v.status = 'MAINTENANCE' THEN 1 END)::int AS "maintenanceVehicles"
    FROM vehicles v
    JOIN cafes c ON c.id = v.cafe_id
    WHERE c.provider_id = $1
      AND ($2::uuid IS NULL OR v.cafe_id = $2)
      AND v.deleted_at IS NULL`,
    [providerId, cafeId || null],
  );

  // 4. Khách hàng mới (lần đầu đặt lịch trong khoảng thời gian này trên toàn bộ chi nhánh của provider)
  const customersRes = await AppDataSource.query<[{ newCustomers: string }]>(
    `SELECT COUNT(DISTINCT cb.customer_id)::int AS "newCustomers"
     FROM (
       SELECT b.customer_id, MIN(b.slot_start) as first_booking
       FROM bookings b
       JOIN cafes c ON c.id = b.cafe_id
       WHERE c.provider_id = $1
         AND ($2::uuid IS NULL OR b.cafe_id = $2)
       GROUP BY b.customer_id
     ) cb
     WHERE cb.first_booking >= $3::timestamptz AND cb.first_booking <= $4::timestamptz`,
    [providerId, cafeId || null, fromDate, toDate],
  );

  const totalRevenue = Number(revenueRes[0]?.totalRevenue ?? 0);
  const completedBookings = Number(revenueRes[0]?.completedBookings ?? 0);
  const totalBookings = Number(bookingsRes[0]?.totalBookings ?? 0);
  const cancellationRate = Number(bookingsRes[0]?.cancellationRate ?? 0);

  const totalVehicles = Number(fleetRes[0]?.totalVehicles ?? 0);
  const inUseVehicles = Number(fleetRes[0]?.inUseVehicles ?? 0);
  const availableVehicles = Number(fleetRes[0]?.availableVehicles ?? 0);
  const maintenanceVehicles = Number(fleetRes[0]?.maintenanceVehicles ?? 0);

  const vehicleUtilizationRate = totalVehicles > 0 ? inUseVehicles / totalVehicles : 0;
  const newCustomers = Number(customersRes[0]?.newCustomers ?? 0);

  return {
    totalRevenue,
    totalBookings,
    completedBookings,
    cancellationRate,
    vehicleUtilizationRate,
    totalVehicles,
    inUseVehicles,
    availableVehicles,
    maintenanceVehicles,
    newCustomers,
  };
}

export async function getProviderRevenueTrend(
  providerId: string,
  period: 'daily' | 'weekly' | 'monthly',
  from?: string,
  to?: string,
  cafeId?: string,
): Promise<RevenueTrendItem[]> {
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  let groupFormat = 'DD/MM';
  let truncUnit = 'day';

  if (period === 'weekly') {
    groupFormat = 'IW/IYYY';
    truncUnit = 'week';
  } else if (period === 'monthly') {
    groupFormat = 'MM/YYYY';
    truncUnit = 'month';
  }

  const query = `
    SELECT
      TO_CHAR(b.slot_start, $1) AS "label",
      COALESCE(SUM(CASE WHEN pc.type = 'SLOT_FEE' THEN pc.amount END), 0)::float AS "slotFee",
      COALESCE(SUM(CASE WHEN pc.type = 'RENTAL_FEE' THEN pc.amount END), 0)::float AS "rentalFee",
      COALESCE(SUM(CASE WHEN pc.type = 'FNB_PREORDER' THEN pc.amount END), 0)::float AS "fnbPreorder",
      COALESCE(SUM(CASE WHEN pc.type = 'SECURITY_DEPOSIT' THEN pc.amount END), 0)::float AS "securityDeposit",
      COALESCE(SUM(pc.amount), 0)::float AS "total",
      DATE_TRUNC($2, b.slot_start) as "trunc_date"
    FROM bookings b
    JOIN payment_components pc ON pc.booking_id = b.id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $3
      AND pc.status IN ('HELD', 'DISBURSED')
      AND b.slot_start >= $4::timestamptz
      AND b.slot_start <= $5::timestamptz
      AND ($6::uuid IS NULL OR b.cafe_id = $6)
    GROUP BY TO_CHAR(b.slot_start, $1), DATE_TRUNC($2, b.slot_start)
    ORDER BY "trunc_date" ASC
  `;

  const rows = await AppDataSource.query<
    {
      label: string;
      slotFee: number;
      rentalFee: number;
      fnbPreorder: number;
      securityDeposit: number;
      total: number;
    }[]
  >(query, [groupFormat, truncUnit, providerId, fromDate, toDate, cafeId || null]);

  return rows.map((row) => ({
    label: row.label,
    slotFee: Number(row.slotFee),
    rentalFee: Number(row.rentalFee),
    fnbPreorder: Number(row.fnbPreorder),
    securityDeposit: Number(row.securityDeposit),
    total: Number(row.total),
  }));
}

export async function getProviderRevenueBreakdown(
  providerId: string,
  from?: string,
  to?: string,
  cafeId?: string,
): Promise<RevenueBreakdownItem[]> {
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  const query = `
    SELECT
      pc.type,
      CASE
        WHEN pc.type = 'SLOT_FEE' THEN 'Phí sân'
        WHEN pc.type = 'RENTAL_FEE' THEN 'Thuê xe'
        WHEN pc.type = 'SECURITY_DEPOSIT' THEN 'Đặt cọc'
        WHEN pc.type = 'FNB_PREORDER' THEN 'F&B'
        ELSE pc.type::text
      END AS "label",
      COALESCE(SUM(pc.amount), 0)::float AS "amount"
    FROM bookings b
    JOIN payment_components pc ON pc.booking_id = b.id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $1
      AND pc.status IN ('HELD', 'DISBURSED')
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
      AND ($4::uuid IS NULL OR b.cafe_id = $4)
    GROUP BY pc.type
  `;

  const rows = await AppDataSource.query<
    {
      type: string;
      label: string;
      amount: number;
    }[]
  >(query, [providerId, fromDate, toDate, cafeId || null]);

  return rows.map((row) => ({
    type: row.type,
    label: row.label,
    amount: Number(row.amount),
  }));
}

export async function getProviderBranchPerformance(
  providerId: string,
  from?: string,
  to?: string,
): Promise<BranchPerformanceItem[]> {
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  const query = `
    SELECT
      c.id AS "cafeId",
      c.name AS "cafeName",
      COALESCE(SUM(pc.amount), 0)::float AS "totalRevenue",
      COUNT(DISTINCT b.id)::int AS "bookingCount"
    FROM cafes c
    LEFT JOIN bookings b ON b.cafe_id = c.id
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
    LEFT JOIN payment_components pc ON pc.booking_id = b.id
      AND pc.status IN ('HELD', 'DISBURSED')
    WHERE c.provider_id = $1
      AND c.deleted_at IS NULL
    GROUP BY c.id, c.name
    ORDER BY "totalRevenue" DESC
  `;

  const rows = await AppDataSource.query<
    {
      cafeId: string;
      cafeName: string;
      totalRevenue: number;
      bookingCount: number;
    }[]
  >(query, [providerId, fromDate, toDate]);

  return rows.map((row) => ({
    cafeId: row.cafeId,
    cafeName: row.cafeName,
    totalRevenue: Number(row.totalRevenue),
    bookingCount: Number(row.bookingCount),
  }));
}

export async function getProviderRecentBookings(
  providerId: string,
  limit: number = 8,
): Promise<RecentBookingItem[]> {
  const query = `
    SELECT
      b.id AS "bookingId",
      c.name AS "cafeName",
      u.full_name AS "customerName",
      b.play_mode AS "playMode",
      b.slot_start AS "slotStart",
      b.status AS "status",
      COALESCE((
        SELECT SUM(pc.amount)
        FROM payment_components pc
        WHERE pc.booking_id = b.id
          AND pc.status IN ('HELD', 'DISBURSED')
      ), 0)::float AS "totalCharged"
    FROM bookings b
    JOIN cafes c ON c.id = b.cafe_id
    JOIN users u ON u.id = b.customer_id
    WHERE c.provider_id = $1
    ORDER BY b.created_at DESC
    LIMIT $2
  `;

  const rows = await AppDataSource.query<
    {
      bookingId: string;
      cafeName: string;
      customerName: string;
      playMode: string;
      slotStart: Date;
      status: string;
      totalCharged: number;
    }[]
  >(query, [providerId, limit]);

  return rows.map((row) => ({
    bookingId: row.bookingId,
    cafeName: row.cafeName,
    customerName: row.customerName,
    playMode: row.playMode,
    slotStart: row.slotStart.toISOString(),
    status: row.status,
    totalCharged: Number(row.totalCharged),
  }));
}

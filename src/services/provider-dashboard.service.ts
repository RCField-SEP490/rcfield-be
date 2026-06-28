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
  extensionFee: number;
  damageCharge: number;
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
      AND pc.type != 'SECURITY_DEPOSIT'
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
      COALESCE(SUM(CASE WHEN pc.type = 'EXTENSION_FEE' THEN pc.amount END), 0)::float AS "extensionFee",
      COALESCE(SUM(CASE WHEN pc.type = 'DAMAGE_CHARGE' THEN pc.amount END), 0)::float AS "damageCharge",
      COALESCE(SUM(pc.amount), 0)::float AS "total",
      DATE_TRUNC($2, b.slot_start) as "trunc_date"
    FROM bookings b
    JOIN payment_components pc ON pc.booking_id = b.id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $3
      AND pc.status IN ('HELD', 'DISBURSED')
      AND pc.type != 'SECURITY_DEPOSIT'
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
      extensionFee: number;
      damageCharge: number;
      total: number;
    }[]
  >(query, [groupFormat, truncUnit, providerId, fromDate, toDate, cafeId || null]);

  return rows.map((row) => ({
    label: row.label,
    slotFee: Number(row.slotFee),
    rentalFee: Number(row.rentalFee),
    fnbPreorder: Number(row.fnbPreorder),
    extensionFee: Number(row.extensionFee),
    damageCharge: Number(row.damageCharge),
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
        WHEN pc.type = 'FNB_PREORDER' THEN 'F&B'
        WHEN pc.type = 'EXTENSION_FEE' THEN 'Phí gia hạn'
        WHEN pc.type = 'DAMAGE_CHARGE' THEN 'Phí bồi thường'
        ELSE pc.type::text
      END AS "label",
      COALESCE(SUM(pc.amount), 0)::float AS "amount"
    FROM bookings b
    JOIN payment_components pc ON pc.booking_id = b.id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $1
      AND pc.status IN ('HELD', 'DISBURSED')
      AND pc.type != 'SECURITY_DEPOSIT'
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

export interface TopFnbItem {
  menuItemId: string;
  itemName: string;
  cafeName: string;
  totalQuantity: number;
  totalRevenue: number;
}

export interface TopTrackItem {
  trackTypeId: string;
  trackTypeName: string;
  trackTypeCode: string;
  cafeName: string;
  bookingCount: number;
}

export interface TopCustomerItem {
  customerId: string;
  customerName: string;
  customerEmail: string;
  bookingCount: number;
  totalSpent: number;
}

export interface TopVehicleItem {
  catalogId: string;
  catalogName: string;
  catalogTier: string;
  cafeName: string;
  bookingCount: number;
  rentalRevenue: number;
}

export interface ProviderTopStats {
  topFnb: TopFnbItem[];
  topTracks: TopTrackItem[];
  topCustomers: TopCustomerItem[];
  topVehicles: TopVehicleItem[];
}

export async function getProviderTopStats(
  providerId: string,
  from?: string,
  to?: string,
  cafeId?: string,
): Promise<ProviderTopStats> {
  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  // 1. Top 5 món F&B được mua nhiều nhất
  const fnbQuery = `
    SELECT 
      foi.menu_item_id AS "menuItemId",
      COALESCE(foi.item_name_snapshot, mi.name, 'Món đã xóa') AS "itemName",
      c.name AS "cafeName",
      SUM(foi.quantity)::int AS "totalQuantity",
      SUM(COALESCE(foi.subtotal, foi.quantity * foi.unit_price))::float AS "totalRevenue"
    FROM fnb_order_items foi
    JOIN fnb_orders fo ON fo.id = foi.fnb_order_id
    LEFT JOIN menu_items mi ON mi.id = foi.menu_item_id
    JOIN bookings b ON b.id = fo.booking_id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $1
      AND fo.status != 'CANCELLED'
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
      AND ($4::uuid IS NULL OR b.cafe_id = $4)
    GROUP BY foi.menu_item_id, foi.item_name_snapshot, mi.name, c.name
    ORDER BY "totalQuantity" DESC
    LIMIT 5
  `;

  // 2. Top 5 loại sân được book nhiều nhất
  const tracksQuery = `
    SELECT 
      b.track_type_id AS "trackTypeId",
      tt.name AS "trackTypeName",
      tt.code AS "trackTypeCode",
      c.name AS "cafeName",
      COUNT(b.id)::int AS "bookingCount"
    FROM bookings b
    JOIN track_types tt ON tt.id = b.track_type_id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $1
      AND b.status != 'CANCELLED'
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
      AND ($4::uuid IS NULL OR b.cafe_id = $4)
    GROUP BY b.track_type_id, tt.name, tt.code, c.name
    ORDER BY "bookingCount" DESC
    LIMIT 5
  `;

  // 3. Top 5 khách hàng đặt sân nhiều nhất
  const customersQuery = `
    SELECT 
      b.customer_id AS "customerId",
      u.full_name AS "customerName",
      u.email AS "customerEmail",
      COUNT(b.id)::int AS "bookingCount",
      COALESCE(SUM(pc.amount), 0)::float AS "totalSpent"
    FROM bookings b
    JOIN users u ON u.id = b.customer_id
    JOIN cafes c ON c.id = b.cafe_id
    LEFT JOIN payment_components pc ON pc.booking_id = b.id AND pc.status IN ('HELD', 'DISBURSED')
    WHERE c.provider_id = $1
      AND b.status != 'CANCELLED'
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
      AND ($4::uuid IS NULL OR b.cafe_id = $4)
    GROUP BY b.customer_id, u.full_name, u.email
    ORDER BY "bookingCount" DESC
    LIMIT 5
  `;

  // 4. Top 5 loại xe được book nhiều nhất
  const vehiclesQuery = `
    SELECT 
      vc.id AS "catalogId",
      vc.name AS "catalogName",
      vc.tier AS "catalogTier",
      c.name AS "cafeName",
      COUNT(bv.id)::int AS "bookingCount",
      COALESCE(SUM(bv.rental_fee_snapshot), 0)::float AS "rentalRevenue"
    FROM booking_vehicles bv
    JOIN vehicles v ON v.id = bv.vehicle_id
    JOIN vehicle_catalogs vc ON vc.id = v.catalog_id
    JOIN bookings b ON b.id = bv.booking_id
    JOIN cafes c ON c.id = b.cafe_id
    WHERE c.provider_id = $1
      AND b.status != 'CANCELLED'
      AND b.slot_start >= $2::timestamptz
      AND b.slot_start <= $3::timestamptz
      AND ($4::uuid IS NULL OR b.cafe_id = $4)
    GROUP BY vc.id, vc.name, vc.tier, c.name
    ORDER BY "bookingCount" DESC
    LIMIT 5
  `;

  const [topFnb, topTracks, topCustomers, topVehicles] = await Promise.all([
    AppDataSource.query<TopFnbItem[]>(fnbQuery, [providerId, fromDate, toDate, cafeId || null]),
    AppDataSource.query<TopTrackItem[]>(tracksQuery, [
      providerId,
      fromDate,
      toDate,
      cafeId || null,
    ]),
    AppDataSource.query<TopCustomerItem[]>(customersQuery, [
      providerId,
      fromDate,
      toDate,
      cafeId || null,
    ]),
    AppDataSource.query<TopVehicleItem[]>(vehiclesQuery, [
      providerId,
      fromDate,
      toDate,
      cafeId || null,
    ]),
  ]);

  return {
    topFnb: topFnb.map((item) => ({
      menuItemId: item.menuItemId,
      itemName: item.itemName,
      cafeName: item.cafeName,
      totalQuantity: Number(item.totalQuantity),
      totalRevenue: Number(item.totalRevenue),
    })),
    topTracks: topTracks.map((item) => ({
      trackTypeId: item.trackTypeId,
      trackTypeName: item.trackTypeName,
      trackTypeCode: item.trackTypeCode,
      cafeName: item.cafeName,
      bookingCount: Number(item.bookingCount),
    })),
    topCustomers: topCustomers.map((item) => ({
      customerId: item.customerId,
      customerName: item.customerName,
      customerEmail: item.customerEmail,
      bookingCount: Number(item.bookingCount),
      totalSpent: Number(item.totalSpent),
    })),
    topVehicles: topVehicles.map((item) => ({
      catalogId: item.catalogId,
      catalogName: item.catalogName,
      catalogTier: item.catalogTier,
      cafeName: item.cafeName,
      bookingCount: Number(item.bookingCount),
      rentalRevenue: Number(item.rentalRevenue),
    })),
  };
}

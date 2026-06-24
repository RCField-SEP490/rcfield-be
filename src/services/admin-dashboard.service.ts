import { AppDataSource } from '../config/database';
import { BookingStatus, PaymentRequestStatus, SubscriptionStatus, SessionStatus } from '../types';

export interface AdminKpi {
  totalCafes: {
    value: string;
    helper: string;
  };
  totalUsers: {
    value: string;
    helper: string;
  };
  monthlyRevenue: {
    value: string;
    helper: string;
  };
  activeSessions: {
    value: string;
    helper: string;
  };
}

export interface CafeGrowthItem {
  name: string;
  value: number;
}

export interface SaaSRevenueItem {
  name: string;
  count: number;
  revenue: number;
}

export interface ActiveSessionsTrendItem {
  name: string;
  value: number;
}

export interface RecentCafeItem {
  id: string;
  name: string;
  providerName: string;
  email: string;
  saasPlan: string;
  status: string;
  createdDate: string;
}

export interface AdminDashboardSummary {
  kpi: AdminKpi;
  cafeGrowth: CafeGrowthItem[];
  revenueByPlan: SaaSRevenueItem[];
  activeSessionsTrend: ActiveSessionsTrendItem[];
  recentCafes: RecentCafeItem[];
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  // 1. KPI - Tổng số đối tác (Cafes)
  const cafesKpi = await AppDataSource.query<[{ total: string; active: string }]>(
    `SELECT 
      COUNT(id)::int AS "total",
      COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::int AS "active"
     FROM cafes`,
  );
  const totalCafes = {
    value: String(cafesKpi[0]?.total ?? 0),
    helper: `${cafesKpi[0]?.active ?? 0} đang hoạt động`,
  };

  // 2. KPI - Tổng người dùng (Users)
  const usersKpi = await AppDataSource.query<[{ total: string; newThisWeek: string }]>(
    `SELECT 
      COUNT(id)::int AS "total",
      COUNT(CASE WHEN created_at >= (NOW() - INTERVAL '7 days') THEN 1 END)::int AS "newThisWeek"
     FROM users`,
  );
  const totalUsers = {
    value: Number(usersKpi[0]?.total ?? 0).toLocaleString('vi-VN'),
    helper: `+${usersKpi[0]?.newThisWeek ?? 0} đăng ký mới tuần này`,
  };

  // 3. KPI - Doanh thu nền tảng tháng này
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const previousMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
    999,
  ).toISOString();

  const currentRevenueRes = await AppDataSource.query<[{ total: string }]>(
    `SELECT COALESCE(SUM(transfer_amount), 0)::float AS "total"
     FROM payment_requests
     WHERE status = $1
       AND created_at >= $2::timestamptz`,
    [PaymentRequestStatus.CONFIRMED, currentMonthStart],
  );

  const prevRevenueRes = await AppDataSource.query<[{ total: string }]>(
    `SELECT COALESCE(SUM(transfer_amount), 0)::float AS "total"
     FROM payment_requests
     WHERE status = $1
       AND created_at >= $2::timestamptz
       AND created_at <= $3::timestamptz`,
    [PaymentRequestStatus.CONFIRMED, previousMonthStart, previousMonthEnd],
  );

  const currentRevenue = currentRevenueRes[0]?.total ? Number(currentRevenueRes[0].total) : 0;
  const prevRevenue = prevRevenueRes[0]?.total ? Number(prevRevenueRes[0].total) : 0;
  let revenueHelper = '0% so với tháng trước';
  if (prevRevenue > 0) {
    const diffPct = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
    revenueHelper = `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}% so với tháng trước`;
  } else if (currentRevenue > 0) {
    revenueHelper = '+100% so với tháng trước';
  }

  const monthlyRevenue = {
    value: `${currentRevenue.toLocaleString('vi-VN')} ₫`,
    helper: revenueHelper,
  };

  // 4. KPI - Phiên chơi đang hoạt động
  const activeSessionsKpi = await AppDataSource.query<[{ total: string; cafeCount: string }]>(
    `SELECT 
      COUNT(id)::int AS "total",
      COUNT(DISTINCT cafe_id)::int AS "cafeCount"
     FROM sessions
     WHERE status IN ($1, $2, $3)`,
    [SessionStatus.ACTIVE, SessionStatus.EXTENDING, SessionStatus.CHECKING_OUT],
  );
  const activeSessions = {
    value: String(activeSessionsKpi[0]?.total ?? 0),
    helper: `Từ ${activeSessionsKpi[0]?.cafeCount ?? 0} chi nhánh`,
  };

  // 5. Chart 1: Sự tăng trưởng của Đối tác (6 tháng gần nhất)
  const cafeGrowth = await AppDataSource.query<CafeGrowthItem[]>(
    `SELECT 
      'Thg ' || TO_CHAR(created_at, 'MM') AS "name",
      COUNT(id)::int AS "value"
     FROM cafes
     WHERE created_at >= (NOW() - INTERVAL '6 months')
     GROUP BY TO_CHAR(created_at, 'MM')
     ORDER BY TO_CHAR(created_at, 'MM') ASC`,
  );

  // 6. Chart 2: Doanh thu theo gói SaaS
  const revenueByPlanRows = await AppDataSource.query<SaaSRevenueItem[]>(
    `SELECT 
      sp.name::text AS "name",
      COUNT(DISTINCT ps.provider_id)::int AS "count",
      COALESCE(SUM(pr.transfer_amount), 0)::float AS "revenue"
     FROM subscription_plans sp
     LEFT JOIN provider_subscriptions ps ON ps.plan_id = sp.id AND ps.status = $1
     LEFT JOIN payment_requests pr ON pr.plan_id = sp.id AND pr.status = $2
     GROUP BY sp.id, sp.name`,
    [SubscriptionStatus.ACTIVE, PaymentRequestStatus.CONFIRMED],
  );

  // 7. Chart 3: Lượng truy cập sân chơi (7 ngày qua)
  const activeSessionsTrend = await AppDataSource.query<ActiveSessionsTrendItem[]>(
    `SELECT 
      CASE 
        WHEN EXTRACT(ISODOW FROM d.day) = 1 THEN 'T2'
        WHEN EXTRACT(ISODOW FROM d.day) = 2 THEN 'T3'
        WHEN EXTRACT(ISODOW FROM d.day) = 3 THEN 'T4'
        WHEN EXTRACT(ISODOW FROM d.day) = 4 THEN 'T5'
        WHEN EXTRACT(ISODOW FROM d.day) = 5 THEN 'T6'
        WHEN EXTRACT(ISODOW FROM d.day) = 6 THEN 'T7'
        WHEN EXTRACT(ISODOW FROM d.day) = 7 THEN 'CN'
      END AS "name",
      COUNT(b.id)::int AS "value"
     FROM (
       SELECT generate_series(NOW() - INTERVAL '6 days', NOW(), '1 day')::date AS day
     ) d
     LEFT JOIN bookings b ON b.slot_start::date = d.day AND b.status NOT IN ($1, $2)
     GROUP BY d.day
     ORDER BY d.day ASC`,
    [BookingStatus.PENDING, BookingStatus.CANCELLED],
  );

  // 8. Table: Đối tác đăng ký gần đây
  const recentCafesRows = await AppDataSource.query<RecentCafeItem[]>(
    `SELECT 
      c.id AS "id",
      c.name AS "name",
      u.full_name AS "providerName",
      u.email AS "email",
      COALESCE(sp.name::text, 'Free') AS "saasPlan",
      c.status::text AS "status",
      TO_CHAR(c.created_at, 'YYYY-MM-DD') AS "createdDate"
     FROM cafes c
     JOIN users u ON u.id = c.provider_id
     LEFT JOIN provider_subscriptions ps ON ps.provider_id = u.id AND ps.status = $1
     LEFT JOIN subscription_plans sp ON sp.id = ps.plan_id
     WHERE c.deleted_at IS NULL
     ORDER BY c.created_at DESC
     LIMIT 5`,
    [SubscriptionStatus.ACTIVE],
  );

  return {
    kpi: {
      totalCafes,
      totalUsers,
      monthlyRevenue,
      activeSessions,
    },
    cafeGrowth,
    revenueByPlan: revenueByPlanRows,
    activeSessionsTrend,
    recentCafes: recentCafesRows,
  };
}

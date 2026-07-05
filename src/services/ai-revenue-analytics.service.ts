import { GoogleGenAI } from '@google/genai';
import { AppDataSource } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../types';
import * as dashboardService from './provider-dashboard.service';

const ai = new GoogleGenAI({ apiKey: env.ai.googleApiKey });

interface GateResult {
  monthlyQuota: number;
}

// Verify GLOBAL feature flag is enabled. Admin providers bypass the gate.
export async function checkAnalyticsGate(providerId: string): Promise<GateResult> {
  const userRows = await AppDataSource.query<{ role: string }[]>(
    `SELECT role FROM users WHERE id = $1`,
    [providerId],
  );
  if (userRows[0]?.role === 'ADMIN') {
    logger.info('AiAnalytics', 'admin provider — gate bypassed', { providerId });
    return { monthlyQuota: 0 };
  }

  const flagRows = await AppDataSource.query<
    { is_enabled: boolean; config: { monthly_quota?: number } }[]
  >(
    `SELECT is_enabled, config FROM feature_flags
     WHERE feature_key = 'AI_REVENUE_ANALYTICS' AND entity_type = 'GLOBAL'`,
  );

  if (!flagRows.length || !flagRows[0].is_enabled) {
    throw new AppError(
      'Tính năng AI Phân Tích Doanh Thu chưa được kích hoạt.',
      503,
      'AI_ANALYTICS_DISABLED',
    );
  }

  return { monthlyQuota: flagRows[0].config?.monthly_quota ?? 10 };
}

// Count SUCCESS logs for current month; insert placeholder log; return logId.
export async function checkAndLogAnalyticsQuota(
  providerId: string,
  monthlyQuota: number,
  from: string,
  to: string,
  cafeId: string | null,
): Promise<string> {
  if (monthlyQuota !== 0) {
    const countRows = await AppDataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM ai_analysis_logs
       WHERE provider_id = $1
         AND status = 'SUCCESS'
         AND DATE_TRUNC('month', requested_at) = DATE_TRUNC('month', NOW())`,
      [providerId],
    );
    const used = parseInt(countRows[0]?.count ?? '0', 10);
    if (used >= monthlyQuota) {
      await AppDataSource.query(
        `INSERT INTO ai_analysis_logs (provider_id, cafe_id, period_from, period_to, status)
         VALUES ($1, $2, $3, $4, 'QUOTA_EXCEEDED')`,
        [providerId, cafeId, from, to],
      );
      logger.warn('AiAnalytics', 'quota exceeded', { providerId, used, monthlyQuota });
      throw new AppError(
        `Bạn đã sử dụng hết ${monthlyQuota} lượt phân tích trong tháng này.`,
        429,
        'AI_QUOTA_EXCEEDED',
      );
    }
  }

  const inserted = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO ai_analysis_logs (provider_id, cafe_id, period_from, period_to, status)
     VALUES ($1, $2, $3, $4, 'FAILED') RETURNING id`,
    [providerId, cafeId, from, to],
  );
  const rows: { id: string }[] = Array.isArray(inserted[0]) ? inserted[0] : inserted;
  return rows[0].id;
}

// Fetch all 6 revenue data sources in parallel.
export async function fetchRevenueData(
  providerId: string,
  from: string,
  to: string,
  cafeId?: string,
) {
  const [kpi, trend, breakdown, branchPerf, topStats] = await Promise.all([
    dashboardService.getProviderKpi(providerId, from, to, cafeId),
    dashboardService.getProviderRevenueTrend(providerId, 'weekly', from, to, cafeId),
    dashboardService.getProviderRevenueBreakdown(providerId, from, to, cafeId),
    dashboardService.getProviderBranchPerformance(providerId, from, to),
    dashboardService.getProviderTopStats(providerId, from, to, cafeId),
  ]);
  return { kpi, trend, breakdown, branchPerf, topStats };
}

type RevenueData = Awaited<ReturnType<typeof fetchRevenueData>>;

// Compute derived metrics: completion rate, revenue/booking, trend direction, top source.
export function computeDerivedMetrics(data: RevenueData) {
  const { kpi, trend, breakdown } = data;

  const completionRate =
    kpi.totalBookings > 0 ? (kpi.completedBookings / kpi.totalBookings) * 100 : 0;
  const revenuePerBooking =
    kpi.completedBookings > 0 ? kpi.totalRevenue / kpi.completedBookings : 0;

  // Linear slope over weekly trend values
  const trendValues = trend.map((t: { total: number }) => t.total);
  const n = trendValues.length;
  let slope = 0;
  if (n >= 2) {
    const meanX = (n - 1) / 2;
    const meanY = trendValues.reduce((a: number, b: number) => a + b, 0) / n;
    const num = trendValues.reduce(
      (acc: number, y: number, i: number) => acc + (i - meanX) * (y - meanY),
      0,
    );
    const den = trendValues.reduce(
      (acc: number, _: number, i: number) => acc + (i - meanX) ** 2,
      0,
    );
    slope = den !== 0 ? num / den : 0;
  }
  const trendDirection: 'rising' | 'flat' | 'falling' =
    slope > 0.05 ? 'rising' : slope < -0.05 ? 'falling' : 'flat';

  const topSource = [...breakdown].sort(
    (a: { amount: number }, b: { amount: number }) => b.amount - a.amount,
  )[0];

  return { completionRate, revenuePerBooking, trendDirection, slope, topSource };
}

type DerivedMetrics = ReturnType<typeof computeDerivedMetrics>;

function buildPrompt(data: RevenueData, metrics: DerivedMetrics, from: string, to: string): string {
  const topCustomers = data.topStats.topCustomers?.slice(0, 3) ?? [];
  const topVehicles = data.topStats.topVehicles?.slice(0, 3) ?? [];

  return `Bạn là chuyên gia phân tích kinh doanh RC Cafe (sân chơi xe điều khiển từ xa) tại Việt Nam.
Phân tích dữ liệu kinh doanh sau và trả về JSON theo cấu trúc yêu cầu. Chỉ dùng tiếng Việt.

== DỮ LIỆU KỲ ${from} → ${to} ==
KPI tổng: ${JSON.stringify(data.kpi)}
Xu hướng doanh thu (theo tuần): ${JSON.stringify(data.trend)}
Phân tích nguồn doanh thu: ${JSON.stringify(data.breakdown)}
Hiệu suất chi nhánh: ${JSON.stringify(data.branchPerf)}
Top khách hàng: ${JSON.stringify(topCustomers)}
Top xe được đặt nhiều: ${JSON.stringify(topVehicles)}

== CHỈ SỐ DẪN XUẤT ==
Tỉ lệ booking hoàn thành: ${metrics.completionRate.toFixed(1)}%
Doanh thu trung bình/booking: ${metrics.revenuePerBooking.toFixed(0)} VNĐ
Xu hướng doanh thu: ${metrics.trendDirection} (độ dốc=${metrics.slope.toFixed(2)})
Nguồn doanh thu lớn nhất: ${JSON.stringify(metrics.topSource)}
Tỉ lệ hủy booking: ${(data.kpi.cancellationRate * 100).toFixed(1)}%
Tỉ lệ sử dụng xe: ${(data.kpi.vehicleUtilizationRate * 100).toFixed(1)}%

== QUY TẮC NGHIỆP VỤ CẦN BIẾT ==
- Extension fee > 20% tổng counter-bill = tín hiệu khách muốn chơi lâu hơn → nên tăng slot mặc định
- Vehicle utilization < 40% = đội xe thừa → xem xét giảm quy mô hoặc điều chỉnh giá
- 1 khách chiếm > 30% doanh thu = rủi ro tập trung khách hàng
- 3+ tuần liên tiếp giảm doanh thu = xu hướng đáng lo ngại

== CẤU TRÚC ĐẦU RA (JSON hợp lệ, không markdown, không text thừa) ==
{
  "summary": "Đoạn văn 2-3 câu tổng quan sức khỏe doanh thu trong kỳ phân tích",
  "insights": [
    {
      "type": "trend|revenue_mix|fleet|retention|branch",
      "title": "Tiêu đề ngắn gọn",
      "body": "Mô tả chi tiết tín hiệu và lý do quan trọng trong bối cảnh RC Cafe",
      "severity": "positive|neutral|warning|critical"
    }
  ],
  "topOpportunity": "1 đề xuất hành động quan trọng nhất và cụ thể nhất cho kỳ tới",
  "watchouts": ["Cảnh báo 1", "Cảnh báo 2"]
}
Yêu cầu tối thiểu: 3 insights, 1 topOpportunity, 1-2 watchouts.`.trim();
}

export interface AiInsightData {
  period: { from: string; to: string };
  summary: string;
  insights: {
    type: string;
    title: string;
    body: string;
    severity: string;
  }[];
  topOpportunity: string;
  watchouts: string[];
  generatedAt: string;
}

export type AiInsightResult =
  | { type: 'SUCCESS'; data: AiInsightData }
  | { type: 'INSUFFICIENT_DATA'; data: null };

// Main entry point — orchestrates gate, quota, data fetch, Gemini call, and logging.
export async function generateAiInsights(
  providerId: string,
  from: string,
  to: string,
  cafeId?: string,
): Promise<AiInsightResult> {
  const startMs = Date.now();
  let logId: string | null = null;
  let status: 'SUCCESS' | 'FAILED' | 'INSUFFICIENT_DATA' = 'FAILED';
  let tokensUsed: number | null = null;

  try {
    const { monthlyQuota } = await checkAnalyticsGate(providerId);

    const data = await fetchRevenueData(providerId, from, to, cafeId);

    if (data.kpi.completedBookings === 0) {
      await AppDataSource.query(
        `INSERT INTO ai_analysis_logs (provider_id, cafe_id, period_from, period_to, status, duration_ms)
         VALUES ($1, $2, $3, $4, 'INSUFFICIENT_DATA', $5)`,
        [providerId, cafeId ?? null, from, to, Date.now() - startMs],
      );
      return { type: 'INSUFFICIENT_DATA', data: null };
    }

    logId = await checkAndLogAnalyticsQuota(providerId, monthlyQuota, from, to, cafeId ?? null);

    const metrics = computeDerivedMetrics(data);
    const prompt = buildPrompt(data, metrics, from, to);

    logger.info('AiAnalytics', 'calling Gemini', { providerId, model: env.ai.supportModel });

    const response = await ai.models.generateContent({
      model: env.ai.supportModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    tokensUsed = response.usageMetadata?.totalTokenCount ?? null;

    // Strip markdown code fences Gemini sometimes wraps around JSON output
    const text = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(text) as Omit<AiInsightData, 'period' | 'generatedAt'>;
    status = 'SUCCESS';

    logger.info('AiAnalytics', 'success', {
      providerId,
      tokensUsed,
      durationMs: Date.now() - startMs,
    });

    return {
      type: 'SUCCESS',
      data: {
        period: { from, to },
        summary: parsed.summary,
        insights: parsed.insights,
        topOpportunity: parsed.topOpportunity,
        watchouts: parsed.watchouts,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'AI_QUOTA_EXCEEDED' || code === 'AI_ANALYTICS_DISABLED') throw err;
    logger.error('AiAnalytics', 'Gemini call failed', err);
    throw new AppError('Phân tích AI thất bại. Vui lòng thử lại sau.', 503, 'AI_ANALYTICS_FAILED');
  } finally {
    if (logId) {
      await AppDataSource.query(
        `UPDATE ai_analysis_logs
         SET status = $1, tokens_used = $2, duration_ms = $3
         WHERE id = $4`,
        [status, tokensUsed, Date.now() - startMs, logId],
      ).catch((err: unknown) => {
        logger.warn('AiAnalytics', 'failed to update log row', err);
      });
    }
  }
}

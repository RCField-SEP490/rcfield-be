import 'dotenv/config';

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function getSafeFrontendUrl(): string {
  let url = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173';
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  return url;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  NODE_ENV: nodeEnv,
  PORT: parseInt(process.env.PORT ?? '3000', 10),

  /**
   * Cờ TẠM THỜI để thử luồng ngày thi mà không phải chờ tới đúng giờ giải.
   *
   * Bỏ qua điều kiện thời gian và trạng thái giải khi điểm danh. Cố ý chặn cứng
   * ở production: một cờ env đặt nhầm trên máy chủ thật sẽ cho điểm danh giải
   * chưa đóng đăng ký, giao xe cho người chưa chắc suất.
   */
  devBypassContestCheckInWindow:
    nodeEnv !== 'production' && parseBoolean(process.env.DEV_BYPASS_CONTEST_CHECKIN),

  db: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    name: process.env.DB_NAME ?? 'rcfeild_db',
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    ssl: parseBoolean(process.env.DB_SSL),
    sslRejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
    autoMigrate: parseBoolean(process.env.DB_AUTO_MIGRATE, true),
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    required: parseBoolean(process.env.REDIS_REQUIRED, true),
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  },

  email: {
    provider: process.env.EMAIL_PROVIDER ?? 'Brevo',
    brevoApiKey: process.env.EMAIL_BREVO_API_KEY ?? process.env.BREVO_API_KEY ?? '',
    brevoBaseUrl: process.env.EMAIL_BREVO_BASE_URL ?? 'https://api.brevo.com/v3',
    fromEmail:
      process.env.EMAIL_FROM_EMAIL ?? process.env.BREVO_SENDER_EMAIL ?? 'no-reply@rcfield.local',
    fromName: process.env.EMAIL_FROM_NAME ?? process.env.BREVO_SENDER_NAME ?? 'RCField',
    passwordResetTtlMinutes: parseInt(process.env.PASSWORD_RESET_CODE_TTL_MINUTES ?? '30', 10),
  },

  platform: {
    feePct: parseFloat(process.env.PLATFORM_FEE_PCT ?? '0.15'),
    paymentWindowMinutes: parseInt(process.env.PAYMENT_WINDOW_MINUTES ?? '30', 10),
    slotLockTtlSeconds: parseInt(process.env.SLOT_LOCK_TTL_SECONDS ?? '1800', 10),
  },

  vnpay: {
    tmnCode: process.env.VNPAY_TMN_CODE ?? process.env.VNP_TMN_CODE ?? '',
    hashSecret: process.env.VNPAY_HASH_SECRET ?? process.env.VNP_HASH_SECRET ?? '',
    paymentUrl:
      process.env.VNPAY_URL ??
      process.env.VNP_URL ??
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    returnUrl:
      process.env.VNPAY_RETURN_URL ??
      process.env.VNP_RETURN_URL ??
      'http://localhost:3000/api/payments/vnpay-return',
    ipnUrl:
      process.env.VNPAY_IPN_URL ??
      process.env.VNP_IPN_URL ??
      'http://localhost:3000/api/payments/vnpay-ipn',
    locale: process.env.VNPAY_LOCALE ?? 'vn',
    currCode: process.env.VNPAY_CURR_CODE ?? 'VND',
    mockEnabled: parseBoolean(process.env.VNPAY_MOCK_ENABLED),
  },

  // Nhận tiền chuyển khoản thẳng vào tài khoản của từng chi nhánh.
  //
  // `sandboxBank` bật một bên ngân hàng mô phỏng để demo được khi chưa đăng ký
  // dịch vụ đối soát. Cố ý KHÔNG chặn theo môi trường — bật/tắt hoàn toàn do
  // người vận hành quyết định. Xem `specs/019-cafe-bank-payment/spec.md`,
  // mục "Trước khi vận hành thương mại", cho danh sách phải làm trước khi
  // hệ thống nhận đồng tiền thật đầu tiên.
  sandboxBank: {
    enabled: parseBoolean(process.env.SANDBOX_BANK_ENABLED),
  },

  bankWebhook: {
    // Dịch vụ đối soát gửi kèm dạng `Authorization: Apikey <key>`.
    apiKey: process.env.BANK_WEBHOOK_API_KEY ?? '',
  },

  ai: {
    googleApiKey: process.env.GOOGLE_API_KEY ?? '',
    embeddingModel: process.env.GOOGLE_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    model: process.env.GOOGLE_MODEL ?? 'gemini-2.5-pro',
    supportModel: process.env.GOOGLE_SUPPORT_MODEL ?? 'gemini-2.0-flash',
  },

  frontendUrl: getSafeFrontendUrl(),
  apiBaseUrl: (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),

  facebook: {
    appId: process.env.FB_APP_ID ?? '',
    appSecret: process.env.FB_APP_SECRET ?? '',
    verifyToken: process.env.FB_VERIFY_TOKEN ?? '',
    redirectUri: process.env.FB_REDIRECT_URI ?? '',
    encryptionKey: Buffer.from(process.env.CHANNEL_ENCRYPTION_KEY ?? '0'.repeat(64), 'hex'),
  },

  payos: {
    clientId: process.env.PAYOS_CLIENT_ID ?? '',
    apiKey: process.env.PAYOS_API_KEY ?? '',
    checksumKey: process.env.PAYOS_CHECKSUM_KEY ?? '',
  },

  features: {
    fbChatQueueEnabled: parseBoolean(process.env.FB_CHAT_QUEUE_ENABLED, true),
  },
} as const;

// Ngân hàng mô phỏng gọi ngược vào điểm nhận thông báo của chính hệ thống và
// phải mang khoá xác thực. Bật mô phỏng mà quên khai khoá thì mọi giao dịch
// demo đều bị từ chối 401 — hỏng lúc chạy chứ không hỏng lúc khởi động, nên
// chặn ngay ở đây cho thấy lỗi sớm.
if (env.sandboxBank.enabled && !env.bankWebhook.apiKey) {
  throw new Error(
    'SANDBOX_BANK_ENABLED=true nhưng thiếu BANK_WEBHOOK_API_KEY. ' +
      'Khai khoá này trước khi bật ngân hàng mô phỏng.',
  );
}

import 'dotenv/config';

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '3000', 10),

  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    name: process.env.DB_NAME ?? 'rcfeild_db',
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
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
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  },

  platform: {
    feePct: parseFloat(process.env.PLATFORM_FEE_PCT ?? '0.15'),
    paymentWindowMinutes: parseInt(process.env.PAYMENT_WINDOW_MINUTES ?? '30', 10),
    slotLockTtlSeconds: parseInt(process.env.SLOT_LOCK_TTL_SECONDS ?? '1800', 10),
  },

  ai: {
    googleApiKey: process.env.GOOGLE_API_KEY ?? '',
    embeddingModel: process.env.GOOGLE_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    model: process.env.GOOGLE_MODEL ?? 'gemini-2.5-pro',
    supportModel: process.env.GOOGLE_SUPPORT_MODEL ?? 'gemini-2.0-flash',
  },

  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  facebook: {
    appId: process.env.FB_APP_ID ?? '',
    appSecret: process.env.FB_APP_SECRET ?? '',
    verifyToken: process.env.FB_VERIFY_TOKEN ?? '',
    redirectUri: process.env.FB_REDIRECT_URI ?? '',
    encryptionKey: Buffer.from(process.env.CHANNEL_ENCRYPTION_KEY ?? '0'.repeat(64), 'hex'),
  },
} as const;

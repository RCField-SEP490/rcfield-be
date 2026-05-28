import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from './env';

const ssl = env.db.ssl
  ? {
      rejectUnauthorized: env.db.sslRejectUnauthorized,
    }
  : undefined;

export const AppDataSource = new DataSource({
  type: 'postgres',
  // Supabase is the active target. Legacy local host fields stay as fallback only.
  ...(env.db.url
    ? {
        url: env.db.url,
      }
    : {
        host: env.db.host,
        port: env.db.port,
        database: env.db.name,
        username: env.db.username,
        password: env.db.password,
      }),
  ssl,
  synchronize: false,
  logging: ['error'],
  entities: [__dirname + '/../models/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/../migrations/**/*.{ts,js}'],
});

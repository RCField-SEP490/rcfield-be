import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from './env';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  username: env.db.username,
  password: env.db.password,
  synchronize: false,
  logging: ['error'],
  entities: [__dirname + '/../models/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/../migrations/**/*.{ts,js}'],
});

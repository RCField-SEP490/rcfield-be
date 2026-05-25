import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppDataSource } from '../config/database';
import { AppError, AuthPayload, AuthRequest, ProviderStatus, UserRole } from '../types';

export function authenticate(req: AuthRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwt.secret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    next(new AppError('Token invalid or expired', 401, 'TOKEN_INVALID'));
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'));
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
    }
    next();
  };
}

export function requireActiveProvider(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== UserRole.PROVIDER) return next();

  AppDataSource.query<{ registration_status: string }[]>(
    `SELECT registration_status FROM provider_profiles WHERE user_id = $1 AND deleted_at IS NULL`,
    [req.user.userId],
  )
    .then((rows) => {
      const status = rows[0]?.registration_status;
      if (status === ProviderStatus.SUSPENDED) {
        return next(new AppError('Tài khoản đã bị tạm khóa', 403, 'ACCOUNT_SUSPENDED'));
      }
      next();
    })
    .catch(next);
}

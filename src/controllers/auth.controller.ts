import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { AuthRequest, UserRole } from '../types';
import { logger } from '../config/logger';
import {
  LoginSchema,
  RegisterSchema,
  GoogleSchema,
  RefreshSchema,
  LogoutSchema,
} from '../validate';

export const authController = {
  // POST /api/v1/auth/register
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const input = RegisterSchema.parse(req.body);
      const result = await authService.registerWithPassword({
        ...input,
        role: input.role === 'PROVIDER' ? UserRole.PROVIDER : UserRole.CUSTOMER,
      });
      logger.auth('register', { email: result.user.email, role: result.user.role });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/auth/login
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = LoginSchema.parse(req.body);
      const result = await authService.loginWithPassword(email, password);
      logger.auth('login', { email, role: result.user.role });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/auth/google
  async googleLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id_token } = GoogleSchema.parse(req.body);
      const result = await authService.loginWithGoogle(id_token);
      logger.auth('google login', { email: result.user.email, role: result.user.role });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/auth/refresh
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refresh_token } = RefreshSchema.parse(req.body);
      const result = await authService.refreshTokens(refresh_token);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/v1/auth/logout  [auth]
  async logout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { refresh_token } = LogoutSchema.parse(req.body);
      await authService.logout(req.user!.userId, refresh_token);
      res.json({ success: true, message: 'Đăng xuất thành công' });
    } catch (err) {
      next(err);
    }
  },
};

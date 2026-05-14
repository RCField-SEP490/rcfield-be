import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { AuthRequest } from '../types';
import { logger } from '../config/logger';
import { token } from 'morgan';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const GoogleSchema = z.object({
  id_token: z.string().min(1),
});

const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

const LogoutSchema = z.object({
  refresh_token: z.string().min(1),
});

export const authController = {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = LoginSchema.parse(req.body);
      const result = await authService.loginWithPassword(email, password);
      logger.info('[Auth] login', { email, role: result.user.role, token: result.access_token });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async googleLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id_token } = GoogleSchema.parse(req.body);
      const result = await authService.loginWithGoogle(id_token);
      logger.info('[Auth] google login', { email: result.user.email, role: result.user.role, token: result.access_token });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refresh_token } = RefreshSchema.parse(req.body);
      const result = await authService.refreshTokens(refresh_token);
      logger.info('[Auth] refresh tokens', { token: result.access_token });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

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

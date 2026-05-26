import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { AppDataSource } from '../config/database';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { AppError, UserRole, AuthProvider, ProviderStatus } from '../types';
import { User } from '../models/user.entity';
import { RefreshToken } from '../models/refresh-token.entity';
import { ProviderProfile } from '../models/provider-profile.entity';

const BRUTE_FORCE_MAX = 5;
const BRUTE_FORCE_TTL = 900; // 15 minutes
const REFRESH_EXPIRY_DAYS = 7;

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface LoginResult extends TokenPair {
  user: { id: string; email: string; role: UserRole; registrationStatus?: string };
}

export interface RegisterInput {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole.CUSTOMER | UserRole.PROVIDER;
}

class AuthService {
  private get userRepo() {
    return AppDataSource.getRepository(User);
  }

  private get tokenRepo() {
    return AppDataSource.getRepository(RefreshToken);
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async issueTokenPair(user: User): Promise<TokenPair> {
    const access_token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      env.jwt.secret,
      { expiresIn: '1h' },
    );

    const raw = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);

    await this.tokenRepo.save(
      this.tokenRepo.create({
        user_id: user.id,
        token: this.hashToken(raw),
        expires_at: expiresAt,
      }),
    );

    return { access_token, refresh_token: raw };
  }

  async loginWithPassword(email: string, password: string): Promise<LoginResult> {
    const failKey = `auth:failed:${email}`;

    const fails = Number((await redis.get(failKey)) ?? 0);
    if (fails >= BRUTE_FORCE_MAX) {
      throw new AppError('Tài khoản bị khoá', 403, 'ACCOUNT_LOCKED');
    }

    const user = await this.userRepo.findOne({ where: { email } });

    if (!user || !user.password_hash) {
      await redis.incr(failKey);
      await redis.expire(failKey, BRUTE_FORCE_TTL);
      throw new AppError('Email hoặc mật khẩu không đúng', 401, 'INVALID_CREDENTIALS');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await redis.incr(failKey);
      await redis.expire(failKey, BRUTE_FORCE_TTL);
      throw new AppError('Email hoặc mật khẩu không đúng', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.is_active) {
      throw new AppError('Tài khoản bị khoá', 403, 'ACCOUNT_LOCKED');
    }

    await redis.del(failKey);
    const tokens = await this.issueTokenPair(user);
    let registrationStatus: string | undefined;
    if (user.role === UserRole.PROVIDER) {
      const profile = await AppDataSource.getRepository(ProviderProfile).findOne({
        where: { userId: user.id },
      });
      registrationStatus = profile?.registrationStatus ?? ProviderStatus.PENDING;
    }
    return {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role, registrationStatus },
    };
  }

  async registerWithPassword(input: RegisterInput): Promise<LoginResult> {
    const email = input.email.toLowerCase().trim();
    const existing = await this.userRepo.findOne({ where: { email } });

    if (existing) {
      throw new AppError('Email đã được sử dụng', 409, 'EMAIL_ALREADY_EXISTS');
    }

    const password_hash = await bcrypt.hash(input.password, 10);
    const user = await this.userRepo.save(
      this.userRepo.create({
        email,
        full_name: input.full_name.trim(),
        phone: input.phone ?? null,
        password_hash,
        role: input.role,
        auth_provider: AuthProvider.LOCAL,
        is_active: true,
      }),
    );

    const tokens = await this.issueTokenPair(user);
    let regStatus: string | undefined;
    if (user.role === UserRole.PROVIDER) {
      const profile = await AppDataSource.getRepository(ProviderProfile).findOne({
        where: { userId: user.id },
      });
      regStatus = profile?.registrationStatus ?? ProviderStatus.PENDING;
    }
    return {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role, registrationStatus: regStatus },
    };
  }

  async loginWithGoogle(idToken: string): Promise<LoginResult> {
    if (!env.google.clientId) {
      throw new AppError('Google Client ID chưa được cấu hình', 500, 'GOOGLE_CONFIG_MISSING');
    }

    let email: string;
    let googleId: string;
    let fullName: string;

    try {
      const client = new OAuth2Client(env.google.clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: env.google.clientId });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('No email in payload');
      if (!payload.sub) throw new Error('No subject in payload');
      email = payload.email.toLowerCase().trim();
      googleId = payload.sub;
      fullName = payload.name?.trim() || email.split('@')[0];
    } catch {
      throw new AppError('Xác thực Google thất bại', 401, 'GOOGLE_AUTH_FAILED');
    }

    let user = await this.userRepo.findOne({ where: [{ google_id: googleId }, { email }] });

    if (!user) {
      user = await this.userRepo.save(
        this.userRepo.create({
          email,
          full_name: fullName,
          role: UserRole.CUSTOMER,
          auth_provider: AuthProvider.GOOGLE,
          google_id: googleId,
          is_active: true,
        }),
      );
    } else if (user.auth_provider === AuthProvider.LOCAL) {
      user.auth_provider = AuthProvider.GOOGLE;
      user.google_id = googleId;
      if (!user.full_name) user.full_name = fullName;
      user = await this.userRepo.save(user);
    } else if (!user.google_id) {
      user.google_id = googleId;
      user = await this.userRepo.save(user);
    }

    if (!user.is_active) {
      throw new AppError('Tài khoản bị khoá', 403, 'ACCOUNT_LOCKED');
    }

    const tokens = await this.issueTokenPair(user);
    let registrationStatus: string | undefined;
    if (user.role === UserRole.PROVIDER) {
      const profile = await AppDataSource.getRepository(ProviderProfile).findOne({
        where: { userId: user.id },
      });
      registrationStatus = profile?.registrationStatus ?? ProviderStatus.PENDING;
    }
    return {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role, registrationStatus },
    };
  }

  async refreshTokens(rawToken: string): Promise<TokenPair> {
    const hash = this.hashToken(rawToken);
    const row = await this.tokenRepo.findOne({ where: { token: hash } });

    if (!row || row.expires_at <= new Date()) {
      if (row) await this.tokenRepo.delete(row.id);
      throw new AppError(
        'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại',
        401,
        'INVALID_REFRESH_TOKEN',
      );
    }

    await this.tokenRepo.delete(row.id);

    const user = await this.userRepo.findOneOrFail({ where: { id: row.user_id } });
    return this.issueTokenPair(user);
  }

  async logout(userId: string, rawToken: string): Promise<void> {
    const hash = this.hashToken(rawToken);
    await this.tokenRepo.delete({ user_id: userId, token: hash });
  }
}

export const authService = new AuthService();

import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const GoogleSchema = z.object({
  id_token: z.string().min(1),
});

export const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const LogoutSchema = z.object({
  refresh_token: z.string().min(1),
});

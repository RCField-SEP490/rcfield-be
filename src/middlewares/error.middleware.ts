import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../types';
import { ZodError } from 'zod';
import { logger } from '../config/logger';

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      errors: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const isFileTooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(isFileTooLarge ? 413 : 400).json({
      success: false,
      code: err.code,
      message: isFileTooLarge
        ? 'Ảnh vượt quá dung lượng cho phép 5MB. Vui lòng nén ảnh hoặc chụp lại ảnh nhẹ hơn.'
        : err.message,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      code: err.code ?? 'APP_ERROR',
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  logger.error('Server', 'Unhandled error', err);
  res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Something went wrong',
  });
}

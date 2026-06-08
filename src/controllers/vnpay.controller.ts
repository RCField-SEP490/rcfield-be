import { Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError, AuthRequest } from '../types';
import { CreateVnpayPaymentSchema } from '../validate';
import { createPaymentUrl, verifyVnpayParams } from '../services/vnpay.service';
import { processConfirmation } from '../services/payment.service';
import { logger } from '../config/logger';

function getClientIp(req: AuthRequest): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

// POST /api/v1/payments/vnpay/create  [auth]
export async function createVnpayPayment(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = CreateVnpayPaymentSchema.parse(req.body);
    const paymentUrl = createPaymentUrl({
      amount: body.amount,
      txnRef: body.txn_ref,
      orderInfo: body.order_info,
      orderType: body.order_type,
      bankCode: body.bank_code,
      returnUrl: body.return_url,
      ipAddr: getClientIp(req),
    });

    res.status(201).json({
      success: true,
      data: {
        payment_url: paymentUrl,
        txn_ref: body.txn_ref,
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/payments/vnpay/return
export async function handleVnpayReturn(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await processConfirmation(req.query as Record<string, unknown>);
    const target = new URL('/payment/result', env.frontendUrl);

    if (result.rspCode === '00') {
      // Extract bookingId from txnRef (reverse: pad to 32 chars hex → UUID format)
      const verified = verifyVnpayParams(req.query);
      target.searchParams.set('status', 'success');
      target.searchParams.set('txn_ref', verified.txnRef);
    } else if (result.rspCode === '02') {
      // Already confirmed — idempotent, still show success
      const verified = verifyVnpayParams(req.query);
      target.searchParams.set('status', 'success');
      target.searchParams.set('txn_ref', verified.txnRef);
      target.searchParams.set('already_confirmed', '1');
    } else {
      target.searchParams.set('status', 'failed');
      target.searchParams.set('response_code', result.rspCode);
    }

    res.redirect(target.toString());
  } catch (err) {
    if (err instanceof AppError) {
      const target = new URL('/payment/result', env.frontendUrl);
      target.searchParams.set('status', 'failed');
      target.searchParams.set('reason', err.code ?? 'unknown');
      res.redirect(target.toString());
      return;
    }
    next(err);
  }
}

// GET /api/v1/payments/vnpay/ipn  (VNPay server-to-server callback)
export async function handleVnpayIpn(
  req: AuthRequest,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  try {
    const result = await processConfirmation(req.query as Record<string, unknown>);
    logger.info('VNPay', `IPN processed rspCode=${result.rspCode}`);
    res.json({ RspCode: result.rspCode, Message: result.message });
  } catch (err) {
    // VNPay requires a response even on internal errors
    logger.error('VNPay', 'IPN handler error', err);
    res.json({ RspCode: '99', Message: 'Unknown error' });
  }
}

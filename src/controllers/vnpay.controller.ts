import { Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError, AuthRequest } from '../types';
import { CreateVnpayPaymentSchema } from '../validate';
import { createPaymentUrl, verifyVnpayParams } from '../services/vnpay.service';

function getClientIp(req: AuthRequest): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

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

export async function handleVnpayReturn(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = verifyVnpayParams(req.query);
    const status = result.isSuccess ? 'success' : 'failed';
    const target = new URL('/payment/result', env.frontendUrl);

    target.searchParams.set('gateway', 'vnpay');
    target.searchParams.set('status', status);
    target.searchParams.set('txn_ref', result.txnRef);
    target.searchParams.set('response_code', result.responseCode);

    res.redirect(target.toString());
  } catch (err) {
    if (err instanceof AppError) {
      const target = new URL('/payment/result', env.frontendUrl);
      target.searchParams.set('gateway', 'vnpay');
      target.searchParams.set('status', 'failed');
      target.searchParams.set('reason', err.code ?? 'unknown');
      res.redirect(target.toString());
      return;
    }
    next(err);
  }
}

export async function handleVnpayIpn(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = verifyVnpayParams(req.query);

    if (!result.isValid) {
      res.json({ RspCode: '97', Message: 'Invalid signature' });
      return;
    }

    res.json({
      RspCode: result.isSuccess ? '00' : '02',
      Message: result.isSuccess ? 'Confirm Success' : 'Payment failed',
      data: {
        txn_ref: result.txnRef,
        amount: result.amount,
        response_code: result.responseCode,
        transaction_status: result.transactionStatus,
        transaction_no: result.transactionNo,
      },
    });
  } catch (err) {
    next(err);
  }
}

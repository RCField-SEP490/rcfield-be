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

    // Kiểm tra xem có yêu cầu redirect về thiết bị di động (Expo/App) qua Deep Link hay không
    const mobileRedirect = req.query.mobile_redirect as string | undefined;

    if (mobileRedirect) {
      const isSuccess = result.rspCode === '00' || result.rspCode === '02';
      const status = isSuccess ? 'success' : 'failed';
      const msg = isSuccess
        ? 'Thanh toán thành công! Ca chơi của bạn đã được xác nhận.'
        : `Thanh toán thất bại (Mã lỗi: ${result.rspCode || 'unknown'})`;

      const separator = mobileRedirect.includes('?') ? '&' : '?';
      const finalRedirectUrl = `${mobileRedirect}${separator}status=${status}&txn_ref=${(req.query.vnp_TxnRef as string) || ''}`;

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>RCField Payment</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                  background-color: #0b0f19;
                  color: white;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                  text-align: center;
                  padding: 50px 20px;
                }
                .card {
                  background-color: #0f172a;
                  border: 1px solid #1e293b;
                  border-radius: 20px;
                  padding: 40px 30px;
                  max-width: 420px;
                  margin: auto;
                  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
                }
                .icon {
                  font-size: 54px;
                  margin-bottom: 20px;
                }
                h1 {
                  color: ${isSuccess ? '#10b981' : '#f87171'};
                  font-size: 22px;
                  font-weight: 800;
                  margin-bottom: 10px;
                }
                p {
                  color: #94a3b8;
                  font-size: 14px;
                  line-height: 1.6;
                  margin-bottom: 35px;
                }
                .btn {
                  display: block;
                  background-color: #ea580c;
                  color: white;
                  padding: 14px 24px;
                  border-radius: 12px;
                  text-decoration: none;
                  font-weight: bold;
                  font-size: 15px;
                }
                .btn:active {
                  background-color: #c2410c;
                }
                .hint {
                  margin-top: 25px;
                  font-size: 12px;
                  color: #64748b;
                  line-height: 1.5;
                  border-top: 1px solid #1e293b;
                  padding-top: 15px;
                }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="icon">${isSuccess ? '✅' : '❌'}</div>
                <h1>${isSuccess ? 'Thanh toán thành công!' : 'Thanh toán thất bại'}</h1>
                <p>${msg}</p>
                <a href="${finalRedirectUrl}" class="btn">Quay lại ứng dụng RCField</a>
                <p class="hint">
                  Nếu ứng dụng không tự động mở lại, vui lòng bấm nút <strong>"Xong" (Done)</strong> hoặc dấu <strong>"X"</strong> ở góc màn hình trình duyệt để quay lại app.
                </p>
            </div>
            <script>
                // Tự động redirect về Expo Go / App sau 1.5 giây
                setTimeout(function() {
                    window.location.href = "${finalRedirectUrl}";
                }, 1500);
            </script>
        </body>
        </html>
      `);
      return;
    }

    let target: URL;
    try {
      target = new URL('/payment/result', env.frontendUrl);
    } catch {
      target = new URL('/payment/result', 'http://localhost:5173');
    }

    if (result.rspCode === '00') {
      const verified = verifyVnpayParams(req.query);
      target.searchParams.set('status', 'success');
      target.searchParams.set('txn_ref', verified.txnRef);
    } else if (result.rspCode === '02') {
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
    const mobileRedirect = req.query.mobile_redirect as string | undefined;
    if (mobileRedirect) {
      const separator = mobileRedirect.includes('?') ? '&' : '?';
      res.redirect(`${mobileRedirect}${separator}status=failed&reason=unknown`);
      return;
    }

    if (err instanceof AppError) {
      let target: URL;
      try {
        target = new URL('/payment/result', env.frontendUrl);
      } catch {
        target = new URL('/payment/result', 'http://localhost:5173');
      }
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

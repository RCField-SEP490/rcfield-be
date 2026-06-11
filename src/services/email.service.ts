import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, FnbOrderType } from '../types';
import { AppDataSource } from '../config/database';
import { FnbOrder } from '../models/fnb-order.entity';
import { generateInvoicePdf } from './invoice-pdf.service';
import type { BookingSnapshot } from './payment.service';

type SendPasswordResetCodeInput = {
  to: string;
  code: string;
  ttlMinutes: number;
};

type SendStaffInviteInput = {
  to: string;
  fullName: string;
  inviteUrl: string;
};

class EmailService {
  private async brevoSend(payload: object): Promise<void> {
    if (env.email.provider !== 'Brevo') {
      throw new AppError('Email provider chưa được hỗ trợ', 500, 'EMAIL_PROVIDER_UNSUPPORTED');
    }
    if (!env.email.brevoApiKey) {
      throw new AppError('Brevo API key chưa được cấu hình', 500, 'BREVO_CONFIG_MISSING');
    }

    const response = await fetch(`${env.email.brevoBaseUrl}/smtp/email`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': env.email.brevoApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error('Brevo', `send failed status=${response.status}`, text);
      if (response.status === 401)
        throw new AppError('Brevo API key không hợp lệ', 502, 'BREVO_API_KEY_INVALID');
      if (response.status === 400 || response.status === 403) {
        throw new AppError(
          'Brevo từ chối gửi email. Vui lòng kiểm tra sender email/domain.',
          502,
          'BREVO_SENDER_NOT_VERIFIED',
        );
      }
      throw new AppError('Không thể gửi email qua Brevo', 502, 'BREVO_SEND_FAILED');
    }
  }

  async sendBookingConfirmation(bookingId: string): Promise<void> {
    const ds = AppDataSource;

    const rows = await ds.query<
      {
        booking_id: string;
        slot_start: Date;
        slot_end: Date;
        play_mode: string;
        cafe_name: string;
        cafe_address: string;
        customer_email: string;
        customer_name: string;
      }[]
    >(
      `SELECT b.id AS booking_id, b.slot_start, b.slot_end, b.play_mode,
              c.name AS cafe_name, c.address AS cafe_address,
              u.email AS customer_email, u.full_name AS customer_name
         FROM bookings b
         JOIN cafes c ON c.id = b.cafe_id
         JOIN users u ON u.id = b.customer_id
        WHERE b.id = $1`,
      [bookingId],
    );

    if (!rows.length) return;
    const r = rows[0];

    const shortRef = bookingId.substring(0, 8).toUpperCase();
    const slotStart = new Date(r.slot_start);
    const slotEnd = new Date(r.slot_end);

    const slotLabel = slotStart.toLocaleString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const endTime = slotEnd.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const modeLabel = r.play_mode === 'RENTAL' ? 'Thuê xe tại quán' : 'Mang xe cá nhân (BYOC)';

    await this.brevoSend({
      sender: { email: env.email.fromEmail, name: env.email.fromName },
      to: [{ email: r.customer_email, name: r.customer_name }],
      subject: `✅ Đặt sân thành công — #${shortRef} | RCField`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
          <div style="background:#111827;padding:24px 32px">
            <span style="color:#fff;font-size:20px;font-weight:700">RCField</span>
          </div>
          <div style="padding:32px">
            <h2 style="margin:0 0 8px">Đặt sân thành công! 🎉</h2>
            <p style="color:#6b7280;margin:0 0 24px">Cảm ơn bạn đã đặt sân tại <strong>${r.cafe_name}</strong>.</p>

            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px">
              <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#059669;letter-spacing:0.05em">MÃ ĐẶT SÂN</p>
              <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:0.15em;color:#111827">#${shortRef}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#6b7280">Xuất trình mã này khi check-in tại quán</p>
            </div>

            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px">Chi nhánh</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600">${r.cafe_name}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Thời gian</td>
                <td style="padding:8px 0;font-size:13px">${slotLabel} – ${endTime}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Chế độ</td>
                <td style="padding:8px 0;font-size:13px">${modeLabel}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Địa chỉ</td>
                <td style="padding:8px 0;font-size:13px">${r.cafe_address}</td>
              </tr>
            </table>

            <p style="font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px;margin:0">
              Hóa đơn chi tiết đã được gửi kèm trong email riêng. Mọi thắc mắc vui lòng liên hệ chi nhánh trực tiếp.
            </p>
          </div>
        </div>
      `,
    });

    logger.info('EmailService', 'booking confirmation sent', {
      bookingId,
      email: r.customer_email,
    });
  }

  async sendBookingInvoice(bookingId: string): Promise<void> {
    const ds = AppDataSource;

    const rows = await ds.query<
      {
        slot_start: Date;
        slot_end: Date;
        play_mode: string;
        snapshot: object | null;
        cafe_name: string;
        cafe_address: string;
        cafe_phone: string | null;
        customer_email: string;
        customer_name: string;
        txn_ref: string;
        paid_at: Date;
      }[]
    >(
      `SELECT b.slot_start, b.slot_end, b.play_mode, b.snapshot,
              c.name AS cafe_name, c.address AS cafe_address, c.phone AS cafe_phone,
              u.email AS customer_email, u.full_name AS customer_name,
              pt.txn_ref, pt.created_at AS paid_at
         FROM bookings b
         JOIN cafes c ON c.id = b.cafe_id
         JOIN users u ON u.id = b.customer_id
         JOIN payment_transactions pt ON pt.booking_id = b.id AND pt.type = 'PAYMENT' AND pt.status = 'SUCCESS'
        WHERE b.id = $1
        ORDER BY pt.created_at DESC
        LIMIT 1`,
      [bookingId],
    );

    if (!rows.length) return;
    const r = rows[0];

    const snapshot = r.snapshot as BookingSnapshot | null;
    if (!snapshot) return;

    const shortRef = bookingId.substring(0, 8).toUpperCase();

    // Build line items from snapshot
    const lineItems: Array<{ description: string; qty: number; unitPrice: number; total: number }> =
      [];

    // Slot fee
    if (snapshot.slot_fee_total > 0) {
      const slotStart = new Date(r.slot_start);
      const slotEnd = new Date(r.slot_end);
      const hours = Math.round((slotEnd.getTime() - slotStart.getTime()) / 3_600_000);
      lineItems.push({
        description: `Phí sân (${hours}h)`,
        qty: 1,
        unitPrice: snapshot.slot_fee_total,
        total: snapshot.slot_fee_total,
      });
    }

    // Vehicle fees (rental + deposit per vehicle)
    for (let i = 0; i < snapshot.vehicles.length; i++) {
      const v = snapshot.vehicles[i];
      if (v.rental_fee > 0) {
        lineItems.push({
          description: `Phí thuê xe #${i + 1}`,
          qty: 1,
          unitPrice: v.rental_fee,
          total: v.rental_fee,
        });
      }
      if (v.security_deposit > 0) {
        lineItems.push({
          description: `Tiền cọc xe #${i + 1}`,
          qty: 1,
          unitPrice: v.security_deposit,
          total: v.security_deposit,
        });
      }
    }

    // FnB pre-order
    if (snapshot.fnb_total > 0) {
      const fnbOrders = await ds.getRepository(FnbOrder).find({
        where: { bookingId, orderType: FnbOrderType.PRE_ORDER },
      });
      if (fnbOrders.length) {
        const fnbSum = fnbOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
        lineItems.push({
          description: 'Đồ ăn/uống đặt trước (F&B)',
          qty: 1,
          unitPrice: fnbSum,
          total: fnbSum,
        });
      } else {
        lineItems.push({
          description: 'Đồ ăn/uống đặt trước (F&B)',
          qty: 1,
          unitPrice: snapshot.fnb_total,
          total: snapshot.fnb_total,
        });
      }
    }

    const depositAmount = snapshot.vehicles.reduce((sum, v) => sum + v.security_deposit, 0);

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: shortRef,
      issuedAt: new Date(r.paid_at),
      txnRef: r.txn_ref,
      cafeName: r.cafe_name,
      cafeAddress: r.cafe_address,
      cafePhone: r.cafe_phone,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      slotStart: new Date(r.slot_start),
      slotEnd: new Date(r.slot_end),
      playMode: r.play_mode,
      bookingMode: r.play_mode,
      lineItems,
      totalAmount: snapshot.total_charged,
      depositAmount,
    });

    const pdfBase64 = pdfBuffer.toString('base64');

    await this.brevoSend({
      sender: { email: env.email.fromEmail, name: env.email.fromName },
      to: [{ email: r.customer_email, name: r.customer_name }],
      subject: `Hóa đơn đặt sân #${shortRef} — RCField`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
          <div style="background:#111827;padding:24px 32px">
            <span style="color:#fff;font-size:20px;font-weight:700">RCField</span>
          </div>
          <div style="padding:32px">
            <h2 style="margin:0 0 8px">Hóa đơn dịch vụ</h2>
            <p style="color:#6b7280;margin:0 0 24px">
              Hóa đơn <strong>#${shortRef}</strong> đính kèm bên dưới (file PDF).
            </p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px">Chi nhánh</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600">${r.cafe_name}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Tổng thanh toán</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600">${snapshot.total_charged.toLocaleString('vi-VN')} ₫</td>
              </tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px;margin:0">
              Vui lòng lưu hóa đơn này để đối chiếu khi cần. Mọi thắc mắc liên hệ chi nhánh trực tiếp.
            </p>
          </div>
        </div>
      `,
      attachment: [
        {
          content: pdfBase64,
          name: `hoa-don-rcfield-${shortRef.toLowerCase()}.pdf`,
        },
      ],
    });

    logger.info('EmailService', 'invoice email sent', { bookingId, email: r.customer_email });
  }

  async sendStaffInvite(input: SendStaffInviteInput): Promise<void> {
    const subject = 'Lời mời tham gia RCField — Kích hoạt tài khoản nhân viên';
    const textContent = [
      `Xin chào ${input.fullName},`,
      `Bạn được mời tham gia hệ thống quản lý RCField với tư cách nhân viên.`,
      `Nhấn vào link sau để kích hoạt tài khoản và đặt mật khẩu:`,
      input.inviteUrl,
      `Link có hiệu lực trong 48 giờ.`,
      `Nếu bạn không nhận ra lời mời này, vui lòng bỏ qua email này.`,
    ].join('\n\n');

    await this.brevoSend({
      sender: { email: env.email.fromEmail, name: env.email.fromName },
      to: [{ email: input.to }],
      subject,
      textContent,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
          <h2>Lời mời tham gia RCField</h2>
          <p>Xin chào <strong>${input.fullName}</strong>,</p>
          <p>Bạn được mời tham gia hệ thống quản lý RCField với tư cách <strong>nhân viên</strong>.</p>
          <p>Nhấn vào nút bên dưới để kích hoạt tài khoản và đặt mật khẩu:</p>
          <p>
            <a href="${input.inviteUrl}"
               style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
              Kích hoạt tài khoản
            </a>
          </p>
          <p style="color:#6b7280;font-size:13px">Link có hiệu lực trong <strong>48 giờ</strong>.</p>
          <p style="color:#6b7280;font-size:13px">Nếu bạn không nhận ra lời mời này, vui lòng bỏ qua email này.</p>
        </div>
      `,
    });
  }

  async sendPasswordResetCode(input: SendPasswordResetCodeInput): Promise<void> {
    const subject = 'Mã xác nhận đặt lại mật khẩu RCField';
    const textContent = [
      `Mã xác nhận đặt lại mật khẩu RCField của bạn là: ${input.code}`,
      `Mã có hiệu lực trong ${input.ttlMinutes} phút.`,
      'Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.',
    ].join('\n\n');

    await this.brevoSend({
      sender: { email: env.email.fromEmail, name: env.email.fromName },
      to: [{ email: input.to }],
      subject,
      textContent,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
          <h2>Mã xác nhận đặt lại mật khẩu RCField</h2>
          <p>Mã xác nhận của bạn là:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:8px">${input.code}</p>
          <p>Mã có hiệu lực trong <strong>${input.ttlMinutes} phút</strong>.</p>
          <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
        </div>
      `,
    });
  }
}

export const emailService = new EmailService();

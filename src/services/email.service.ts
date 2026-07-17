import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, FnbOrderType } from '../types';
import { AppDataSource } from '../config/database';
import { FnbOrder } from '../models/fnb-order.entity';
import { generateInvoicePdf } from './invoice-pdf.service';
import type { InvoiceParticipant } from './invoice-pdf.service';
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

type SendContestRegistrationEmailInput = {
  to: string;
  customerName: string;
  contestName: string;
  contestStatusLabel: string;
  hostBranchName: string | null;
  startsAt: Date;
  registrationStatusLabel: string;
  paymentStatusLabel: string;
  entryFeeAmount: number;
};

type SendContestReminderEmailInput = {
  to: string;
  customerName: string;
  contestName: string;
  hostBranchName: string | null;
  startsAt: Date;
  reminderLabel: string;
  checkInCode: string | null;
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

    const QRCode = await import('qrcode');
    const qrBuffer = await QRCode.toBuffer(bookingId, {
      errorCorrectionLevel: 'M',
      width: 220,
      margin: 2,
    });
    const { uploadImage } = await import('./cloudinary.service');
    const { url: qrImageUrl } = await uploadImage({
      buffer: qrBuffer,
      folder: 'qr-checkin',
      publicIdPrefix: `qr-${bookingId.substring(0, 8)}`,
    });

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
            <h2 style="margin:0 0 8px">Đặt sân thành công</h2>
            <p style="color:#6b7280;margin:0 0 24px">Cảm ơn bạn đã đặt sân tại <strong>${r.cafe_name}</strong>.</p>

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

            <div style="text-align:center;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#111827">Mã check-in của bạn</p>
              <p style="margin:0 0 16px;font-size:12px;color:#6b7280">Xuất trình mã này khi đến quán để nhân viên kích hoạt phiên chơi</p>
              <img src="${qrImageUrl}" width="180" height="180"
                   alt="QR Check-in #${shortRef}"
                   style="display:block;margin:0 auto 12px;border:6px solid #fff;box-shadow:0 0 0 1px #e5e7eb;border-radius:8px" />
              <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:0.15em;color:#111827">#${shortRef}</p>
            </div>

            <p style="font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px;margin:0">
              Hóa đơn chi tiết đã được gửi kèm trong email riêng. Nếu ảnh QR không hiển thị, dùng mã <strong>#${shortRef}</strong> để nhân viên tra cứu thủ công.
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

    const snapshot = r.snapshot as (BookingSnapshot & Record<string, unknown>) | null;
    if (!snapshot) return;

    const shortRef = bookingId.substring(0, 8).toUpperCase();
    const slotStart = new Date(r.slot_start);
    const slotEnd = new Date(r.slot_end);

    // Extract creation-time fields preserved in snapshot
    const trackTypeName = snapshot.track_type_name as string | null | undefined;
    const pricingLabel = snapshot.pricing_rule_label as string | null | undefined;
    const slotMultiplier = (snapshot.slot_fee_multiplier as number | undefined) ?? 1;
    const promoApplied = snapshot.promotion_applied as
      | { code: string; discount_type: string; discount_amount: number }
      | undefined;

    // Participants
    type ParticipantRow = {
      participant_type: string;
      is_primary_responsible: boolean;
      guest_name: string | null;
      guest_phone: string | null;
      user_full_name: string | null;
      user_phone: string | null;
    };
    const participantRows = (await ds.query(
      `SELECT bp.participant_type, bp.is_primary_responsible,
              bp.guest_name, bp.guest_phone,
              u.full_name AS user_full_name, u.phone AS user_phone
         FROM booking_participants bp
         LEFT JOIN users u ON u.id = bp.user_id
        WHERE bp.booking_id = $1
        ORDER BY bp.is_primary_responsible DESC, bp.created_at ASC`,
      [bookingId],
    )) as ParticipantRow[];
    const participants: InvoiceParticipant[] = participantRows.map((p) => ({
      name: p.user_full_name ?? p.guest_name ?? 'Khách',
      phone: p.user_phone ?? p.guest_phone ?? null,
      isPrimary: p.is_primary_responsible,
    }));

    // Vehicle catalog names for richer line item descriptions
    type VehicleRow = {
      catalog_name: string | null;
      tier: string | null;
      identifier: string | null;
      color: string | null;
      rental_fee_snapshot: string;
      security_deposit_snapshot: string;
    };
    const vehicleRows = (await ds.query(
      `SELECT vc.name AS catalog_name, vc.tier, v.identifier, v.color,
              bv.rental_fee_snapshot, bv.security_deposit_snapshot
         FROM booking_vehicles bv
         LEFT JOIN vehicles v ON v.id = bv.vehicle_id
         LEFT JOIN vehicle_catalogs vc ON vc.id = v.catalog_id
        WHERE bv.booking_id = $1
        ORDER BY bv.created_at ASC`,
      [bookingId],
    )) as VehicleRow[];

    // Build line items
    const lineItems: Array<{ description: string; qty: number; unitPrice: number; total: number }> =
      [];

    if (snapshot.slot_fee_total > 0) {
      const hours = Math.round((slotEnd.getTime() - slotStart.getTime()) / 3_600_000);
      const pricingSuffix =
        pricingLabel && slotMultiplier > 1 ? ` · ${pricingLabel} ×${slotMultiplier}` : '';
      lineItems.push({
        description: `Phí sân (${hours}h)${pricingSuffix}`,
        qty: 1,
        unitPrice: snapshot.slot_fee_total,
        total: snapshot.slot_fee_total,
      });
    }

    const vehicleSnapshots = snapshot.vehicles;
    for (let i = 0; i < vehicleSnapshots.length; i++) {
      const v = vehicleSnapshots[i];
      const vr = vehicleRows[i];
      const vehicleName = vr?.catalog_name
        ? `${vr.catalog_name}${vr.identifier ? ` (${vr.identifier})` : ''}${vr.color ? ` · ${vr.color}` : ''}`
        : `Xe #${i + 1}`;
      if (v.rental_fee > 0) {
        lineItems.push({
          description: `Phí thuê — ${vehicleName}`,
          qty: 1,
          unitPrice: v.rental_fee,
          total: v.rental_fee,
        });
      }
      if (v.security_deposit > 0) {
        lineItems.push({
          description: `Cọc xe — ${vehicleName}`,
          qty: 1,
          unitPrice: v.security_deposit,
          total: v.security_deposit,
        });
      }
    }

    if (snapshot.fnb_total > 0) {
      const fnbOrders = await ds.getRepository(FnbOrder).find({
        where: { bookingId, orderType: FnbOrderType.PRE_ORDER },
      });
      const fnbSum = fnbOrders.length
        ? fnbOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0)
        : snapshot.fnb_total;
      lineItems.push({
        description: 'Đồ ăn/uống đặt trước (F&B)',
        qty: 1,
        unitPrice: fnbSum,
        total: fnbSum,
      });
    }

    const discountAmount = snapshot.discount_amount ?? 0;
    const depositAmount = vehicleSnapshots.reduce((sum, v) => sum + v.security_deposit, 0);

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: shortRef,
      issuedAt: new Date(r.paid_at),
      txnRef: r.txn_ref,
      cafeName: r.cafe_name,
      cafeAddress: r.cafe_address,
      cafePhone: r.cafe_phone,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      participants,
      slotStart,
      slotEnd,
      playMode: r.play_mode,
      trackTypeName,
      pricingLabel,
      slotMultiplier,
      lineItems,
      discountAmount,
      promoCode: promoApplied?.code ?? null,
      totalAmount: snapshot.total_charged,
      depositAmount,
    });

    const pdfBase64 = pdfBuffer.toString('base64');

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

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:13px;width:130px">Chi nhánh</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600">${r.cafe_name}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Địa chỉ</td>
                <td style="padding:8px 0;font-size:13px">${r.cafe_address}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Thời gian</td>
                <td style="padding:8px 0;font-size:13px">${slotLabel} – ${endTime}</td>
              </tr>
              ${
                trackTypeName
                  ? `<tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Loại sân</td>
                <td style="padding:8px 0;font-size:13px">${trackTypeName}</td>
              </tr>`
                  : ''
              }
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Chế độ</td>
                <td style="padding:8px 0;font-size:13px">${modeLabel}</td>
              </tr>
              ${
                pricingLabel && slotMultiplier > 1
                  ? `<tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Giá áp dụng</td>
                <td style="padding:8px 0;font-size:13px;color:#92400e;font-weight:600">${pricingLabel} ×${slotMultiplier}</td>
              </tr>`
                  : ''
              }
            </table>

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border-radius:8px;overflow:hidden">
              ${lineItems
                .map(
                  (item, i) => `
              <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'}">
                <td style="padding:8px 12px;font-size:13px;color:#374151;border-top:1px solid #f3f4f6">${item.description}</td>
                <td style="padding:8px 12px;font-size:13px;text-align:right;white-space:nowrap;border-top:1px solid #f3f4f6">${item.total.toLocaleString('vi-VN')} ₫</td>
              </tr>`,
                )
                .join('')}
              ${
                discountAmount > 0
                  ? `<tr style="border-top:1px solid #d1fae5;background:#f0fdf4">
                <td style="padding:8px 12px;font-size:13px;color:#059669">Mã ưu đãi${promoApplied?.code ? ` (${promoApplied.code})` : ''}</td>
                <td style="padding:8px 12px;font-size:13px;text-align:right;color:#059669;font-weight:600">−${discountAmount.toLocaleString('vi-VN')} ₫</td>
              </tr>`
                  : ''
              }
              <tr style="border-top:2px solid #e5e7eb;background:#f3f4f6">
                <td style="padding:10px 12px;font-size:14px;font-weight:700">Tổng thanh toán</td>
                <td style="padding:10px 12px;font-size:14px;font-weight:700;text-align:right">${snapshot.total_charged.toLocaleString('vi-VN')} ₫</td>
              </tr>
            </table>

            ${
              depositAmount > 0
                ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:#92400e">
              ⚠ Tiền cọc xe <strong>${depositAmount.toLocaleString('vi-VN')} ₫</strong> sẽ được hoàn trả sau khi check-out thành công.
            </div>`
                : ''
            }

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

  async sendContestRegistrationConfirmation(
    input: SendContestRegistrationEmailInput,
  ): Promise<void> {
    const startsAtLabel = input.startsAt.toLocaleString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    await this.brevoSend({
      sender: { email: env.email.fromEmail, name: env.email.fromName },
      to: [{ email: input.to, name: input.customerName }],
      subject: `Xac nhan dang ky giai ${input.contestName} | RCField`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
          <div style="background:#111827;padding:24px 32px">
            <span style="color:#fff;font-size:20px;font-weight:700">RCField</span>
          </div>
          <div style="padding:32px">
            <h2 style="margin:0 0 8px">Dang ky giai dau thanh cong</h2>
            <p style="color:#6b7280;margin:0 0 24px">
              Xin chao <strong>${input.customerName}</strong>, ban da gui dang ky cho
              <strong>${input.contestName}</strong>.
            </p>

            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:13px;width:160px">Giai dau</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600">${input.contestName}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Chi nhanh</td>
                <td style="padding:8px 0;font-size:13px">${input.hostBranchName ?? 'Dang cap nhat'}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Bat dau</td>
                <td style="padding:8px 0;font-size:13px">${startsAtLabel}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Trang thai dang ky</td>
                <td style="padding:8px 0;font-size:13px">${input.registrationStatusLabel}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Le phi</td>
                <td style="padding:8px 0;font-size:13px">${
                  input.entryFeeAmount > 0
                    ? `${input.entryFeeAmount.toLocaleString('vi-VN')} VND`
                    : 'Mien phi'
                }</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Trang thai phi</td>
                <td style="padding:8px 0;font-size:13px">${input.paymentStatusLabel}</td>
              </tr>
            </table>

            <div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#f9fafb">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700">Buoc tiep theo</p>
              <ul style="margin:0;padding-left:18px;color:#4b5563;font-size:13px;line-height:1.7">
                <li>Theo doi thong bao trong ung dung de biet dang ky da duoc duyet hay chua.</li>
                <li>Neu giai co le phi, vui long hoan tat thanh toan theo huong dan.</li>
                <li>Gan den gio thi dau, RCField se gui nhac lich cho ban.</li>
              </ul>
            </div>

            <p style="font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px;margin:24px 0 0">
              Email nay xac nhan thong tin dang ky va lich giai dau hien tai.
            </p>
          </div>
        </div>
      `,
    });
  }

  async sendContestReminder(input: SendContestReminderEmailInput): Promise<void> {
    const startsAtLabel = input.startsAt.toLocaleString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    await this.brevoSend({
      sender: { email: env.email.fromEmail, name: env.email.fromName },
      to: [{ email: input.to, name: input.customerName }],
      subject: `Nhac lich thi dau ${input.contestName} | RCField`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
          <div style="background:#111827;padding:24px 32px">
            <span style="color:#fff;font-size:20px;font-weight:700">RCField</span>
          </div>
          <div style="padding:32px">
            <h2 style="margin:0 0 8px">Sap den gio thi dau</h2>
            <p style="color:#6b7280;margin:0 0 24px">
              Xin chao <strong>${input.customerName}</strong>, ${input.reminderLabel.toLowerCase()} den gio bat dau
              <strong>${input.contestName}</strong>.
            </p>

            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr>
                <td style="padding:8px 0;color:#6b7280;font-size:13px;width:160px">Giai dau</td>
                <td style="padding:8px 0;font-size:13px;font-weight:600">${input.contestName}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Chi nhanh</td>
                <td style="padding:8px 0;font-size:13px">${input.hostBranchName ?? 'Dang cap nhat'}</td>
              </tr>
              <tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Bat dau</td>
                <td style="padding:8px 0;font-size:13px">${startsAtLabel}</td>
              </tr>
              ${
                input.checkInCode
                  ? `<tr style="border-top:1px solid #f3f4f6">
                <td style="padding:8px 0;color:#6b7280;font-size:13px">Check-in code</td>
                <td style="padding:8px 0;font-size:13px;font-weight:700">${input.checkInCode}</td>
              </tr>`
                  : ''
              }
            </table>

            <div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#f9fafb">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700">Luu y truoc khi den</p>
              <ul style="margin:0;padding-left:18px;color:#4b5563;font-size:13px;line-height:1.7">
                <li>Den som de check-in va xac nhan thong tin thi dau.</li>
                <li>Mang theo thong tin dat cho, check-in code hoac email nay de doi chieu neu can.</li>
                <li>Theo doi thong bao trong ung dung de xem lich bracket va cap nhat ket qua.</li>
              </ul>
            </div>
          </div>
        </div>
      `,
    });
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

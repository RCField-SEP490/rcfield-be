import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../types';

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
  async sendStaffInvite(input: SendStaffInviteInput): Promise<void> {
    if (env.email.provider !== 'Brevo') {
      throw new AppError('Email provider chưa được hỗ trợ', 500, 'EMAIL_PROVIDER_UNSUPPORTED');
    }

    if (!env.email.brevoApiKey) {
      throw new AppError('Brevo API key chưa được cấu hình', 500, 'BREVO_CONFIG_MISSING');
    }

    const subject = 'Lời mời tham gia RCField — Kích hoạt tài khoản nhân viên';
    const textContent = [
      `Xin chào ${input.fullName},`,
      `Bạn được mời tham gia hệ thống quản lý RCField với tư cách nhân viên.`,
      `Nhấn vào link sau để kích hoạt tài khoản và đặt mật khẩu:`,
      input.inviteUrl,
      `Link có hiệu lực trong 48 giờ.`,
      `Nếu bạn không nhận ra lời mời này, vui lòng bỏ qua email này.`,
    ].join('\n\n');

    const response = await fetch(`${env.email.brevoBaseUrl}/smtp/email`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': env.email.brevoApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      logger.error(
        'Brevo',
        `Send staff invite email failed with status ${response.status}`,
        responseText,
      );

      if (response.status === 401) {
        throw new AppError('Brevo API key không hợp lệ', 502, 'BREVO_API_KEY_INVALID');
      }

      if (response.status === 400 || response.status === 403) {
        throw new AppError(
          'Brevo từ chối gửi email. Vui lòng kiểm tra sender email/domain.',
          502,
          'BREVO_SENDER_NOT_VERIFIED',
        );
      }

      throw new AppError('Không thể gửi email lời mời qua Brevo', 502, 'BREVO_SEND_FAILED');
    }
  }

  async sendPasswordResetCode(input: SendPasswordResetCodeInput): Promise<void> {
    if (env.email.provider !== 'Brevo') {
      throw new AppError('Email provider chưa được hỗ trợ', 500, 'EMAIL_PROVIDER_UNSUPPORTED');
    }

    if (!env.email.brevoApiKey) {
      throw new AppError('Brevo API key chưa được cấu hình', 500, 'BREVO_CONFIG_MISSING');
    }

    const subject = 'Mã xác nhận đặt lại mật khẩu RCField';
    const textContent = [
      `Mã xác nhận đặt lại mật khẩu RCField của bạn là: ${input.code}`,
      `Mã có hiệu lực trong ${input.ttlMinutes} phút.`,
      'Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.',
    ].join('\n\n');

    const response = await fetch(`${env.email.brevoBaseUrl}/smtp/email`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': env.email.brevoApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: env.email.fromEmail,
          name: env.email.fromName,
        },
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
      }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      logger.error('Brevo', `Send email failed with status ${response.status}`, responseText);

      if (response.status === 401) {
        throw new AppError(
          'Brevo API key không hợp lệ hoặc không có quyền gửi SMTP email',
          502,
          'BREVO_API_KEY_INVALID',
        );
      }

      if (response.status === 400 || response.status === 403) {
        throw new AppError(
          'Brevo từ chối gửi email. Vui lòng kiểm tra sender email/domain đã được xác thực.',
          502,
          'BREVO_SENDER_NOT_VERIFIED',
        );
      }

      throw new AppError('Không thể gửi email xác nhận qua Brevo', 502, 'BREVO_SEND_FAILED');
    }
  }
}

export const emailService = new EmailService();

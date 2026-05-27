import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../types';

type SendPasswordResetCodeInput = {
  to: string;
  code: string;
  ttlMinutes: number;
};

class EmailService {
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

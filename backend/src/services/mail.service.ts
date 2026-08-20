import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.config.js';

export type PasswordResetEmailInput = {
  recipient: string;
  code: string;
  expiresInMinutes: number;
};

export type PasswordResetEmailSender = (input: PasswordResetEmailInput) => Promise<void>;

type MailTransport = Pick<Transporter, 'sendMail' | 'verify'>;

let transport: MailTransport | undefined;

const createSmtpTransport = (): MailTransport => {
  if (env.MAIL_TRANSPORT_MODE !== 'smtp') {
    throw new Error('SMTP gönderimi yapılandırılmamış.');
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: !env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: {
      minVersion: 'TLSv1.2',
      servername: env.SMTP_HOST,
    },
  });
};

const getTransport = (): MailTransport => {
  transport ??= createSmtpTransport();
  return transport;
};

export const buildPasswordResetEmail = (input: PasswordResetEmailInput) => {
  if (!/^\d{6}$/.test(input.code)) throw new Error('Doğrulama kodu 6 haneli olmalıdır.');

  const subject = 'Düğün Ajansım şifre sıfırlama kodunuz';
  const text = [
    'Düğün Ajansım şifre sıfırlama talebiniz için doğrulama kodunuz:',
    '',
    input.code,
    '',
    `Bu kod ${input.expiresInMinutes} dakika boyunca geçerlidir.`,
    'Bu talebi siz oluşturmadıysanız e-postayı dikkate almayın.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="tr">
  <body style="margin:0;background:#f5f3ef;color:#1f2937;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e0d8;border-radius:16px;padding:32px">
            <tr><td style="font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#8a6a3f">Düğün Ajansım</td></tr>
            <tr><td style="padding-top:14px;font-size:24px;font-weight:700">Şifre sıfırlama kodunuz</td></tr>
            <tr><td style="padding-top:18px;font-size:16px;line-height:1.6">Hesabınız için kullanacağınız doğrulama kodu:</td></tr>
            <tr><td align="center" style="padding:24px 0;font-size:36px;font-weight:700;letter-spacing:.22em;color:#1f2937">${input.code}</td></tr>
            <tr><td style="font-size:15px;line-height:1.6">Bu kod ${input.expiresInMinutes} dakika boyunca geçerlidir ve yalnızca bir kez kullanılabilir.</td></tr>
            <tr><td style="padding-top:16px;font-size:13px;line-height:1.6;color:#6b7280">Bu talebi siz oluşturmadıysanız herhangi bir işlem yapmanız gerekmez.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
};

export const sendPasswordResetCodeEmail: PasswordResetEmailSender = async (input) => {
  const message = buildPasswordResetEmail(input);
  const result = await getTransport().sendMail({
    from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_ADDRESS },
    to: input.recipient,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  if (Array.isArray(result.rejected) && result.rejected.length > 0) {
    throw new Error('SMTP sunucusu alıcıyı reddetti.');
  }
};

export const verifySmtpConnection = async (): Promise<void> => {
  await getTransport().verify();
};

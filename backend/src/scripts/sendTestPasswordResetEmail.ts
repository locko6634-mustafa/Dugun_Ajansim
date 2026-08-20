import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.config.js';
import { sendPasswordResetCodeEmail, verifySmtpConnection } from '../services/mail.service.js';

const recipient = z.string().trim().toLowerCase().email().parse(process.env.SMTP_TEST_RECIPIENT);
const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

await verifySmtpConnection();
await sendPasswordResetCodeEmail({
  recipient,
  code,
  expiresInMinutes: env.PASSWORD_RESET_CODE_TTL_MINUTES,
});

console.info('SMTP bağlantısı doğrulandı ve test doğrulama kodu gönderildi.');

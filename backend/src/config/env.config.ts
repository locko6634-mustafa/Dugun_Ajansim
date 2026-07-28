import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env dosyasını yükle
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const portSchema = z
  .string()
  .regex(/^\d+$/, 'PORT yalnızca rakamlardan oluşmalıdır')
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

const corsOriginSchema = z
  .string()
  .min(1, 'CORS_ORIGIN zorunludur')
  .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
  .pipe(
    z
      .array(
        z.string().url('Geçersiz CORS origin adresi').refine((origin) => {
          const url = new URL(origin);
          return ['http:', 'https:'].includes(url.protocol) && url.origin === origin.replace(/\/$/, '');
        }, 'CORS origin yalnızca protokol, alan adı ve port içermelidir').transform((origin) => new URL(origin).origin)
      )
      .min(1, 'En az bir CORS origin adresi tanımlanmalıdır')
  );

const databaseUrlSchema = z
  .string()
  .url('DATABASE_URL geçerli bir URL olmalıdır')
  .refine((value) => ['postgresql:', 'postgres:'].includes(new URL(value).protocol), {
    message: 'DATABASE_URL PostgreSQL bağlantısı olmalıdır',
  });

const envSchema = z.object({
  PORT: portSchema.default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: corsOriginSchema,
  DATABASE_URL: databaseUrlSchema,
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Ortam değişkenleri doğrulaması başarısız:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    throw new Error('Geçersiz ortam değişkenleri');
  }

  return result.data;
};

export const env = parseEnv();

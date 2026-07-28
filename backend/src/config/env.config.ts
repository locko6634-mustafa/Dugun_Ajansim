import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env dosyasını yükle
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL zorunludur'),
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

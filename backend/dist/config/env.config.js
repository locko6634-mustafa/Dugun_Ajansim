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
    .pipe(z
    .array(z.string().url('Geçersiz CORS origin adresi').refine((origin) => {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin.replace(/\/$/, '');
}, 'CORS origin yalnızca protokol, alan adı ve port içermelidir').transform((origin) => new URL(origin).origin))
    .min(1, 'En az bir CORS origin adresi tanımlanmalıdır'));
const databaseUrlSchema = z
    .string()
    .url('DATABASE_URL geçerli bir URL olmalıdır')
    .refine((value) => ['postgresql:', 'postgres:'].includes(new URL(value).protocol), {
    message: 'DATABASE_URL PostgreSQL bağlantısı olmalıdır',
});
const boundedIntegerSchema = (name, minimum, maximum) => z
    .string()
    .regex(/^\d+$/, `${name} yalnızca rakamlardan oluşmalıdır`)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
const envSchema = z
    .object({
    PORT: portSchema.default('5000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: corsOriginSchema,
    DATABASE_URL: databaseUrlSchema,
    TRUST_PROXY: boundedIntegerSchema('TRUST_PROXY', 0, 10).default('0'),
    HEALTHCHECK_TIMEOUT_MS: boundedIntegerSchema('HEALTHCHECK_TIMEOUT_MS', 250, 10_000).default('3000'),
})
    .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') {
        return;
    }
    const databaseUrl = new URL(environment.DATABASE_URL);
    const sslMode = databaseUrl.searchParams.get('sslmode');
    const secureSslModes = new Set(['require', 'verify-ca', 'verify-full']);
    const password = decodeURIComponent(databaseUrl.password).toLowerCase();
    const weakPasswords = new Set(['postgres', 'password', 'admin', 'root', '123456', 'changeme', 'example']);
    if (!sslMode || !secureSslModes.has(sslMode.toLowerCase())) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: 'Production DATABASE_URL güvenli bir sslmode değeri içermelidir',
        });
    }
    if (!password || weakPasswords.has(password)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: 'Production DATABASE_URL güçlü bir veritabanı parolası içermelidir',
        });
    }
});
export const parseEnvironment = (environment) => envSchema.parse(environment);
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

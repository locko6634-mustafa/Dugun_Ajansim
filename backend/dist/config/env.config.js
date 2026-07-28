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
const MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH = 20;
const decodeDatabaseCredential = (credential) => {
    try {
        return decodeURIComponent(credential);
    }
    catch {
        return undefined;
    }
};
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
    const sslModes = databaseUrl.searchParams.getAll('sslmode');
    const sslAcceptValues = databaseUrl.searchParams.getAll('sslaccept');
    const sslMode = sslModes[0];
    const sslAccept = sslAcceptValues[0];
    const password = decodeDatabaseCredential(databaseUrl.password);
    const username = decodeDatabaseCredential(databaseUrl.username);
    if (password === undefined || username === undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: 'Production DATABASE_URL kullanıcı adı veya parola encoding değeri geçersiz',
        });
        return;
    }
    const normalizedPassword = password.toLowerCase();
    const weakPasswords = new Set(['postgres', 'password', 'admin', 'root', '123456', 'changeme', 'example']);
    const passwordCharacterClassCount = [
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password),
    ].filter(Boolean).length;
    if (sslModes.length !== 1 ||
        sslAcceptValues.length !== 1 ||
        sslMode?.toLowerCase() !== 'require' ||
        sslAccept?.toLowerCase() !== 'strict') {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: 'Production DATABASE_URL sslmode=require ve sslaccept=strict içermelidir',
        });
    }
    if (password.length < MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH ||
        passwordCharacterClassCount < 3 ||
        weakPasswords.has(normalizedPassword) ||
        normalizedPassword === username.toLowerCase()) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: `Production DATABASE_URL en az ${MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH} karakterlik güçlü bir veritabanı parolası içermelidir`,
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

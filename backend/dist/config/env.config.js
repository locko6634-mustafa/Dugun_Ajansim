// .env dosyasını okumak için dotenv kütüphanesini içe aktar
import dotenv from 'dotenv';
import { isIP } from 'node:net';
// Dosya yollarını birleştirmek ve çözümlemek için path modülünü içe aktar
import path from 'path';
// ESM ortamında dosya yolunu (URL -> path) çevirmek için fileURLToPath içe aktar
import { fileURLToPath } from 'url';
// Tip doğrulama ve şema oluşturma için Zod kütüphanesini içe aktar
import { z } from 'zod';
// Bulunduğumuz dosyanın tam yolunu ESM ile elde et
const __filename = fileURLToPath(import.meta.url);
// Bulunduğumuz klasörün yolunu elde et
const __dirname = path.dirname(__filename);
// Proje kökündeki .env dosyasını oku ve process.env içerisine yükle
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// PORT değişkeni için Zod şeması (Metin -> Sayı dönüşümü ve 1-65535 aralığı kontrolü)
const portSchema = z
    .string()
    .regex(/^\d+$/, 'PORT yalnızca rakamlardan oluşmalıdır')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535));
// CORS_ORIGIN değişkeni için Zod şeması (Virgülle ayrılmış URI adreslerini diziye çevirir ve URL formatını doğrular)
const corsOriginSchema = z
    .string()
    .min(1, 'CORS_ORIGIN zorunludur')
    .transform((value) => value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean))
    .pipe(z
    .array(z
    .string()
    .url('Geçersiz CORS origin adresi')
    .refine((origin) => {
    const url = new URL(origin);
    return (['http:', 'https:'].includes(url.protocol) && url.origin === origin.replace(/\/$/, ''));
}, 'CORS origin yalnızca protokol, alan adı ve port içermelidir')
    .transform((origin) => new URL(origin).origin))
    .min(1, 'En az bir CORS origin adresi tanımlanmalıdır'));
// DATABASE_URL değişkeni için PostgreSQL adres şeması
const databaseUrlSchema = z
    .string()
    .url('DATABASE_URL geçerli bir URL olmalıdır')
    .refine((value) => ['postgresql:', 'postgres:'].includes(new URL(value).protocol), {
    message: 'DATABASE_URL PostgreSQL bağlantısı olmalıdır',
});
// Production modunda veritabanı parolasının minimum uzunluk sınırı (20 karakter)
const MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH = 20;
const KNOWN_PRODUCTION_EXAMPLE_DATABASE_PASSWORD = 'Degistir-Guclu-Production-Parolasi-2026';
// URL encode edilmiş kullanıcı adı/parolayı çözen yardımcı fonksiyon
const decodeDatabaseCredential = (credential) => {
    try {
        return decodeURIComponent(credential);
    }
    catch {
        return undefined;
    }
};
// Belirli sınırlar içindeki tam sayı değişkenleri için genel Zod şema üreticisi
const boundedIntegerSchema = (name, minimum, maximum) => z
    .string()
    .regex(/^\d+$/, `${name} yalnızca rakamlardan oluşmalıdır`)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
const trustProxySchema = z.string().transform((rawValue, context) => {
    const value = rawValue.trim();
    if (/^\d+$/.test(value)) {
        const hops = Number(value);
        if (Number.isInteger(hops) && hops >= 0 && hops <= 10)
            return hops;
    }
    else {
        const addresses = value
            .split(',')
            .map((address) => address.trim())
            .filter(Boolean);
        if (addresses.length > 0 && addresses.every((address) => isIP(address) !== 0)) {
            return addresses;
        }
    }
    context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TRUST_PROXY 0-10 hop sayısı veya virgülle ayrılmış kesin IP adresleri olmalıdır',
    });
    return z.NEVER;
});
const booleanStringSchema = (name) => z
    .enum(['true', 'false'], {
    errorMap: () => ({ message: `${name} true veya false olmalıdır` }),
})
    .transform((value) => value === 'true');
const DEVELOPMENT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CSRF_COOKIE_NAME = 'dugunajansim_csrf';
const isKnownExampleOrWeakEncryptionKey = (value) => value === DEVELOPMENT_ENCRYPTION_KEY ||
    /^([a-f0-9])\1{63}$/i.test(value) ||
    value.slice(0, 32) === value.slice(32);
// Ortam değişkenlerinin tamamını denetleyen ana Zod şeması
const envSchema = z
    .object({
    PORT: portSchema.default('5000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: corsOriginSchema,
    DATABASE_URL: databaseUrlSchema,
    ALLOW_PRIVATE_DATABASE_WITHOUT_TLS: booleanStringSchema('ALLOW_PRIVATE_DATABASE_WITHOUT_TLS').default('false'),
    TRUST_PROXY: trustProxySchema.default('0'),
    HEALTHCHECK_TIMEOUT_MS: boundedIntegerSchema('HEALTHCHECK_TIMEOUT_MS', 250, 10_000).default('3000'),
    DATA_ENCRYPTION_KEY: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/, 'DATA_ENCRYPTION_KEY 32 baytlık hex değer olmalıdır')
        .default(DEVELOPMENT_ENCRYPTION_KEY),
    SESSION_COOKIE_NAME: z
        .string()
        .regex(/^[A-Za-z0-9_-]+$/)
        .default('dugunajansim_session'),
    SESSION_TTL_HOURS: boundedIntegerSchema('SESSION_TTL_HOURS', 1, 720).default('12'),
    REMEMBER_SESSION_TTL_DAYS: boundedIntegerSchema('REMEMBER_SESSION_TTL_DAYS', 1, 90).default('30'),
    ADMIN_SESSION_IDLE_MINUTES: boundedIntegerSchema('ADMIN_SESSION_IDLE_MINUTES', 5, 240).default('30'),
    CUSTOMER_SESSION_IDLE_HOURS: boundedIntegerSchema('CUSTOMER_SESSION_IDLE_HOURS', 1, 168).default('12'),
    TEMPORARY_PASSWORD_TTL_HOURS: boundedIntegerSchema('TEMPORARY_PASSWORD_TTL_HOURS', 1, 168).default('72'),
})
    // Production moduna özel ek güvenlik ve SSL kontrollerini gerçekleştiren geliştirilmiş doğrulama (superRefine)
    .superRefine((environment, context) => {
    if (environment.SESSION_COOKIE_NAME === CSRF_COOKIE_NAME) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['SESSION_COOKIE_NAME'],
            message: 'SESSION_COOKIE_NAME CSRF cookie adıyla aynı olamaz',
        });
    }
    // Eğer ortam production değilse ekstra parola/SSL kontrollerini atla
    if (environment.NODE_ENV !== 'production') {
        return;
    }
    if (typeof environment.TRUST_PROXY === 'number') {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['TRUST_PROXY'],
            message: 'Production ortamında sayısal proxy hop güveni yerine kesin reverse proxy IP allowlist kullanılmalıdır',
        });
    }
    const databaseUrl = new URL(environment.DATABASE_URL);
    const sslModes = databaseUrl.searchParams.getAll('sslmode');
    const sslAcceptValues = databaseUrl.searchParams.getAll('sslaccept');
    const sslMode = sslModes[0];
    const sslAccept = sslAcceptValues[0];
    const databaseHostname = databaseUrl.hostname.toLowerCase();
    const password = decodeDatabaseCredential(databaseUrl.password);
    const username = decodeDatabaseCredential(databaseUrl.username);
    // Kullanıcı adı veya parola decode edilemiyorsa hata ver
    if (password === undefined || username === undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: 'Production DATABASE_URL kullanıcı adı veya parola encoding değeri geçersiz',
        });
        return;
    }
    const normalizedPassword = password.toLowerCase();
    // Zayıf/yaygın parolalar kümesi
    const weakPasswords = new Set([
        'postgres',
        'password',
        'admin',
        'root',
        '123456',
        'changeme',
        'example',
    ]);
    // Parolanın kaç farklı karakter sınıfı (büyük harf, küçük harf, rakam, sembol) içerdiğini hesapla
    const passwordCharacterClassCount = [
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password),
    ].filter(Boolean).length;
    const usesStrictTls = sslModes.length === 1 &&
        sslAcceptValues.length === 1 &&
        sslMode?.toLowerCase() === 'require' &&
        sslAccept?.toLowerCase() === 'strict';
    const usesExplicitPrivateNetwork = environment.ALLOW_PRIVATE_DATABASE_WITHOUT_TLS &&
        databaseHostname === 'postgres' &&
        sslModes.length === 1 &&
        sslMode?.toLowerCase() === 'disable' &&
        sslAcceptValues.length === 0;
    // Harici production veritabanlarında TLS zorunludur. Yalnızca izole Docker ağındaki
    // "postgres" servisi, açık ortam onayıyla TLS olmadan kullanılabilir.
    if (!usesStrictTls && !usesExplicitPrivateNetwork) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: 'Production DATABASE_URL sslmode=require ve sslaccept=strict içermeli veya yalnızca özel postgres Docker servisi için açık TLS istisnası kullanılmalıdır',
        });
    }
    // Production veritabanı parolasının gücünü denetle (uzunluk, karmaşıklık, zayıf kelime kontrolü)
    if (password.length < MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH ||
        passwordCharacterClassCount < 3 ||
        weakPasswords.has(normalizedPassword) ||
        normalizedPassword === username.toLowerCase() ||
        password === KNOWN_PRODUCTION_EXAMPLE_DATABASE_PASSWORD) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATABASE_URL'],
            message: `Production DATABASE_URL en az ${MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH} karakterlik güçlü bir veritabanı parolası içermelidir`,
        });
    }
    if (isKnownExampleOrWeakEncryptionKey(environment.DATA_ENCRYPTION_KEY)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATA_ENCRYPTION_KEY'],
            message: 'Production ortamında örneklerden farklı, kriptografik olarak rastgele DATA_ENCRYPTION_KEY zorunludur',
        });
    }
});
// Dışarıdan verilen herhangi bir ortam nesnesini doğrulamak için fonksiyon (Testler için)
export const parseEnvironment = (environment) => envSchema.parse(environment);
// Uygulama çalışırken process.env değişkenlerini ayrıştıran ve doğrulamayan iç fonksiyon
const parseEnv = () => {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error('❌ Ortam değişkenleri doğrulaması başarısız:');
        console.error(JSON.stringify(result.error.format(), null, 2));
        throw new Error('Geçersiz ortam değişkenleri');
    }
    return result.data;
};
// Uygulama genelinde kullanılacak olan doğrulanmış ve tiplendirilmiş env nesnesini dışa aktar
export const env = parseEnv();

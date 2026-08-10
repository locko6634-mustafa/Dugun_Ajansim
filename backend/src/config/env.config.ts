// .env dosyasını okumak için dotenv kütüphanesini içe aktar
import dotenv from 'dotenv';
import { isIP } from 'node:net';
// Dosya yollarını birleştirmek ve çözümlemek için path modülünü içe aktar
import path from 'path';
// ESM ortamında dosya yolunu (URL -> path) çevirmek için fileURLToPath içe aktar
import { fileURLToPath } from 'url';
// Tip doğrulama ve şema oluşturma için Zod kütüphanesini içe aktar
import { z } from 'zod';
import { loadFileBackedSecrets } from './fileSecrets.js';

// Bulunduğumuz dosyanın tam yolunu ESM ile elde et
const __filename = fileURLToPath(import.meta.url);
// Bulunduğumuz klasörün yolunu elde et
const __dirname = path.dirname(__filename);

// Proje kökündeki .env dosyasını oku ve process.env içerisine yükle
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
loadFileBackedSecrets();

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
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(
        z
          .string()
          .url('Geçersiz CORS origin adresi')
          .refine((origin) => {
            const url = new URL(origin);
            return (
              ['http:', 'https:'].includes(url.protocol) && url.origin === origin.replace(/\/$/, '')
            );
          }, 'CORS origin yalnızca protokol, alan adı ve port içermelidir')
          .transform((origin) => new URL(origin).origin),
      )
      .min(1, 'En az bir CORS origin adresi tanımlanmalıdır'),
  );

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
const decodeDatabaseCredential = (credential: string): string | undefined => {
  try {
    return decodeURIComponent(credential);
  } catch {
    return undefined;
  }
};

// Belirli sınırlar içindeki tam sayı değişkenleri için genel Zod şema üreticisi
const boundedIntegerSchema = (name: string, minimum: number, maximum: number) =>
  z
    .string()
    .regex(/^\d+$/, `${name} yalnızca rakamlardan oluşmalıdır`)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

const trustProxySchema = z.string().transform((rawValue, context): number | string[] => {
  const value = rawValue.trim();
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (Number.isInteger(hops) && hops >= 0 && hops <= 10) return hops;
  } else {
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

const booleanStringSchema = (name: string) =>
  z
    .enum(['true', 'false'], {
      errorMap: () => ({ message: `${name} true veya false olmalıdır` }),
    })
    .transform((value) => value === 'true');

const DEVELOPMENT_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DEVELOPMENT_PII_BLIND_INDEX_KEY =
  'f1e2d3c4b5a69788776655443322110089abcdef0123456776543210fedcba98';
const DEVELOPMENT_RATE_LIMIT_HMAC_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const DEFAULT_DATA_ENCRYPTION_KEYRING_JSON = JSON.stringify({
  legacy: DEVELOPMENT_ENCRYPTION_KEY,
});
const ENCRYPTION_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX_32_BYTE_PATTERN = /^[a-fA-F0-9]{64}$/;
const CSRF_COOKIE_NAME = 'dugunajansim_csrf';
const TEST_PAYMENT_BANK_NAME = 'TEST BANKASI';
const TEST_PAYMENT_ACCOUNT_HOLDER = 'Düğün Ajansım Test Hesabı';
const TEST_PAYMENT_IBAN = 'TR000000000000000000000000';
const TEST_PAYMENT_WHATSAPP_PHONE = '905555555555';

const isKnownExampleOrWeakEncryptionKey = (value: string): boolean =>
  value === DEVELOPMENT_ENCRYPTION_KEY ||
  value === DEVELOPMENT_PII_BLIND_INDEX_KEY ||
  /^([a-f0-9])\1{63}$/i.test(value) ||
  value.slice(0, 32) === value.slice(32);

export const parseDataEncryptionKeyring = (rawValue: string): Record<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error('DATA_ENCRYPTION_KEYRING_JSON geçerli JSON olmalıdır');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DATA_ENCRYPTION_KEYRING_JSON bir JSON nesnesi olmalıdır');
  }

  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > 16) {
    throw new Error('DATA_ENCRYPTION_KEYRING_JSON 1-16 anahtar içermelidir');
  }

  const keyring: Record<string, string> = Object.create(null) as Record<string, string>;
  const uniqueKeyMaterial = new Set<string>();
  for (const [keyId, rawKey] of entries) {
    if (!ENCRYPTION_KEY_ID_PATTERN.test(keyId) || typeof rawKey !== 'string') {
      throw new Error('DATA_ENCRYPTION_KEYRING_JSON key ID veya anahtar biçimi geçersiz');
    }
    const normalizedKey = rawKey.toLowerCase();
    if (!HEX_32_BYTE_PATTERN.test(normalizedKey) || uniqueKeyMaterial.has(normalizedKey)) {
      throw new Error('DATA_ENCRYPTION_KEYRING_JSON anahtarları benzersiz 32 bayt hex olmalıdır');
    }
    uniqueKeyMaterial.add(normalizedKey);
    keyring[keyId] = normalizedKey;
  }
  return keyring;
};

// Ortam değişkenlerinin tamamını denetleyen ana Zod şeması
const envSchema = z
  .object({
    PORT: portSchema.default('5000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    APP_PROCESS_ROLE: z
      .enum(['api', 'admin-bootstrap', 'pii-maintenance', 'data-retention'])
      .default('api'),
    CORS_ORIGIN: corsOriginSchema,
    BOT_PROTECTION_MODE: z.enum(['disabled', 'turnstile']).default('disabled'),
    TURNSTILE_SITE_KEY: z.string().trim().max(256).default(''),
    TURNSTILE_SECRET_KEY: z.string().trim().max(256).default(''),
    TURNSTILE_EXPECTED_HOSTNAME: z.string().trim().toLowerCase().max(253).default(''),
    TURNSTILE_VERIFY_TIMEOUT_MS: boundedIntegerSchema(
      'TURNSTILE_VERIFY_TIMEOUT_MS',
      500,
      10_000,
    ).default('5000'),
    DATABASE_URL: databaseUrlSchema,
    ALLOW_PRIVATE_DATABASE_WITHOUT_TLS: booleanStringSchema(
      'ALLOW_PRIVATE_DATABASE_WITHOUT_TLS',
    ).default('false'),
    TRUST_PROXY: trustProxySchema.default('0'),
    HEALTHCHECK_TIMEOUT_MS: boundedIntegerSchema('HEALTHCHECK_TIMEOUT_MS', 250, 10_000).default(
      '3000',
    ),
    HTTP_REQUEST_TIMEOUT_MS: boundedIntegerSchema(
      'HTTP_REQUEST_TIMEOUT_MS',
      1_000,
      120_000,
    ).default('15000'),
    HTTP_HEADERS_TIMEOUT_MS: boundedIntegerSchema(
      'HTTP_HEADERS_TIMEOUT_MS',
      1_000,
      60_000,
    ).default('10000'),
    HTTP_KEEP_ALIVE_TIMEOUT_MS: boundedIntegerSchema(
      'HTTP_KEEP_ALIVE_TIMEOUT_MS',
      1_000,
      30_000,
    ).default('5000'),
    DATA_ENCRYPTION_KEY: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/, 'DATA_ENCRYPTION_KEY 32 baytlık hex değer olmalıdır')
      .default(DEVELOPMENT_ENCRYPTION_KEY),
    DATA_ENCRYPTION_ACTIVE_KEY_ID: z
      .string()
      .regex(ENCRYPTION_KEY_ID_PATTERN, 'DATA_ENCRYPTION_ACTIVE_KEY_ID biçimi geçersiz')
      .default('legacy'),
    DATA_ENCRYPTION_KEYRING_JSON: z
      .string()
      .superRefine((value, context) => {
        try {
          parseDataEncryptionKeyring(value);
        } catch (error) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : 'Encryption keyring geçersiz',
          });
        }
      })
      .default(DEFAULT_DATA_ENCRYPTION_KEYRING_JSON),
    PII_BLIND_INDEX_KEY: z
      .string()
      .regex(HEX_32_BYTE_PATTERN, 'PII_BLIND_INDEX_KEY 32 baytlık hex değer olmalıdır')
      .default(DEVELOPMENT_PII_BLIND_INDEX_KEY),
    RATE_LIMIT_HMAC_KEY: z
      .string()
      .regex(HEX_32_BYTE_PATTERN, 'RATE_LIMIT_HMAC_KEY 32 baytlık hex değer olmalıdır')
      .default(DEVELOPMENT_RATE_LIMIT_HMAC_KEY),
    PII_ENCRYPTION_MODE: z.enum(['dual', 'encrypted', 'strict']).default('encrypted'),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('dugunajansim_session'),
    SESSION_TTL_HOURS: boundedIntegerSchema('SESSION_TTL_HOURS', 1, 720).default('12'),
    ADMIN_SESSION_TTL_HOURS: boundedIntegerSchema('ADMIN_SESSION_TTL_HOURS', 1, 24).default('8'),
    REMEMBER_SESSION_TTL_DAYS: boundedIntegerSchema('REMEMBER_SESSION_TTL_DAYS', 1, 90).default(
      '30',
    ),
    ADMIN_SESSION_IDLE_MINUTES: boundedIntegerSchema('ADMIN_SESSION_IDLE_MINUTES', 5, 1440).default(
      '30',
    ),
    SALON_SESSION_IDLE_MINUTES: boundedIntegerSchema('SALON_SESSION_IDLE_MINUTES', 5, 1440).default(
      '60',
    ),
    CUSTOMER_SESSION_IDLE_HOURS: boundedIntegerSchema(
      'CUSTOMER_SESSION_IDLE_HOURS',
      1,
      168,
    ).default('12'),
    TEMPORARY_PASSWORD_TTL_HOURS: boundedIntegerSchema(
      'TEMPORARY_PASSWORD_TTL_HOURS',
      1,
      168,
    ).default('24'),
    PUBLIC_APPLICATION_RETENTION_DAYS: boundedIntegerSchema(
      'PUBLIC_APPLICATION_RETENTION_DAYS',
      30,
      3650,
    ).default('90'),
    ARCHIVED_APPLICATION_RETENTION_DAYS: boundedIntegerSchema(
      'ARCHIVED_APPLICATION_RETENTION_DAYS',
      30,
      3650,
    ).default('365'),
    ARCHIVED_WEDDING_RETENTION_DAYS: boundedIntegerSchema(
      'ARCHIVED_WEDDING_RETENTION_DAYS',
      365,
      3650,
    ).default('3650'),
    SECURITY_ARTIFACT_RETENTION_DAYS: boundedIntegerSchema(
      'SECURITY_ARTIFACT_RETENTION_DAYS',
      7,
      365,
    ).default('30'),
    DATA_RETENTION_BATCH_SIZE: boundedIntegerSchema(
      'DATA_RETENTION_BATCH_SIZE',
      10,
      500,
    ).default('100'),
    DATA_RETENTION_MAX_BATCHES: boundedIntegerSchema(
      'DATA_RETENTION_MAX_BATCHES',
      1,
      10_000,
    ).default('1000'),
    PAYMENT_MODE: z.enum(['test', 'live']).default('test'),
    PAYMENT_HANDOFF_TTL_MINUTES: boundedIntegerSchema(
      'PAYMENT_HANDOFF_TTL_MINUTES',
      5,
      1440,
    ).default('60'),
    PAYMENT_BANK_NAME: z.string().trim().min(2).max(120).default(TEST_PAYMENT_BANK_NAME),
    PAYMENT_ACCOUNT_HOLDER: z.string().trim().min(2).max(160).default(TEST_PAYMENT_ACCOUNT_HOLDER),
    PAYMENT_IBAN: z
      .string()
      .trim()
      .regex(/^TR(?:\s?\d){24}$/i, 'PAYMENT_IBAN Türkiye IBAN biçiminde olmalıdır')
      .transform((value) => value.replace(/\s+/g, '').toUpperCase())
      .default(TEST_PAYMENT_IBAN),
    PAYMENT_WHATSAPP_PHONE: z
      .string()
      .trim()
      .regex(/^\+?[\d\s()\-]+$/, 'PAYMENT_WHATSAPP_PHONE telefon biçiminde olmalıdır')
      .transform((value) => value.replace(/\D/g, ''))
      .refine(
        (value) => /^[1-9]\d{9,14}$/.test(value),
        'PAYMENT_WHATSAPP_PHONE ülke kodlu telefon biçiminde olmalıdır',
      )
      .default(TEST_PAYMENT_WHATSAPP_PHONE),
  })
  // Production moduna özel ek güvenlik ve SSL kontrollerini gerçekleştiren geliştirilmiş doğrulama (superRefine)
  .superRefine((environment, context) => {
    if (environment.HTTP_HEADERS_TIMEOUT_MS > environment.HTTP_REQUEST_TIMEOUT_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HTTP_HEADERS_TIMEOUT_MS'],
        message: 'HTTP_HEADERS_TIMEOUT_MS, HTTP_REQUEST_TIMEOUT_MS değerini aşamaz',
      });
    }

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

    if (environment.APP_PROCESS_ROLE === 'api' && environment.PII_ENCRYPTION_MODE !== 'strict') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PII_ENCRYPTION_MODE'],
        message: 'Production API yalnız PII_ENCRYPTION_MODE=strict ile başlatılabilir',
      });
    }

    if (environment.BOT_PROTECTION_MODE === 'turnstile' && !environment.TURNSTILE_SITE_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TURNSTILE_SITE_KEY'],
        message: 'Turnstile modunda TURNSTILE_SITE_KEY zorunludur',
      });
    }
    if (environment.BOT_PROTECTION_MODE === 'turnstile' && !environment.TURNSTILE_SECRET_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'Turnstile modunda TURNSTILE_SECRET_KEY zorunludur',
      });
    }
    if (
      environment.BOT_PROTECTION_MODE === 'turnstile' &&
      (!environment.TURNSTILE_EXPECTED_HOSTNAME ||
        !environment.CORS_ORIGIN.some(
          (origin) =>
            new URL(origin).hostname.toLowerCase() === environment.TURNSTILE_EXPECTED_HOSTNAME,
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TURNSTILE_EXPECTED_HOSTNAME'],
        message: 'Turnstile hostname izin verilen CORS alan adlarından biri olmalıdır',
      });
    }

    if (typeof environment.TRUST_PROXY === 'number') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUST_PROXY'],
        message:
          'Production ortamında sayısal proxy hop güveni yerine kesin reverse proxy IP allowlist kullanılmalıdır',
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

    const usesStrictTls =
      sslModes.length === 1 &&
      sslAcceptValues.length === 1 &&
      sslMode?.toLowerCase() === 'require' &&
      sslAccept?.toLowerCase() === 'strict';
    const usesExplicitPrivateNetwork =
      environment.ALLOW_PRIVATE_DATABASE_WITHOUT_TLS &&
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
        message:
          'Production DATABASE_URL sslmode=require ve sslaccept=strict içermeli veya yalnızca özel postgres Docker servisi için açık TLS istisnası kullanılmalıdır',
      });
    }

    // Production veritabanı parolasının gücünü denetle (uzunluk, karmaşıklık, zayıf kelime kontrolü)
    if (
      password.length < MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH ||
      passwordCharacterClassCount < 3 ||
      weakPasswords.has(normalizedPassword) ||
      normalizedPassword === username.toLowerCase() ||
      password === KNOWN_PRODUCTION_EXAMPLE_DATABASE_PASSWORD
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: `Production DATABASE_URL en az ${MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH} karakterlik güçlü bir veritabanı parolası içermelidir`,
      });
    }

    const requiresApplicationEncryptionKey = environment.APP_PROCESS_ROLE === 'api';
    if (
      requiresApplicationEncryptionKey &&
      isKnownExampleOrWeakEncryptionKey(environment.DATA_ENCRYPTION_KEY)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATA_ENCRYPTION_KEY'],
        message:
          'Production ortamında örneklerden farklı, kriptografik olarak rastgele DATA_ENCRYPTION_KEY zorunludur',
      });
    }

    let keyring: Record<string, string> | undefined;
    try {
      keyring = parseDataEncryptionKeyring(environment.DATA_ENCRYPTION_KEYRING_JSON);
    } catch {
      // Alan doğrulaması ayrıntılı hatayı zaten üretir.
    }
    const requiresPiiKeys = ['api', 'pii-maintenance'].includes(environment.APP_PROCESS_ROLE);
    if (requiresPiiKeys && (!keyring || !keyring[environment.DATA_ENCRYPTION_ACTIVE_KEY_ID])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATA_ENCRYPTION_ACTIVE_KEY_ID'],
        message: 'Aktif encryption key ID keyring içinde bulunmalıdır',
      });
    }
    if (
      requiresPiiKeys &&
      keyring &&
      (Object.values(keyring).some(isKnownExampleOrWeakEncryptionKey) ||
        isKnownExampleOrWeakEncryptionKey(environment.PII_BLIND_INDEX_KEY))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATA_ENCRYPTION_KEYRING_JSON'],
        message: 'Production PII anahtarları örneklerden farklı ve kriptografik rastgele olmalıdır',
      });
    }
    if (
      requiresPiiKeys &&
      keyring &&
      Object.values(keyring).some(
        (encryptionKey) => encryptionKey === environment.PII_BLIND_INDEX_KEY.toLowerCase(),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PII_BLIND_INDEX_KEY'],
        message: 'PII blind-index anahtarı encryption keyring anahtarlarından ayrı olmalıdır',
      });
    }
    if (
      environment.APP_PROCESS_ROLE === 'api' &&
      (environment.RATE_LIMIT_HMAC_KEY === DEVELOPMENT_RATE_LIMIT_HMAC_KEY ||
        environment.RATE_LIMIT_HMAC_KEY.toLowerCase() ===
          environment.PII_BLIND_INDEX_KEY.toLowerCase() ||
        Object.values(keyring ?? {}).some(
          (encryptionKey) => encryptionKey === environment.RATE_LIMIT_HMAC_KEY.toLowerCase(),
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RATE_LIMIT_HMAC_KEY'],
        message: 'Production rate-limit HMAC anahtarı benzersiz ve rastgele olmalıdır',
      });
    }

    if (environment.APP_PROCESS_ROLE === 'api' && environment.PAYMENT_MODE === 'live') {
      const testValues = [
        environment.PAYMENT_BANK_NAME === TEST_PAYMENT_BANK_NAME,
        environment.PAYMENT_ACCOUNT_HOLDER === TEST_PAYMENT_ACCOUNT_HOLDER,
        environment.PAYMENT_IBAN === TEST_PAYMENT_IBAN,
        environment.PAYMENT_WHATSAPP_PHONE === TEST_PAYMENT_WHATSAPP_PHONE,
      ];
      if (testValues.some(Boolean)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENT_MODE'],
          message:
            'PAYMENT_MODE=live için gerçek banka, hesap sahibi, IBAN ve WhatsApp bilgileri zorunludur',
        });
      }
    }
  });

// Dışarıdan verilen herhangi bir ortam nesnesini doğrulamak için fonksiyon (Testler için)
export const parseEnvironment = (environment: NodeJS.ProcessEnv) => envSchema.parse(environment);

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

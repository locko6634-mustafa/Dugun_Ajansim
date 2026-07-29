// .env dosyasını okumak için dotenv kütüphanesini içe aktar
import dotenv from 'dotenv';
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

// DATABASE_URL değişkeni için PostgreSQL adres şeması
const databaseUrlSchema = z
  .string()
  .url('DATABASE_URL geçerli bir URL olmalıdır')
  .refine((value) => ['postgresql:', 'postgres:'].includes(new URL(value).protocol), {
    message: 'DATABASE_URL PostgreSQL bağlantısı olmalıdır',
  });

// Production modunda veritabanı parolasının minimum uzunluk sınırı (20 karakter)
const MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH = 20;

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

// Ortam değişkenlerinin tamamını denetleyen ana Zod şeması
const envSchema = z
  .object({
    PORT: portSchema.default('5000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: corsOriginSchema,
    DATABASE_URL: databaseUrlSchema,
    TRUST_PROXY: boundedIntegerSchema('TRUST_PROXY', 0, 10).default('0'),
    HEALTHCHECK_TIMEOUT_MS: boundedIntegerSchema('HEALTHCHECK_TIMEOUT_MS', 250, 10_000).default('3000'),
  })
  // Production moduna özel ek güvenlik ve SSL kontrollerini gerçekleştiren geliştirilmiş doğrulama (superRefine)
  .superRefine((environment, context) => {
    // Eğer ortam production değilse ekstra parola/SSL kontrollerini atla
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
    const weakPasswords = new Set(['postgres', 'password', 'admin', 'root', '123456', 'changeme', 'example']);
    // Parolanın kaç farklı karakter sınıfı (büyük harf, küçük harf, rakam, sembol) içerdiğini hesapla
    const passwordCharacterClassCount = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /\d/.test(password),
      /[^A-Za-z0-9]/.test(password),
    ].filter(Boolean).length;

    // Production veritabanı bağlantısında sslmode=require ve sslaccept=strict kontrolü yap
    if (
      sslModes.length !== 1 ||
      sslAcceptValues.length !== 1 ||
      sslMode?.toLowerCase() !== 'require' ||
      sslAccept?.toLowerCase() !== 'strict'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Production DATABASE_URL sslmode=require ve sslaccept=strict içermelidir',
      });
    }

    // Production veritabanı parolasının gücünü denetle (uzunluk, karmaşıklık, zayıf kelime kontrolü)
    if (
      password.length < MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH ||
      passwordCharacterClassCount < 3 ||
      weakPasswords.has(normalizedPassword) ||
      normalizedPassword === username.toLowerCase()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: `Production DATABASE_URL en az ${MIN_PRODUCTION_DATABASE_PASSWORD_LENGTH} karakterlik güçlü bir veritabanı parolası içermelidir`,
      });
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


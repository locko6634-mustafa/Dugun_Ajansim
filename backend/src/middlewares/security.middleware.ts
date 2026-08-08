// HTTP güvenlik başlıklarını ayarlamak için Helmet kütüphanesini içe aktar
import helmet from 'helmet';
// Siteler arası kaynak paylaşımını (CORS) yönetmek için CORS kütüphanesini içe aktar
import cors from 'cors';
// IP başına yapılan istek sayısını sınırlamak (Rate Limiting) için kütüphaneyi içe aktar
import rateLimit from 'express-rate-limit';
// Express uygulama türünü içe aktar
import type { Express } from 'express';
// Ortam değişkenlerimizi içe aktar
import { env } from '../config/env.config.js';
// Özel uygulama hatası sınıfımızı içe aktar
import { AppError } from '../utils/appError.js';
import { createRateLimitHandler, rateLimitKeyGenerator } from './rateLimit.middleware.js';

// İsteğin geldiği Origin adresinin izin verilen liste (whitelist) içerisinde olup olmadığını denetleyen fonksiyon
export const validateCorsOrigin = (
  allowedOrigins: readonly string[],
  origin: string | undefined,
  callback: (error: Error | null, allowed?: boolean) => void,
): void => {
  // Eğer Origin yoksa (ör. sunucudan sunucuya istek) veya izin verilen listede varsa geçişe izin ver
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  // İzin verilmeyen Origin durumunda operasyonel 403 Forbidden hatası fırlat
  callback(new AppError('CORS politikası bu origin için erişime izin vermiyor.', 403));
};

// Express uygulamasına güvenlik middleware'lerini (Helmet, Rate Limiter, CORS) sırasıyla bağlayan fonksiyon
export const configureSecurityMiddleware = (app: Express): void => {
  // 1. Helmet Güvenlik Başlıkları (X-Content-Type-Options, X-Frame-Options vb.)
  app.use(
    helmet({
      // Production ortamında varsayılan CSP politikasını kullan, development ortamında serbest bırak
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      // Cross-Origin Embedder Policy başlığını pasif yap (görsel/kaynak yükleme uyumu için)
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 2. CORS (Cross-Origin Resource Sharing) Yapılandırması
  const allowedOrigins = env.CORS_ORIGIN;
  app.use(
    cors({
      // Origin doğrulamasını özel fonksiyonumuz ile gerçekleştir
      origin: (origin, callback) => {
        validateCorsOrigin(allowedOrigins, origin, callback);
      },
      // İzin verilen HTTP metotları
      methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
      // İzin verilen HTTP istek başlıkları
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-CSRF-Token',
        'Idempotency-Key',
        'Payment-Flow-Key',
        'X-Correlation-ID',
      ],
      exposedHeaders: ['X-Correlation-ID', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      // Çerezlerin (Cookies) ve yetki başlıklarının gönderilmesine izin ver
      credentials: true,
    }),
  );

  // Origin taşımayan çapraz-site tarayıcı isteklerini kota sayacına ulaşmadan reddet.
  app.use('/api', (req, _res, next) => {
    const origin = req.get('Origin');
    const fetchSite = req.get('Sec-Fetch-Site')?.toLowerCase();

    if (!origin && fetchSite === 'cross-site') {
      next(new AppError('Çapraz kaynaklı isteğe izin verilmiyor.', 403));
      return;
    }

    next();
  });

  // 3. Rate Limiting (Aşırı İstek Sınırlama)
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // İstek penceresi: 15 Dakika (milisaniye cinsinden)
    max: 100, // Belirtilen sürede tek bir IP adresinden yapılabilecek maksimum istek sayısı (100)
    standardHeaders: true, // `RateLimit-*` standart HTTP başlıklarını yanıta ekle
    legacyHeaders: false, // Eskimiş `X-RateLimit-*` başlıklarını devre dışı bırak
    keyGenerator: rateLimitKeyGenerator,
    handler: createRateLimitHandler(
      'Çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyin.',
    ),
  });

  // Rate Limiter'ı yalnızca /api altındaki rotalar için aktif et
  app.use('/api', globalLimiter);
};

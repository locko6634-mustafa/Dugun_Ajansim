// HTTP güvenlik başlıklarını ayarlamak için Helmet kütüphanesini içe aktar
import helmet from 'helmet';
// Siteler arası kaynak paylaşımını (CORS) yönetmek için CORS kütüphanesini içe aktar
import cors from 'cors';
// IP başına yapılan istek sayısını sınırlamak (Rate Limiting) için kütüphaneyi içe aktar
import rateLimit from 'express-rate-limit';
// Ortam değişkenlerimizi içe aktar
import { env } from '../config/env.config.js';
// Özel uygulama hatası sınıfımızı içe aktar
import { AppError } from '../utils/appError.js';
// İsteğin geldiği Origin adresinin izin verilen liste (whitelist) içerisinde olup olmadığını denetleyen fonksiyon
export const validateCorsOrigin = (allowedOrigins, origin, callback) => {
    // Eğer Origin yoksa (ör. sunucudan sunucuya istek) veya izin verilen listede varsa geçişe izin ver
    if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
    }
    // İzin verilmeyen Origin durumunda operasyonel 403 Forbidden hatası fırlat
    callback(new AppError('CORS politikası bu origin için erişime izin vermiyor.', 403));
};
// Express uygulamasına güvenlik middleware'lerini (Helmet, Rate Limiter, CORS) sırasıyla bağlayan fonksiyon
export const configureSecurityMiddleware = (app) => {
    // 1. Helmet Güvenlik Başlıkları (X-Content-Type-Options, X-Frame-Options vb.)
    app.use(helmet({
        // Production ortamında varsayılan CSP politikasını kullan, development ortamında serbest bırak
        contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
        // Cross-Origin Embedder Policy başlığını pasif yap (görsel/kaynak yükleme uyumu için)
        crossOriginEmbedderPolicy: false,
    }));
    // 2. Rate Limiting (Aşırı İstek Sınırlama)
    const globalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // İstek penceresi: 15 Dakika (milisaniye cinsinden)
        max: 100, // Belirtilen sürede tek bir IP adresinden yapılabilecek maksimum istek sayısı (100)
        standardHeaders: true, // `RateLimit-*` standart HTTP başlıklarını yanıta ekle
        legacyHeaders: false, // Eskimiş `X-RateLimit-*` başlıklarını devre dışı bırak
        message: {
            success: false,
            message: 'Çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyin.',
        },
    });
    // Rate Limiter'ı yalnızca /api altındaki rotalar için aktif et
    app.use('/api', globalLimiter);
    // 3. CORS (Cross-Origin Resource Sharing) Yapılandırması
    const allowedOrigins = env.CORS_ORIGIN;
    app.use(cors({
        // Origin doğrulamasını özel fonksiyonumuz ile gerçekleştir
        origin: (origin, callback) => {
            validateCorsOrigin(allowedOrigins, origin, callback);
        },
        // İzin verilen HTTP metotları
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        // İzin verilen HTTP istek başlıkları
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        // Çerezlerin (Cookies) ve yetki başlıklarının gönderilmesine izin ver
        credentials: true,
    }));
};

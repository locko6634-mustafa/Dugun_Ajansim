// Express çatısını ve türünü içe aktar
import express from 'express';
// HTTP Parameter Pollution koruması için hpp kütüphanesini içe aktar
import hpp from 'hpp';
// Ortam değişkenleri nesnemizi içe aktar
import { env } from './config/env.config.js';
// Güvenlik middleware yapılandırıcısını içe aktar
import { configureSecurityMiddleware } from './middlewares/security.middleware.js';
// Global hata yakalama middleware'ini içe aktar
import { globalErrorHandler } from './middlewares/error.middleware.js';
// Sağlık kontrolü rota modülünü içe aktar
import healthRoutes from './routes/health.routes.js';
// Özel hata sınıfımızı içe aktar
import { AppError } from './utils/appError.js';
// Varsayılan API rotalarını uygulamaya bağlayan fonksiyon
const registerApplicationRoutes = (application) => {
    // /api/v1/health yoluna gelen istekleri healthRoutes modülüne ilet
    application.use('/api/v1/health', healthRoutes);
};
// Express uygulamasını oluşturan ve tüm middleware/rotaları bağlayan ana fabrika fonksiyonu
export const createApp = (registerRoutes = registerApplicationRoutes) => {
    // Yeni bir Express uygulaması örneği oluştur
    const application = express();
    // Yalnızca konfigürasyondaki güvenilir reverse proxy katman sayısını kabul et (0 = doğrudan bağlantı)
    application.set('trust proxy', env.TRUST_PROXY);
    // Güvenlik Katmanı Middleware'lerini (Helmet, Rate Limiter, CORS) bağla
    configureSecurityMiddleware(application);
    // Gelen JSON istek gövdelerini ayrıştır (Maximum 10 kilobayt sınırıyla)
    application.use(express.json({ limit: '10kb' }));
    // URL ile kodlanmış form verilerini ayrıştır (Maximum 10 kilobayt sınırıyla)
    application.use(express.urlencoded({ extended: true, limit: '10kb' }));
    // HTTP Parameter Pollution (HPP) korumasını gövde ayrıştırma sonrasında aktif et
    application.use(hpp());
    // Uygulama API Rotalarını kaydet
    registerRoutes(application);
    // Tanımsız tüm HTTP adresleri (404) için özel yakalayıcı middleware
    application.use('*', (req, _res, next) => {
        next(new AppError(`Aradığınız ${req.path} adresi bu sunucuda bulunamadı.`, 404));
    });
    // Uygulama genelindeki en son halka olan Global Hata Yakalama Middleware'ini ekle
    application.use(globalErrorHandler);
    // Yapılandırılmış Express uygulamasını döndür
    return application;
};
// Varsayılan yapılandırılmış Express uygulamasını dışa aktar
export default createApp();

import express from 'express';
import hpp from 'hpp';
import { env } from './config/env.config.js';
import { configureSecurityMiddleware } from './middlewares/security.middleware.js';
import { globalErrorHandler } from './middlewares/error.middleware.js';
import healthRoutes from './routes/health.routes.js';
import { AppError } from './utils/appError.js';
const registerApplicationRoutes = (application) => {
    application.use('/api/v1/health', healthRoutes);
};
export const createApp = (registerRoutes = registerApplicationRoutes) => {
    const application = express();
    // Yalnızca bilinen reverse proxy hop sayısını güvenilir kabul et (0 = doğrudan bağlantı).
    application.set('trust proxy', env.TRUST_PROXY);
    // Güvenlik Katmanı Middleware'leri (Helmet, CORS, Rate Limit)
    configureSecurityMiddleware(application);
    // Body Parser Middleware
    application.use(express.json({ limit: '10kb' }));
    application.use(express.urlencoded({ extended: true, limit: '10kb' }));
    // HTTP Parameter Pollution Protection (Body Parser Sonrası)
    application.use(hpp());
    // API Rotaları
    registerRoutes(application);
    // Tanımsız Rota Yakalayıcı (404)
    application.use('*', (req, _res, next) => {
        next(new AppError(`Aradığınız ${req.path} adresi bu sunucuda bulunamadı.`, 404));
    });
    // Global Hata Yakalama Middleware
    application.use(globalErrorHandler);
    return application;
};
export default createApp();

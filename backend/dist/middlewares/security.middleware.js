import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.config.js';
export const configureSecurityMiddleware = (app) => {
    // 1. Helmet Security Headers
    app.use(helmet({
        contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
        crossOriginEmbedderPolicy: false,
    }));
    // 2. CORS Yapılandırması
    const allowedOrigins = env.CORS_ORIGIN;
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            }
            else {
                callback(new Error(`CORS politikası engelledi: ${origin}`));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: true,
    }));
    // 3. Rate Limiting (Genel İstek Sınırlayıcı)
    const globalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 Dakika
        max: 100, // IP başına maks 100 istek
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message: 'Çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyin.',
        },
    });
    app.use('/api', globalLimiter);
};

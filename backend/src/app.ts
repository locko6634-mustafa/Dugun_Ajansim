import express, { Express } from 'express';
import hpp from 'hpp';
import { env } from './config/env.config.js';
import { configureSecurityMiddleware } from './middlewares/security.middleware.js';
import { globalErrorHandler } from './middlewares/error.middleware.js';
import healthRoutes from './routes/health.routes.js';
import { AppError } from './utils/appError.js';

const app: Express = express();

// Yalnızca bilinen reverse proxy hop sayısını güvenilir kabul et (0 = doğrudan bağlantı).
app.set('trust proxy', env.TRUST_PROXY);

// Güvenlik Katmanı Middleware'leri (Helmet, CORS, Rate Limit)
configureSecurityMiddleware(app);

// Body Parser Middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// HTTP Parameter Pollution Protection (Body Parser Sonrası)
app.use(hpp());

// API Rotaları
app.use('/api/v1/health', healthRoutes);

// Tanımsız Rota Yakalayıcı (404)
app.use('*', (req, _res, next) => {
  next(new AppError(`Aradığınız ${req.originalUrl} adresi bu sunucuda bulunamadı.`, 404));
});

// Global Hata Yakalama Middleware
app.use(globalErrorHandler);

export default app;

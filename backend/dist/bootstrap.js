import app from './app.js';
import { env } from './config/env.config.js';
import { prisma } from './config/prisma.js';
import { createGracefulShutdown } from './utils/processLifecycle.js';
const SHUTDOWN_TIMEOUT_MS = 10_000;
export const startServer = () => {
    const server = app.listen(env.PORT, () => {
        console.log(`🚀 Düğün Ajansım Backend Sunucusu Çalışıyor: http://localhost:${env.PORT}`);
        console.log(`🛡️ Ortam: ${env.NODE_ENV}`);
        console.log(`🏥 Healthcheck Endpoint: http://localhost:${env.PORT}/api/v1/health`);
    });
    const logShutdownError = (message, error) => {
        if (env.NODE_ENV === 'development' && error !== undefined) {
            console.error(message, error);
        }
        else {
            console.error(message);
        }
    };
    const closeHttpServer = () => new Promise((resolve, reject) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
    const gracefulShutdown = createGracefulShutdown({
        closeHttpServer,
        forceCloseHttpConnections: () => server.closeAllConnections(),
        disconnectDatabase: () => prisma.$disconnect(),
        logInfo: console.log,
        logError: logShutdownError,
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.on('unhandledRejection', (error) => {
        console.error('💥 UNHANDLED REJECTION! Sunucu kapatılıyor...');
        logShutdownError('❌ İşlenmeyen asenkron hata oluştu.', error);
        void gracefulShutdown('UNHANDLED_REJECTION', 1);
    });
    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', 0));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT', 0));
    return gracefulShutdown;
};

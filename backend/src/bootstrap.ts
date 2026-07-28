import app from './app.js';
import { env } from './config/env.config.js';
import { prisma } from './config/prisma.js';
import type { GracefulShutdown } from './utils/processLifecycle.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

export const startServer = (): GracefulShutdown => {
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 Düğün Ajansım Backend Sunucusu Çalışıyor: http://localhost:${env.PORT}`);
    console.log(`🛡️ Ortam: ${env.NODE_ENV}`);
    console.log(`🏥 Healthcheck Endpoint: http://localhost:${env.PORT}/api/v1/health`);
  });

  let isShuttingDown = false;

  const logShutdownError = (message: string, error: unknown): void => {
    if (env.NODE_ENV === 'development') {
      console.error(message, error);
    } else {
      console.error(message);
    }
  };

  const closeHttpServer = (): Promise<void> =>
    new Promise((resolve, reject) => {
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

  const gracefulShutdown = async (signal: string, exitCode: number): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`👋 ${signal} alındı. Sunucu kapatılıyor...`);

    const forceShutdownTimer = setTimeout(() => {
      console.error('💥 Güvenli kapanış zaman aşımına uğradı. Açık bağlantılar sonlandırılıyor.');
      server.closeAllConnections();

      const hardExitTimer = setTimeout(() => process.exit(1), 1_000);
      hardExitTimer.unref();

      void prisma
        .$disconnect()
        .catch((error: unknown) => logShutdownError('❌ Prisma bağlantısı zorla kapatılamadı.', error))
        .finally(() => {
          clearTimeout(hardExitTimer);
          process.exit(1);
        });
    }, SHUTDOWN_TIMEOUT_MS);
    forceShutdownTimer.unref();

    try {
      await closeHttpServer();
      await prisma.$disconnect();
      console.log('✅ Sunucu ve veritabanı bağlantıları güvenle kapatıldı.');
      process.exit(exitCode);
    } catch (error) {
      logShutdownError('❌ Güvenli kapanış sırasında hata oluştu.', error);

      try {
        await prisma.$disconnect();
      } catch (disconnectError) {
        logShutdownError('❌ Prisma bağlantısı kapatılamadı.', disconnectError);
      }

      process.exit(1);
    } finally {
      clearTimeout(forceShutdownTimer);
    }
  };

  process.on('unhandledRejection', (error: unknown) => {
    console.error('💥 UNHANDLED REJECTION! Sunucu kapatılıyor...');
    logShutdownError('❌ İşlenmeyen asenkron hata oluştu.', error);
    void gracefulShutdown('UNHANDLED_REJECTION', 1);
  });

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', 0));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT', 0));

  return gracefulShutdown;
};

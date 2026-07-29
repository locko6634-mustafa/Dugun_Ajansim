// Express uygulamamızı içe aktar
import app from './app.js';
// Ortam değişkenlerimizi içe aktar
import { env } from './config/env.config.js';
// Prisma veritabanı istemcimizi içe aktar
import { prisma } from './config/prisma.js';
// Graceful shutdown oluşturucusunu ve tipini içe aktar
import { createGracefulShutdown, type GracefulShutdown } from './utils/processLifecycle.js';

// Kapanış süreci için maksimum bekleme süresi (10 saniye)
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Sunucuyu başlatan ve sinyal dinleyicilerini kuran ana bootstrap fonksiyonu
export const startServer = (): GracefulShutdown => {
  // HTTP sunucusunu belirtilen PORT üzerinden dinlemeye başla
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 Düğün Ajansım Backend Sunucusu Çalışıyor: http://localhost:${env.PORT}`);
    console.log(`🛡️ Ortam: ${env.NODE_ENV}`);
    console.log(`🏥 Healthcheck Endpoint: http://localhost:${env.PORT}/api/v1/health`);
  });

  // Kapanış hatalarını ortama göre günlüğe kaydeden iç fonksiyon
  const logShutdownError = (message: string, error?: unknown): void => {
    if (env.NODE_ENV === 'development' && error !== undefined) {
      console.error(message, error);
    } else {
      console.error(message);
    }
  };

  // HTTP sunucusunu kapatan asenkron fonksiyon
  const closeHttpServer = (): Promise<void> =>
    new Promise((resolve, reject) => {
      // Sunucu halihazırda dinlemiyorsa doğrudan tamamla
      if (!server.listening) {
        resolve();
        return;
      }

      // Dinlemeyi durdur
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

  // Sunucu yaşam döngüsü güvenli kapanış mekanizmasını örnekle
  const gracefulShutdown = createGracefulShutdown({
    closeHttpServer,
    forceCloseHttpConnections: () => server.closeAllConnections(),
    disconnectDatabase: () => prisma.$disconnect(),
    logInfo: console.log,
    logError: logShutdownError,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
  });

  // İşlenmeyen asenkron Promise hatalarını (Unhandled Rejection) dinle ve güvenli kapanışı başlat
  process.on('unhandledRejection', (error: unknown) => {
    console.error('💥 UNHANDLED REJECTION! Sunucu kapatılıyor...');
    logShutdownError('❌ İşlenmeyen asenkron hata oluştu.', error);
    void gracefulShutdown('UNHANDLED_REJECTION', 1);
  });

  // İşletim sisteminden gelen SIGTERM (Sunucuyu Durdur) sinyalini dinle
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', 0));
  // İşletim sisteminden gelen SIGINT (Ctrl + C) sinyalini dinle
  process.on('SIGINT', () => void gracefulShutdown('SIGINT', 0));

  // Oluşturulan Graceful Shutdown kontrolcüsünü döndür
  return gracefulShutdown;
};


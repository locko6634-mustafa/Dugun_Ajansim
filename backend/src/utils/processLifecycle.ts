// Güvenli kapanış (Graceful Shutdown) fonksiyonunun tip tanımı
export type GracefulShutdown = (signal: string, exitCode: number) => Promise<void>;

// Ölümcül hata loglayıcı tipi
type FatalErrorLogger = (message: string, error: unknown) => void;
// Süreç çıkış fonksiyonu tipi
type ProcessExit = (code: number) => void;
// Kapanış loglayıcı tipi
type ShutdownLogger = (message: string, error?: unknown) => void;

// Graceful Shutdown seçeneği arayüzü (İlgili servislerin bağlantı kapatıcıları geçer)
interface GracefulShutdownOptions {
  closeHttpServer: () => Promise<void>;
  forceCloseHttpConnections: () => void;
  disconnectDatabase: () => Promise<void>;
  logInfo: (message: string) => void;
  logError: ShutdownLogger;
  timeoutMs: number;
  hardExitTimeoutMs?: number;
  exit?: ProcessExit;
}

// Uncaught Exception işleyici seçeneği arayüzü
interface UncaughtExceptionHandlerOptions {
  getGracefulShutdown: () => GracefulShutdown | undefined;
  logFatalError: FatalErrorLogger;
  exit?: ProcessExit;
}

// Güvenli kapanış fonksiyonunu üreten fabrika fonksiyonu
export const createGracefulShutdown = ({
  closeHttpServer,
  forceCloseHttpConnections,
  disconnectDatabase,
  logInfo,
  logError,
  timeoutMs,
  hardExitTimeoutMs = 1_000,
  exit = process.exit,
}: GracefulShutdownOptions): GracefulShutdown => {
  // Çoklu kapanış sinyallerinde tek bir kapanış işleminin yürütülmesini garanti eden Promise referansı
  let shutdownPromise: Promise<void> | undefined;

  return (signal: string, requestedExitCode: number): Promise<void> => {
    // Eğer kapanış süreci halihazırda başlamışsa mevcut Promise'i dön (Mükerrer işlemi engelle)
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = new Promise<void>((resolve) => {
      let forced = false;
      let exited = false;
      let disconnectPromise: Promise<void> | undefined;
      let hardExitTimer: NodeJS.Timeout | undefined;

      // Veritabanı bağlantısını tek bir defa kapatmayı garanti eden iç fonksiyon
      const disconnectOnce = (): Promise<void> => {
        disconnectPromise ??= disconnectDatabase();
        return disconnectPromise;
      };

      // Kapanış işlemini tamamlayan ve Node.js sürecini sonlandıran iç fonksiyon
      const finish = (exitCode: number): void => {
        if (exited) {
          return;
        }

        exited = true;
        clearTimeout(forceShutdownTimer);
        if (hardExitTimer) {
          clearTimeout(hardExitTimer);
        }
        exit(exitCode);
        resolve();
      };

      // Kapanış süresi zaman aşımına uğradığında devreye giren zorla kapatma fonksiyonu
      const forceShutdown = (): void => {
        forced = true;
        logError('💥 Güvenli kapanış zaman aşımına uğradı. Açık bağlantılar sonlandırılıyor.');

        try {
          // Açık HTTP socket bağlantılarını zorla kapat
          forceCloseHttpConnections();
        } catch (error) {
          logError('❌ Açık HTTP bağlantıları zorla kapatılamadı.', error);
        }

        // Sert çıkış zamanlayıcısını başlat
        hardExitTimer = setTimeout(() => finish(1), hardExitTimeoutMs);

        // Veritabanını son kez kapatmayı dene ve süreci hata koduyla (1) bitir
        void disconnectOnce()
          .catch((error: unknown) => {
            logError('❌ Prisma bağlantısı zorla kapatılamadı.', error);
          })
          .finally(() => finish(1));
      };

      // Zaman aşımı süresini başlatan zamanlayıcı
      const forceShutdownTimer = setTimeout(forceShutdown, timeoutMs);

      logInfo(`👋 ${signal} alındı. Sunucu kapatılıyor...`);

      // Asıl düzenli kapanış adımları
      void (async () => {
        try {
          // 1. Önce HTTP sunucusunu kapat (Yeni istek kabul etmeyi durdur)
          await closeHttpServer();
          if (forced) {
            return;
          }

          // 2. Ardından Veritabanı bağlantısını kapat
          await disconnectOnce();
          if (forced) {
            return;
          }

          logInfo('✅ Sunucu ve veritabanı bağlantıları güvenle kapatıldı.');
          // Başarılı istenen çıkış koduyla bitir
          finish(requestedExitCode);
        } catch (error) {
          if (forced) {
            return;
          }

          logError('❌ Güvenli kapanış sırasında hata oluştu.', error);

          try {
            await disconnectOnce();
          } catch (disconnectError) {
            logError('❌ Prisma bağlantısı kapatılamadı.', disconnectError);
          }

          // Hata durumunda çıkış kodu 1 ile bitir
          finish(1);
        }
      })();
    });

    return shutdownPromise;
  };
};

// Beklenmeyen yakalanmamış hataları (Uncaught Exceptions) ele alan işleyici üreteci
export const createUncaughtExceptionHandler = ({
  getGracefulShutdown,
  logFatalError,
  exit = process.exit,
}: UncaughtExceptionHandlerOptions) =>
  (error: unknown): void => {
    logFatalError('💥 UNCAUGHT EXCEPTION! Sunucu kapatılıyor...', error);

    const gracefulShutdown = getGracefulShutdown();

    // Eğer henüz Graceful Shutdown mekanizması kurulmamışsa doğrudan çık
    if (!gracefulShutdown) {
      exit(1);
      return;
    }

    // Güvenli kapanışı tetikle
    void gracefulShutdown('UNCAUGHT_EXCEPTION', 1);
  };


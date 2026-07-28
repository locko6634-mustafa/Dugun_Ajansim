export type GracefulShutdown = (signal: string, exitCode: number) => Promise<void>;

type FatalErrorLogger = (message: string, error: unknown) => void;
type ProcessExit = (code: number) => void;
type ShutdownLogger = (message: string, error?: unknown) => void;

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

interface UncaughtExceptionHandlerOptions {
  getGracefulShutdown: () => GracefulShutdown | undefined;
  logFatalError: FatalErrorLogger;
  exit?: ProcessExit;
}

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
  let shutdownPromise: Promise<void> | undefined;

  return (signal: string, requestedExitCode: number): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = new Promise<void>((resolve) => {
      let forced = false;
      let exited = false;
      let disconnectPromise: Promise<void> | undefined;
      let hardExitTimer: NodeJS.Timeout | undefined;

      const disconnectOnce = (): Promise<void> => {
        disconnectPromise ??= disconnectDatabase();
        return disconnectPromise;
      };

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

      const forceShutdown = (): void => {
        forced = true;
        logError('💥 Güvenli kapanış zaman aşımına uğradı. Açık bağlantılar sonlandırılıyor.');

        try {
          forceCloseHttpConnections();
        } catch (error) {
          logError('❌ Açık HTTP bağlantıları zorla kapatılamadı.', error);
        }

        hardExitTimer = setTimeout(() => finish(1), hardExitTimeoutMs);

        void disconnectOnce()
          .catch((error: unknown) => {
            logError('❌ Prisma bağlantısı zorla kapatılamadı.', error);
          })
          .finally(() => finish(1));
      };

      const forceShutdownTimer = setTimeout(forceShutdown, timeoutMs);

      logInfo(`👋 ${signal} alındı. Sunucu kapatılıyor...`);

      void (async () => {
        try {
          await closeHttpServer();
          if (forced) {
            return;
          }

          await disconnectOnce();
          if (forced) {
            return;
          }

          logInfo('✅ Sunucu ve veritabanı bağlantıları güvenle kapatıldı.');
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

          finish(1);
        }
      })();
    });

    return shutdownPromise;
  };
};

export const createUncaughtExceptionHandler = ({
  getGracefulShutdown,
  logFatalError,
  exit = process.exit,
}: UncaughtExceptionHandlerOptions) =>
  (error: unknown): void => {
    logFatalError('💥 UNCAUGHT EXCEPTION! Sunucu kapatılıyor...', error);

    const gracefulShutdown = getGracefulShutdown();

    if (!gracefulShutdown) {
      exit(1);
      return;
    }

    void gracefulShutdown('UNCAUGHT_EXCEPTION', 1);
  };

export type GracefulShutdown = (signal: string, exitCode: number) => Promise<void>;

type FatalErrorLogger = (message: string, error: unknown) => void;
type ProcessExit = (code: number) => never;

interface UncaughtExceptionHandlerOptions {
  getGracefulShutdown: () => GracefulShutdown | undefined;
  logFatalError: FatalErrorLogger;
  exit?: ProcessExit;
}

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

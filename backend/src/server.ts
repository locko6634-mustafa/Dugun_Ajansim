import { createUncaughtExceptionHandler } from './utils/processLifecycle.js';
import type { GracefulShutdown } from './utils/processLifecycle.js';

const logFatalError = (message: string, error: unknown): void => {
  console.error(message);

  if (process.env.NODE_ENV === 'development') {
    console.error(error);
  }
};

let gracefulShutdown: GracefulShutdown | undefined;

// Statik uygulama importlarından önce kurulur; başlangıç hatalarını da kapsar.
process.on(
  'uncaughtException',
  createUncaughtExceptionHandler({
    getGracefulShutdown: () => gracefulShutdown,
    logFatalError,
  })
);

const start = async (): Promise<void> => {
  try {
    const { startServer } = await import('./bootstrap.js');
    gracefulShutdown = startServer();
  } catch (error) {
    logFatalError('💥 STARTUP ERROR! Sunucu başlatılamadı.', error);
    process.exit(1);
  }
};

void start();

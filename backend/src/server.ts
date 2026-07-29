// Uncaught Exception yakalayıcı fonksiyon üreticisini içe aktar
import { createUncaughtExceptionHandler } from './utils/processLifecycle.js';
// GracefulShutdown tipini içe aktar
import type { GracefulShutdown } from './utils/processLifecycle.js';

// Ölümcül hataları konsola kaydeden fonksiyon
const logFatalError = (message: string, error: unknown): void => {
  console.error(message);

  // Development ortamındaysak ham hatayı da konsola bas
  if (process.env.NODE_ENV === 'development') {
    console.error(error);
  }
};

// Kapanış fonksiyonunun referansını saklayacak değişken
let gracefulShutdown: GracefulShutdown | undefined;

// Statik uygulama importlarından bile ÖNCE kurulur; başlangıç (startup) anındaki asenkron/senkron hataları da yakalar.
process.on(
  'uncaughtException',
  createUncaughtExceptionHandler({
    getGracefulShutdown: () => gracefulShutdown,
    logFatalError,
  })
);

// Sunucuyu dinamik import (ESM) kullanarak başlatan asenkron giriş fonksiyonu
const start = async (): Promise<void> => {
  try {
    // Bootstrap modülünü dinamik olarak yükle ve sunucuyu başlat
    const { startServer } = await import('./bootstrap.js');
    gracefulShutdown = startServer();
  } catch (error) {
    // Başlangıç anında bir hata olursa ölümcül hata kaydı yap ve süreci bitir
    logFatalError('💥 STARTUP ERROR! Sunucu başlatılamadı.', error);
    process.exit(1);
  }
};

// Giriş fonksiyonunu çalıştır
void start();


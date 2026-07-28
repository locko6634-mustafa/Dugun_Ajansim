// Yakalanmamış Senkron Hataların Yönetimi (Crash Önleyici - En başta dinlenmeli)
process.on('uncaughtException', (err: Error) => {
  console.error('💥 UNCAUGHT EXCEPTION! Sunucu kapatılıyor...');
  console.error(err.name, err.message);
  process.exit(1);
});

import app from './app.js';
import { env } from './config/env.config.js';
import { prisma } from './config/prisma.js';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Düğün Ajansım Backend Sunucusu Çalışıyor: http://localhost:${env.PORT}`);
  console.log(`🛡️ Ortam: ${env.NODE_ENV}`);
  console.log(`🏥 Healthcheck Endpoint: http://localhost:${env.PORT}/api/v1/health`);
});

// Beklenmeyen Asenkron Hataların Yönetimi (Unhandled Rejection)
process.on('unhandledRejection', (err: Error) => {
  console.error('💥 UNHANDLED REJECTION! Sunucu kapatılıyor...');
  console.error(err.name, err.message);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(1);
  });
});

// Graceful Shutdown (SIGTERM & SIGINT)
const gracefulShutdown = (signal: string) => {
  console.log(`👋 ${signal} alındı. Sunucu kapatılıyor...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('💥 İşlem sonlandırıldı.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

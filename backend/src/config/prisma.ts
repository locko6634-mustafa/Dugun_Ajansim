import { PrismaClient } from '@prisma/client';
import { env } from './env.config.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : [],
});

export const checkDatabaseConnection = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    if (env.NODE_ENV === 'development') {
      console.error('❌ Veritabanı bağlantı hatası:', error);
    } else {
      console.error('❌ Veritabanı bağlantı kontrolü başarısız oldu.');
    }
    return false;
  }
};

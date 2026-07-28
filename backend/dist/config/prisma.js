import { PrismaClient } from '@prisma/client';
import { env } from './env.config.js';
export const prisma = new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});
export const checkDatabaseConnection = async () => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        return true;
    }
    catch (error) {
        console.error('❌ Veritabanı bağlantı hatası:', error);
        return false;
    }
};

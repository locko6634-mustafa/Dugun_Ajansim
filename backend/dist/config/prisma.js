import { PrismaClient } from '@prisma/client';
import { env } from './env.config.js';
export const prisma = new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : [],
});
const defaultDatabaseHealthLogger = (message, error) => {
    if (error === undefined) {
        console.error(message);
        return;
    }
    console.error(message, error);
};
export const createDatabaseConnectionChecker = (query, timeoutMs, environment = env.NODE_ENV, logError = defaultDatabaseHealthLogger) => async () => {
    let timeout;
    try {
        await Promise.race([
            query(),
            new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('DATABASE_HEALTHCHECK_TIMEOUT')), timeoutMs);
            }),
        ]);
        return true;
    }
    catch (error) {
        if (environment === 'development') {
            logError('❌ Veritabanı bağlantı hatası:', error);
        }
        else {
            logError('❌ Veritabanı bağlantı kontrolü başarısız oldu.');
        }
        return false;
    }
    finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
};
export const checkDatabaseConnection = createDatabaseConnectionChecker(() => prisma.$queryRaw `SELECT 1`, env.HEALTHCHECK_TIMEOUT_MS);

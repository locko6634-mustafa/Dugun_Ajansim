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
export const createPrismaDatabaseHealthQuery = (client, timeoutMs) => () => client.$transaction(async (transaction) => transaction.$queryRaw `SELECT 1`, {
    maxWait: timeoutMs,
    timeout: timeoutMs,
});
export const createDatabaseConnectionChecker = (query, environment = env.NODE_ENV, logError = defaultDatabaseHealthLogger) => {
    let inFlightCheck;
    const runCheck = async () => {
        try {
            await query();
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
    };
    return () => {
        if (!inFlightCheck) {
            inFlightCheck = runCheck().finally(() => {
                inFlightCheck = undefined;
            });
        }
        return inFlightCheck;
    };
};
export const checkDatabaseConnection = createDatabaseConnectionChecker(createPrismaDatabaseHealthQuery(prisma, env.HEALTHCHECK_TIMEOUT_MS));

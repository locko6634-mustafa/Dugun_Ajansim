import { PrismaClient } from '@prisma/client';
import { env } from './env.config.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : [],
});

type DatabaseHealthQuery = () => Promise<unknown>;
type DatabaseHealthLogger = (message: string, error?: unknown) => void;

const defaultDatabaseHealthLogger: DatabaseHealthLogger = (message, error) => {
  if (error === undefined) {
    console.error(message);
    return;
  }

  console.error(message, error);
};

export const createPrismaDatabaseHealthQuery =
  (client: PrismaClient, timeoutMs: number): DatabaseHealthQuery =>
  () =>
    client.$transaction(
      async (transaction) => transaction.$queryRaw`SELECT 1`,
      {
        maxWait: timeoutMs,
        timeout: timeoutMs,
      }
    );

export const createDatabaseConnectionChecker =
  (
    query: DatabaseHealthQuery,
    environment: string = env.NODE_ENV,
    logError: DatabaseHealthLogger = defaultDatabaseHealthLogger
  ) => {
    let inFlightCheck: Promise<boolean> | undefined;

    const runCheck = async (): Promise<boolean> => {
      try {
        await query();
        return true;
      } catch (error) {
        if (environment === 'development') {
          logError('❌ Veritabanı bağlantı hatası:', error);
        } else {
          logError('❌ Veritabanı bağlantı kontrolü başarısız oldu.');
        }
        return false;
      }
    };

    return (): Promise<boolean> => {
      if (!inFlightCheck) {
        inFlightCheck = runCheck().finally(() => {
          inFlightCheck = undefined;
        });
      }

      return inFlightCheck;
    };
  };

export const checkDatabaseConnection = createDatabaseConnectionChecker(
  createPrismaDatabaseHealthQuery(prisma, env.HEALTHCHECK_TIMEOUT_MS)
);

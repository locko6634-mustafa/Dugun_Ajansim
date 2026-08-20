// Prisma veritabanı istemci sınıfını içe aktar
import { Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
// Ortam değişkenleri yapılandırmamızı içe aktar
import { env } from "./env.config.js";

// Yeni bir Prisma Client örneği başlat (Development ortamındaysak veritabanı sorgularını konsola yazdır)
const basePrisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : []
});

export type RlsActorRole =
  "admin" | "operations" | "montage" | "customer" | "public" | "auth" | "maintenance";

export type RlsSecurityContext = {
  actorRole: RlsActorRole;
  actorUserId?: string;
  venueId?: string;
  purpose: string;
  resourceId?: string;
  applicationId?: string;
};

const securityContextStorage = new AsyncLocalStorage<RlsSecurityContext>();
const transactionStorage = new AsyncLocalStorage<Prisma.TransactionClient>();

const protectedModels = new Set([
  "venue",
  "venueManagerAssignment",
  "user",
  "authSession",
  "trustedDevice",
  "passwordSetupToken",
  "passwordResetChallenge",
  "package",
  "service",
  "bookingApplication",
  "bookingApplicationService",
  "wedding",
  "staff",
  "staffVenueAssignment",
  "weddingAssignment",
  "delivery",
  "deliveryStatusHistory",
  "messageTask",
  "auditLog"
]);

const securityContextQuery = (context: RlsSecurityContext) => Prisma.sql`
    SELECT
      set_config('app.actor_role', ${context.actorRole}, true),
      set_config('app.actor_user_id', ${context.actorUserId ?? ""}, true),
      set_config('app.venue_id', ${context.venueId ?? ""}, true),
      set_config('app.purpose', ${context.purpose}, true),
      set_config('app.resource_id', ${context.resourceId ?? ""}, true),
      set_config('app.application_id', ${context.applicationId ?? ""}, true)
  `;

const setTransactionSecurityContext = async (
  transaction: Prisma.TransactionClient,
  context: RlsSecurityContext
): Promise<void> => {
  await transaction.$queryRaw(securityContextQuery(context));
};

export const runWithRlsContext = <Result>(
  context: RlsSecurityContext,
  operation: () => Promise<Result>
): Promise<Result> => securityContextStorage.run(context, operation);

const requireSecurityContext = (): RlsSecurityContext => {
  const context = securityContextStorage.getStore();
  if (!context) {
    throw new Error("Bağlamsız business veritabanı sorgusu reddedildi.");
  }
  return context;
};

const executeSingleWithContext = async <Result>(
  operation: Prisma.PrismaPromise<Result>
): Promise<Result> => {
  const context = requireSecurityContext();
  const [, result] = await basePrisma.$transaction([
    basePrisma.$queryRaw(securityContextQuery(context)),
    operation
  ]);
  return result;
};

const delegateCache = new Map<PropertyKey, object>();

export const prisma = new Proxy(basePrisma, {
  get(target, property, receiver) {
    if (property === "$transaction") {
      return async (
        operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        options?: {
          maxWait?: number;
          timeout?: number;
          isolationLevel?: Prisma.TransactionIsolationLevel;
        }
      ) => {
        const activeTransaction = transactionStorage.getStore();
        if (activeTransaction) return operation(activeTransaction);
        if (!securityContextStorage.getStore() && env.NODE_ENV !== "production") {
          return basePrisma.$transaction(operation, options);
        }
        const context = requireSecurityContext();
        return basePrisma.$transaction(async (transaction) => {
          await setTransactionSecurityContext(transaction, context);
          return transactionStorage.run(transaction, () => operation(transaction));
        }, options);
      };
    }

    const activeTransaction = transactionStorage.getStore();
    if (activeTransaction) {
      const transactionValue = Reflect.get(activeTransaction, property, activeTransaction);
      return typeof transactionValue === "function"
        ? transactionValue.bind(activeTransaction)
        : transactionValue;
    }

    if (
      ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"].includes(
        String(property)
      ) &&
      securityContextStorage.getStore()
    ) {
      return (...args: unknown[]) => {
        const baseMethod = Reflect.get(target, property, target) as (
          ...methodArgs: unknown[]
        ) => Prisma.PrismaPromise<unknown>;
        return executeSingleWithContext(baseMethod.apply(target, args));
      };
    }

    if (protectedModels.has(String(property))) {
      const cached = delegateCache.get(property);
      if (cached) return cached;
      const delegate = Reflect.get(target, property, receiver) as Record<PropertyKey, unknown>;
      const wrapped = new Proxy(delegate, {
        get(delegateTarget, method) {
          const value = Reflect.get(delegateTarget, method, delegateTarget);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (!securityContextStorage.getStore() && env.NODE_ENV !== "production") {
              return (value as (...methodArgs: unknown[]) => unknown).apply(delegateTarget, args);
            }
            const baseMethod = value as (...methodArgs: unknown[]) => Prisma.PrismaPromise<unknown>;
            return executeSingleWithContext(baseMethod.apply(delegateTarget, args));
          };
        }
      });
      delegateCache.set(property, wrapped);
      return wrapped;
    }

    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  }
}) as PrismaClient;

// Veritabanı sağlık sorgusu fonksiyonu tip tanımı
type DatabaseHealthQuery = () => Promise<unknown>;
// Veritabanı sağlık kontrolü hata loglayıcı tip tanımı
type DatabaseHealthLogger = (message: string, error?: unknown) => void;

// Varsayılan veritabanı hata loglayıcı fonksiyonu
const defaultDatabaseHealthLogger: DatabaseHealthLogger = (message, error) => {
  if (error === undefined) {
    console.error(message);
    return;
  }

  console.error(message, error);
};

// Prisma üzerinden veritabanına sorgu (SELECT 1) atan ve zaman aşımı sınırı uygulayan sağlık sorgusu oluşturucu
export const createPrismaDatabaseHealthQuery =
  (client: PrismaClient, timeoutMs: number): DatabaseHealthQuery =>
  () =>
    client.$transaction(
      // Transaction içerisinde basit bir SQL sorgusu çalıştır
      async (transaction) => transaction.$queryRaw`SELECT 1`,
      {
        // Maksimum bekleme ve sorgu zaman aşımı süresi (milisaniye)
        maxWait: timeoutMs,
        timeout: timeoutMs
      }
    );

// Sağlık kontrolü isteklerini tekilleştiren (in-flight deduplication / memoization) bağlantı kontrolcüsü oluşturucu
export const createDatabaseConnectionChecker = (
  query: DatabaseHealthQuery,
  environment: string = env.NODE_ENV,
  logError: DatabaseHealthLogger = defaultDatabaseHealthLogger
) => {
  // Halen devam etmekte olan canlı kontrol sözünün (promise) referansı
  let inFlightCheck: Promise<boolean> | undefined;

  // Asıl veritabanı sorgusunu çalıştıran ve hataları yakalayan iç fonksiyon
  const runCheck = async (): Promise<boolean> => {
    try {
      await query();
      return true;
    } catch (error) {
      // Geliştirme ortamındaysak detaylı hata günlüğü bas
      if (environment === "development") {
        logError("❌ Veritabanı bağlantı hatası:", error);
      } else {
        logError("❌ Veritabanı bağlantı kontrolü başarısız oldu.");
      }
      return false;
    }
  };

  // İstenildiğinde çalışan kontrol fonksiyonu (Eğer devam eden bir kontrol varsa aynı sonucu paylaşır)
  return (): Promise<boolean> => {
    if (!inFlightCheck) {
      inFlightCheck = runCheck().finally(() => {
        // Sorgu tamamlandığında (başarılı veya hatalı) referansı temizle
        inFlightCheck = undefined;
      });
    }

    return inFlightCheck;
  };
};

// Proje genelinde kullanılan tekil veritabanı bağlantı kontrol fonksiyonu
export const checkDatabaseConnection = createDatabaseConnectionChecker(
  createPrismaDatabaseHealthQuery(basePrisma, env.HEALTHCHECK_TIMEOUT_MS)
);

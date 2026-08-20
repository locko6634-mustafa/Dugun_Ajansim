// Express uygulamamızı içe aktar
import app from "./app.js";
// Ortam değişkenlerimizi içe aktar
import { env } from "./config/env.config.js";
// Prisma veritabanı istemcimizi içe aktar
import { prisma, runWithRlsContext } from "./config/prisma.js";
// Graceful shutdown oluşturucusunu ve tipini içe aktar
import { createGracefulShutdown, type GracefulShutdown } from "./utils/processLifecycle.js";
import { drainPendingBackgroundTasks } from "./utils/pendingTasks.js";
import { expireStalePaymentFlows } from "./services/booking.service.js";
import { synchronizeAutomaticDeliveryStatuses } from "./services/delivery-automation.service.js";

// Kapanış süreci için maksimum bekleme süresi (25 saniye)
const SHUTDOWN_TIMEOUT_MS = 25_000;
const PAYMENT_FLOW_SWEEP_INTERVAL_MS = 60_000;
const DELIVERY_STATUS_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

// Sunucuyu başlatan ve sinyal dinleyicilerini kuran ana bootstrap fonksiyonu
export const startServer = (): GracefulShutdown => {
  let paymentFlowSweepRunning = false;
  let deliveryStatusSweepRunning = false;
  const sweepExpiredPaymentFlows = async (): Promise<void> => {
    if (paymentFlowSweepRunning) return;
    paymentFlowSweepRunning = true;
    try {
      const metrics = await runWithRlsContext(
        { actorRole: "maintenance", purpose: "maintenance.payment-sweep" },
        () => expireStalePaymentFlows()
      );
      console.log(JSON.stringify({ event: "payment_flow_retention_sweep", ...metrics }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "payment_flow_retention_alarm",
          failedCount: 1,
          physicalDeletedCount: 0
        })
      );
      if (env.NODE_ENV === "development") console.error(error);
    } finally {
      paymentFlowSweepRunning = false;
    }
  };
  void sweepExpiredPaymentFlows();
  const paymentFlowSweepTimer = setInterval(
    () => void sweepExpiredPaymentFlows(),
    PAYMENT_FLOW_SWEEP_INTERVAL_MS
  );
  paymentFlowSweepTimer.unref();

  const sweepDeliveryStatuses = async (): Promise<void> => {
    if (deliveryStatusSweepRunning) return;
    deliveryStatusSweepRunning = true;
    try {
      const metrics = await runWithRlsContext(
        { actorRole: "maintenance", purpose: "maintenance.delivery-status" },
        () => synchronizeAutomaticDeliveryStatuses()
      );
      console.log(JSON.stringify({ event: "delivery_status_sweep", ...metrics }));
    } catch (error) {
      console.error(JSON.stringify({ event: "delivery_status_sweep_alarm", failedCount: 1 }));
      if (env.NODE_ENV === "development") console.error(error);
    } finally {
      deliveryStatusSweepRunning = false;
    }
  };
  void sweepDeliveryStatuses();
  const deliveryStatusSweepTimer = setInterval(
    () => void sweepDeliveryStatuses(),
    DELIVERY_STATUS_SWEEP_INTERVAL_MS
  );
  deliveryStatusSweepTimer.unref();

  // HTTP sunucusunu belirtilen PORT üzerinden dinlemeye başla
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 Düğün Ajansım Backend Sunucusu Çalışıyor: http://localhost:${env.PORT}`);
    console.log(`🛡️ Ortam: ${env.NODE_ENV}`);
    console.log(`🏥 Healthcheck Endpoint: http://localhost:${env.PORT}/api/v1/health`);
  });
  server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
  server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.maxRequestsPerSocket = 1_000;

  // Kapanış hatalarını ortama göre günlüğe kaydeden iç fonksiyon
  const logShutdownError = (message: string, error?: unknown): void => {
    if (env.NODE_ENV === "development" && error !== undefined) {
      console.error(message, error);
    } else {
      console.error(message);
    }
  };

  // HTTP sunucusunu kapatan asenkron fonksiyon
  const closeHttpServer = (): Promise<void> =>
    new Promise((resolve, reject) => {
      // Sunucu halihazırda dinlemiyorsa doğrudan tamamla
      if (!server.listening) {
        resolve();
        return;
      }

      // Dinlemeyi durdur
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

  // Sunucu yaşam döngüsü güvenli kapanış mekanizmasını örnekle
  const baseGracefulShutdown = createGracefulShutdown({
    closeHttpServer,
    forceCloseHttpConnections: () => server.closeAllConnections(),
    disconnectDatabase: async () => {
      await drainPendingBackgroundTasks();
      await prisma.$disconnect();
    },
    logInfo: console.log,
    logError: logShutdownError,
    timeoutMs: SHUTDOWN_TIMEOUT_MS
  });
  const gracefulShutdown: GracefulShutdown = (signal, exitCode) => {
    clearInterval(paymentFlowSweepTimer);
    clearInterval(deliveryStatusSweepTimer);
    return baseGracefulShutdown(signal, exitCode);
  };

  // İşlenmeyen asenkron Promise hatalarını (Unhandled Rejection) dinle ve güvenli kapanışı başlat
  process.on("unhandledRejection", (error: unknown) => {
    console.error("💥 UNHANDLED REJECTION! Sunucu kapatılıyor...");
    logShutdownError("❌ İşlenmeyen asenkron hata oluştu.", error);
    void gracefulShutdown("UNHANDLED_REJECTION", 1);
  });

  // İşletim sisteminden gelen SIGTERM (Sunucuyu Durdur) sinyalini dinle
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM", 0));
  // İşletim sisteminden gelen SIGINT (Ctrl + C) sinyalini dinle
  process.on("SIGINT", () => void gracefulShutdown("SIGINT", 0));

  // Oluşturulan Graceful Shutdown kontrolcüsünü döndür
  return gracefulShutdown;
};

export const createGracefulShutdown = ({ closeHttpServer, forceCloseHttpConnections, disconnectDatabase, logInfo, logError, timeoutMs, hardExitTimeoutMs = 1_000, exit = process.exit, }) => {
    let shutdownPromise;
    return (signal, requestedExitCode) => {
        if (shutdownPromise) {
            return shutdownPromise;
        }
        shutdownPromise = new Promise((resolve) => {
            let forced = false;
            let exited = false;
            let disconnectPromise;
            let hardExitTimer;
            const disconnectOnce = () => {
                disconnectPromise ??= disconnectDatabase();
                return disconnectPromise;
            };
            const finish = (exitCode) => {
                if (exited) {
                    return;
                }
                exited = true;
                clearTimeout(forceShutdownTimer);
                if (hardExitTimer) {
                    clearTimeout(hardExitTimer);
                }
                exit(exitCode);
                resolve();
            };
            const forceShutdown = () => {
                forced = true;
                logError('💥 Güvenli kapanış zaman aşımına uğradı. Açık bağlantılar sonlandırılıyor.');
                try {
                    forceCloseHttpConnections();
                }
                catch (error) {
                    logError('❌ Açık HTTP bağlantıları zorla kapatılamadı.', error);
                }
                hardExitTimer = setTimeout(() => finish(1), hardExitTimeoutMs);
                void disconnectOnce()
                    .catch((error) => {
                    logError('❌ Prisma bağlantısı zorla kapatılamadı.', error);
                })
                    .finally(() => finish(1));
            };
            const forceShutdownTimer = setTimeout(forceShutdown, timeoutMs);
            logInfo(`👋 ${signal} alındı. Sunucu kapatılıyor...`);
            void (async () => {
                try {
                    await closeHttpServer();
                    if (forced) {
                        return;
                    }
                    await disconnectOnce();
                    if (forced) {
                        return;
                    }
                    logInfo('✅ Sunucu ve veritabanı bağlantıları güvenle kapatıldı.');
                    finish(requestedExitCode);
                }
                catch (error) {
                    if (forced) {
                        return;
                    }
                    logError('❌ Güvenli kapanış sırasında hata oluştu.', error);
                    try {
                        await disconnectOnce();
                    }
                    catch (disconnectError) {
                        logError('❌ Prisma bağlantısı kapatılamadı.', disconnectError);
                    }
                    finish(1);
                }
            })();
        });
        return shutdownPromise;
    };
};
export const createUncaughtExceptionHandler = ({ getGracefulShutdown, logFatalError, exit = process.exit, }) => (error) => {
    logFatalError('💥 UNCAUGHT EXCEPTION! Sunucu kapatılıyor...', error);
    const gracefulShutdown = getGracefulShutdown();
    if (!gracefulShutdown) {
        exit(1);
        return;
    }
    void gracefulShutdown('UNCAUGHT_EXCEPTION', 1);
};

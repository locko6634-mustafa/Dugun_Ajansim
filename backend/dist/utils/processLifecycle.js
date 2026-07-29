// Güvenli kapanış fonksiyonunu üreten fabrika fonksiyonu
export const createGracefulShutdown = ({ closeHttpServer, forceCloseHttpConnections, disconnectDatabase, logInfo, logError, timeoutMs, hardExitTimeoutMs = 1_000, exit = process.exit, }) => {
    // Çoklu kapanış sinyallerinde tek bir kapanış işleminin yürütülmesini garanti eden Promise referansı
    let shutdownPromise;
    return (signal, requestedExitCode) => {
        // Eğer kapanış süreci halihazırda başlamışsa mevcut Promise'i dön (Mükerrer işlemi engelle)
        if (shutdownPromise) {
            return shutdownPromise;
        }
        shutdownPromise = new Promise((resolve) => {
            let forced = false;
            let exited = false;
            let disconnectPromise;
            let hardExitTimer;
            // Veritabanı bağlantısını tek bir defa kapatmayı garanti eden iç fonksiyon
            const disconnectOnce = () => {
                disconnectPromise ??= disconnectDatabase();
                return disconnectPromise;
            };
            // Kapanış işlemini tamamlayan ve Node.js sürecini sonlandıran iç fonksiyon
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
            // Kapanış süresi zaman aşımına uğradığında devreye giren zorla kapatma fonksiyonu
            const forceShutdown = () => {
                forced = true;
                logError('💥 Güvenli kapanış zaman aşımına uğradı. Açık bağlantılar sonlandırılıyor.');
                try {
                    // Açık HTTP socket bağlantılarını zorla kapat
                    forceCloseHttpConnections();
                }
                catch (error) {
                    logError('❌ Açık HTTP bağlantıları zorla kapatılamadı.', error);
                }
                // Sert çıkış zamanlayıcısını başlat
                hardExitTimer = setTimeout(() => finish(1), hardExitTimeoutMs);
                // Veritabanını son kez kapatmayı dene ve süreci hata koduyla (1) bitir
                void disconnectOnce()
                    .catch((error) => {
                    logError('❌ Prisma bağlantısı zorla kapatılamadı.', error);
                })
                    .finally(() => finish(1));
            };
            // Zaman aşımı süresini başlatan zamanlayıcı
            const forceShutdownTimer = setTimeout(forceShutdown, timeoutMs);
            logInfo(`👋 ${signal} alındı. Sunucu kapatılıyor...`);
            // Asıl düzenli kapanış adımları
            void (async () => {
                try {
                    // 1. Önce HTTP sunucusunu kapat (Yeni istek kabul etmeyi durdur)
                    await closeHttpServer();
                    if (forced) {
                        return;
                    }
                    // 2. Ardından Veritabanı bağlantısını kapat
                    await disconnectOnce();
                    if (forced) {
                        return;
                    }
                    logInfo('✅ Sunucu ve veritabanı bağlantıları güvenle kapatıldı.');
                    // Başarılı istenen çıkış koduyla bitir
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
                    // Hata durumunda çıkış kodu 1 ile bitir
                    finish(1);
                }
            })();
        });
        return shutdownPromise;
    };
};
// Beklenmeyen yakalanmamış hataları (Uncaught Exceptions) ele alan işleyici üreteci
export const createUncaughtExceptionHandler = ({ getGracefulShutdown, logFatalError, exit = process.exit, }) => (error) => {
    logFatalError('💥 UNCAUGHT EXCEPTION! Sunucu kapatılıyor...', error);
    const gracefulShutdown = getGracefulShutdown();
    // Eğer henüz Graceful Shutdown mekanizması kurulmamışsa doğrudan çık
    if (!gracefulShutdown) {
        exit(1);
        return;
    }
    // Güvenli kapanışı tetikle
    void gracefulShutdown('UNCAUGHT_EXCEPTION', 1);
};

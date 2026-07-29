// Prisma veritabanı istemci sınıfını içe aktar
import { PrismaClient } from '@prisma/client';
// Ortam değişkenleri yapılandırmamızı içe aktar
import { env } from './env.config.js';
// Yeni bir Prisma Client örneği başlat (Development ortamındaysak veritabanı sorgularını konsola yazdır)
export const prisma = new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : [],
});
// Varsayılan veritabanı hata loglayıcı fonksiyonu
const defaultDatabaseHealthLogger = (message, error) => {
    if (error === undefined) {
        console.error(message);
        return;
    }
    console.error(message, error);
};
// Prisma üzerinden veritabanına sorgu (SELECT 1) atan ve zaman aşımı sınırı uygulayan sağlık sorgusu oluşturucu
export const createPrismaDatabaseHealthQuery = (client, timeoutMs) => () => client.$transaction(
// Transaction içerisinde basit bir SQL sorgusu çalıştır
async (transaction) => transaction.$queryRaw `SELECT 1`, {
    // Maksimum bekleme ve sorgu zaman aşımı süresi (milisaniye)
    maxWait: timeoutMs,
    timeout: timeoutMs,
});
// Sağlık kontrolü isteklerini tekilleştiren (in-flight deduplication / memoization) bağlantı kontrolcüsü oluşturucu
export const createDatabaseConnectionChecker = (query, environment = env.NODE_ENV, logError = defaultDatabaseHealthLogger) => {
    // Halen devam etmekte olan canlı kontrol sözünün (promise) referansı
    let inFlightCheck;
    // Asıl veritabanı sorgusunu çalıştıran ve hataları yakalayan iç fonksiyon
    const runCheck = async () => {
        try {
            await query();
            return true;
        }
        catch (error) {
            // Geliştirme ortamındaysak detaylı hata günlüğü bas
            if (environment === 'development') {
                logError('❌ Veritabanı bağlantı hatası:', error);
            }
            else {
                logError('❌ Veritabanı bağlantı kontrolü başarısız oldu.');
            }
            return false;
        }
    };
    // İstenildiğinde çalışan kontrol fonksiyonu (Eğer devam eden bir kontrol varsa aynı sonucu paylaşır)
    return () => {
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
export const checkDatabaseConnection = createDatabaseConnectionChecker(createPrismaDatabaseHealthQuery(prisma, env.HEALTHCHECK_TIMEOUT_MS));

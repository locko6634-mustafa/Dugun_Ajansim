// Express türlerini (Request, Response, NextFunction) içe aktar
import type { Request, Response, NextFunction } from 'express';
// Veritabanı bağlantı kontrol fonksiyonunu prisma konfigürasyonundan içe aktar
import { checkDatabaseConnection } from '../config/prisma.js';
// Ortam değişkenleri nesnesini içe aktar
import { env } from '../config/env.config.js';

// Veritabanı sağlık kontrolü fonksiyonunun tip tanımı (asenkron true/false döner)
type DatabaseHealthCheck = () => Promise<boolean>;

// Sistem sağlık kontrolcüsünü oluşturan fabrika (factory) fonksiyonu (Test edilebilirlik için bağımlılıklar dışarıdan geçilebilir)
export const createSystemHealthHandler = (
  // Veritabanı bağlantı testi fonksiyonu (Varsayılan: gerçek veritabanı testi)
  databaseHealthCheck: DatabaseHealthCheck = checkDatabaseConnection,
  // Çalışma ortamı (Varsayılan: env içerisindeki NODE_ENV)
  environment = env.NODE_ENV,
  // Sunucunun çalışma süresini (uptime) saniye cinsinden veren fonksiyon
  getUptime: () => number = process.uptime
) =>
  // Express rota isteklerini karşılayan asenkron middleware fonksiyonu
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Healthcheck yanıtının hiçbir istemci veya CDN tarafından önbelleğe alınmaması için Cache-Control başlığını ayarla
    res.set('Cache-Control', 'no-store');

    try {
      // Veritabanı bağlantısının canlı olup olmadığını kontrol et
      const isDbConnected = await databaseHealthCheck();
      
      // Production ortamında sistem ayrıntılarını (sunucu çalışma süresi, ortam adı) gizle, dev ortamında göster
      const diagnostics = environment === 'production'
        ? {}
        : { environment, uptime: getUptime() };

      // Veritabanı bağlıysa HTTP 200 (OK), bağlı değilse HTTP 503 (Service Unavailable) ile JSON yanıtı dön
      res.status(isDbConnected ? 200 : 503).json({
        // İşlem başarısı (true/false)
        success: isDbConnected,
        // Metinsel durum ('healthy' / 'unhealthy')
        status: isDbConnected ? 'healthy' : 'unhealthy',
        // İsteğin işlendiği zaman damgası (ISO formatında)
        timestamp: new Date().toISOString(),
        // Veritabanı durumu ('connected' / 'disconnected')
        database: isDbConnected ? 'connected' : 'disconnected',
        correlationId: req.correlationId,
        // Geliştirme ortamı ek tanı bilgileri
        ...diagnostics,
      });
    } catch (error) {
      // Beklenmeyen bir hata oluşursa global hata yakalayıcıya devret
      next(error);
    }
  };

// Varsayılan bağımlılıklarla oluşturulmuş sağlık kontrolü kontrolcü fonksiyonunu dışa aktar
export const getSystemHealth = createSystemHealthHandler();

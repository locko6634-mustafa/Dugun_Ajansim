// Benzersiz kimlik oluşturmak için Node.js crypto modülünden randomUUID fonksiyonunu içe aktar
import { randomUUID } from 'node:crypto';
// Express türlerini içe aktar
import type { Request, Response, NextFunction } from 'express';
// Özel hata sınıfımızı içe aktar
import { AppError } from '../utils/appError.js';
// Ortam değişkenlerimizi içe aktar
import { env } from '../config/env.config.js';

// Hata günlüğü girdisinin veri tipi
type ErrorLogEntry = Record<string, unknown>;
// Hata günlükçüsü fonksiyonunun tipi
type ErrorLogger = (entry: ErrorLogEntry) => void;
// Ekstra status/expose özellikleri taşıyabilen genişletilmiş Error nesnesi tipi
type ErrorWithStatus = Error & { expose?: unknown; status?: unknown; statusCode?: unknown };

// Varsayılan hata günlükleyici fonksiyonu (Konsola JSON formatında yazar)
const defaultErrorLogger: ErrorLogger = (entry) => {
  console.error(JSON.stringify(entry));
};

// Yakalanan hatadan uygun HTTP durum kodunu (status code) çıkaran yardımcı fonksiyon
const resolveStatusCode = (error: Error | AppError): number => {
  // Eğer hata AppError örneği ise doğrudan içerisindeki statusCode değerini dön
  if (error instanceof AppError) {
    return error.statusCode;
  }

  // Harici kütüphanelerden (ör. Express body-parser) gelen hataların status veya statusCode alanını incele
  const errorWithStatus = error as ErrorWithStatus;
  const candidate = errorWithStatus.statusCode ?? errorWithStatus.status;

  // Eğer geçerli bir HTTP durum kodu (400-599) ise onu kullan, aksi takdirde 500 (Sunucu Hatası) kabul et
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 400 &&
    candidate <= 599
    ? candidate
    : 500;
};

// Global hata yakalayıcı middleware üreten fabrika fonksiyonu (Testlerde log ve ortamı taklit edebilmek için)
export const createGlobalErrorHandler = (
  environment = env.NODE_ENV,
  logError: ErrorLogger = defaultErrorLogger
) =>
  // Express'in 4 parametreli Hata Yakalama Middleware imzası
  (
    err: Error | AppError,
    req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    // Hataya karşılık gelen HTTP durum kodunu belirle
    const statusCode = resolveStatusCode(err);
    // Hata mesajını al veya varsayılan Türkçe mesajı ata
    const message = err.message || 'Sunucu içi bir hata oluştu.';
    // Varsa ek doğrulama detaylarını al
    const errors = err instanceof AppError ? err.errors : undefined;
    // Hatanın güvenle kullanıcıya yansıtılabilecek operasyonel bir hata olup olmadığını hesapla
    const isOperational =
      (err instanceof AppError && err.isOperational) ||
      (!(err instanceof AppError) &&
        statusCode >= 400 &&
        statusCode < 500 &&
        (err as ErrorWithStatus).expose === true);
    // Detayların (mesaj ve hataların) kullanıcıya açılıp açılamayacağını belirle (Sadece 4xx operasyonel hatalarda açılır)
    const canExposeDetails = isOperational && statusCode < 500;
    // Hatanın izlenmesi için benzersiz bir UUID üret
    const errorId = randomUUID();

    // Eğer hata operasyonel değilse (yazılım çökmesi) veya 500+ sunucu hatasıysa sistem günlüğüne detaylıca kaydet
    if (!isOperational || statusCode >= 500) {
      const logEntry: ErrorLogEntry = {
        level: 'error',
        event: 'request_error',
        timestamp: new Date().toISOString(),
        errorId,
        method: req.method ?? 'UNKNOWN',
        path: req.path ?? req.originalUrl?.split('?')[0] ?? 'UNKNOWN',
        statusCode,
        errorType: err.name,
        operational: isOperational,
      };

      // Development ortamındaysak hata mesajını ve stack trace bilgisini de log nesnesine ekle
      if (environment === 'development') {
        logEntry.message = message;
        logEntry.stack = err.stack;
      }

      // Loglayıcıyı tetikle
      logError(logEntry);
    }

    // Geliştirme ortamındaysak tüm detayları ve stack trace bilgisini istemciye döndür
    if (environment === 'development') {
      res.status(statusCode).json({
        success: false,
        status: 'error',
        statusCode,
        message,
        ...(errors ? { errors } : {}),
        errorId,
        stack: err.stack,
      });
    } else {
      // Production ortamında hassas sistem ayrıntılarını sakla, sadece güvenli mesajı veya genel hatayı dön
      res.status(statusCode).json({
        success: false,
        status: 'error',
        statusCode,
        message: canExposeDetails ? message : 'Bir hata oluştu.',
        ...(canExposeDetails && errors ? { errors } : {}),
        ...(!isOperational || statusCode >= 500 ? { errorId } : {}),
      });
    }
  };

// Varsayılan bağımlılıklarla oluşturulmuş global hata yakalama middleware fonksiyonunu dışa aktar
export const globalErrorHandler = createGlobalErrorHandler();


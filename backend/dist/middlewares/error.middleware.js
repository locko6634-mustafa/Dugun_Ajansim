// Benzersiz kimlik oluşturmak için Node.js crypto modülünden randomUUID fonksiyonunu içe aktar
import { randomUUID } from 'node:crypto';
// Özel hata sınıfımızı içe aktar
import { AppError } from '../utils/appError.js';
// Ortam değişkenlerimizi içe aktar
import { env } from '../config/env.config.js';
const sanitizeLogText = (value, maximumLength) => value
    .replace(/((?:password|passwd|token|cookie|authorization|secret|api[_-]?key|encryption[_-]?key|database_url)\s*[=:]\s*)([^\s,;"']+)/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/https?:\/\/[^\s)]+/gi, '[URL_REDACTED]')
    .replace(/([/\\](?:Users|home)[/\\])[^/\\)]+/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, maximumLength);
const extractSafeStackFrames = (stack) => {
    if (!stack)
        return undefined;
    const frames = stack
        .split(/\r?\n/)
        .slice(1)
        .filter((line) => /^\s*at\s/.test(line))
        .slice(0, 12)
        .map((line) => sanitizeLogText(line.trim(), 512));
    return frames.length > 0 ? frames : undefined;
};
const normalizeCorrelationId = (correlationId) => correlationId && /^[A-Za-z0-9._-]{8,128}$/.test(correlationId) ? correlationId : undefined;
// Varsayılan hata günlükleyici fonksiyonu (Konsola JSON formatında yazar)
const defaultErrorLogger = (entry) => {
    console.error(JSON.stringify(entry));
};
// Yakalanan hatadan uygun HTTP durum kodunu (status code) çıkaran yardımcı fonksiyon
const resolveStatusCode = (error) => {
    // Eğer hata AppError örneği ise doğrudan içerisindeki statusCode değerini dön
    if (error instanceof AppError) {
        return error.statusCode;
    }
    // Harici kütüphanelerden (ör. Express body-parser) gelen hataların status veya statusCode alanını incele
    const errorWithStatus = error;
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
export const createGlobalErrorHandler = (environment = env.NODE_ENV, logError = defaultErrorLogger) => 
// Express'in 4 parametreli Hata Yakalama Middleware imzası
(err, req, res, _next) => {
    res.set('Cache-Control', 'no-store');
    // Hataya karşılık gelen HTTP durum kodunu belirle
    const statusCode = resolveStatusCode(err);
    // Hata mesajını al veya varsayılan Türkçe mesajı ata
    const message = err.message || 'Sunucu içi bir hata oluştu.';
    // Varsa ek doğrulama detaylarını al
    const errors = err instanceof AppError ? err.errors : undefined;
    // Hatanın güvenle kullanıcıya yansıtılabilecek operasyonel bir hata olup olmadığını hesapla
    const isOperational = (err instanceof AppError && err.isOperational) ||
        (!(err instanceof AppError) &&
            statusCode >= 400 &&
            statusCode < 500 &&
            err.expose === true);
    // Detayların (mesaj ve hataların) kullanıcıya açılıp açılamayacağını belirle (Sadece 4xx operasyonel hatalarda açılır)
    const canExposeDetails = isOperational && statusCode < 500;
    const safeOperationalMessage = err instanceof AppError
        ? message
        : statusCode === 413
            ? 'İstek gövdesi izin verilen boyutu aşıyor.'
            : 'İstek biçimi geçersiz.';
    // Hatanın izlenmesi için benzersiz bir UUID üret
    const errorId = randomUUID();
    const correlationId = normalizeCorrelationId(req.correlationId);
    // Eğer hata operasyonel değilse (yazılım çökmesi) veya 500+ sunucu hatasıysa sistem günlüğüne detaylıca kaydet
    if (!isOperational || statusCode >= 500) {
        const routePath = typeof req.route?.path === 'string'
            ? `${req.baseUrl ?? ''}${req.route.path}`
            : 'UNMATCHED';
        const logEntry = {
            level: 'error',
            event: 'request_error',
            timestamp: new Date().toISOString(),
            errorId,
            correlationId,
            method: req.method ?? 'UNKNOWN',
            path: sanitizeLogText(routePath, 512),
            statusCode,
            errorType: err.name,
            operational: isOperational,
        };
        // Development ortamındaysak hata mesajını ve stack trace bilgisini de log nesnesine ekle
        if (environment === 'development') {
            logEntry.message = message;
            logEntry.stack = err.stack;
        }
        else {
            logEntry.diagnostic = isOperational ? 'operational_error' : 'unexpected_error';
            if (isOperational) {
                logEntry.message = sanitizeLogText(message, 1_000);
            }
            const stackFrames = extractSafeStackFrames(err.stack);
            if (stackFrames)
                logEntry.stackFrames = stackFrames;
            const errorCode = err.code;
            if (typeof errorCode === 'string' && /^[A-Z0-9_-]{1,64}$/i.test(errorCode)) {
                logEntry.errorCode = errorCode;
            }
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
            correlationId,
            stack: err.stack,
        });
    }
    else {
        // Production ortamında hassas sistem ayrıntılarını sakla, sadece güvenli mesajı veya genel hatayı dön
        res.status(statusCode).json({
            success: false,
            status: 'error',
            statusCode,
            message: canExposeDetails ? safeOperationalMessage : 'Bir hata oluştu.',
            ...(canExposeDetails && errors ? { errors } : {}),
            ...(!isOperational || statusCode >= 500 ? { errorId } : {}),
            correlationId,
        });
    }
};
// Varsayılan bağımlılıklarla oluşturulmuş global hata yakalama middleware fonksiyonunu dışa aktar
export const globalErrorHandler = createGlobalErrorHandler();

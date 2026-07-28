import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/appError.js';
import { env } from '../config/env.config.js';
const defaultErrorLogger = (entry) => {
    console.error(JSON.stringify(entry));
};
const resolveStatusCode = (error) => {
    if (error instanceof AppError) {
        return error.statusCode;
    }
    const errorWithStatus = error;
    const candidate = errorWithStatus.statusCode ?? errorWithStatus.status;
    return typeof candidate === 'number' &&
        Number.isInteger(candidate) &&
        candidate >= 400 &&
        candidate <= 599
        ? candidate
        : 500;
};
export const createGlobalErrorHandler = (environment = env.NODE_ENV, logError = defaultErrorLogger) => (err, req, res, _next) => {
    const statusCode = resolveStatusCode(err);
    const message = err.message || 'Sunucu içi bir hata oluştu.';
    const errors = err instanceof AppError ? err.errors : undefined;
    const isOperational = (err instanceof AppError && err.isOperational) ||
        (!(err instanceof AppError) &&
            statusCode >= 400 &&
            statusCode < 500 &&
            err.expose === true);
    const canExposeDetails = isOperational && statusCode < 500;
    const errorId = randomUUID();
    if (!isOperational || statusCode >= 500) {
        const logEntry = {
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
        if (environment === 'development') {
            logEntry.message = message;
            logEntry.stack = err.stack;
        }
        logError(logEntry);
    }
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
    }
    else {
        // Production modunda hassas hataları gizle
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
export const globalErrorHandler = createGlobalErrorHandler();

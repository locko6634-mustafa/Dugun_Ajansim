import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError.js';
import { env } from '../config/env.config.js';

type ErrorLogEntry = Record<string, unknown>;
type ErrorLogger = (entry: ErrorLogEntry) => void;

const defaultErrorLogger: ErrorLogger = (entry) => {
  console.error(JSON.stringify(entry));
};

export const createGlobalErrorHandler = (
  environment = env.NODE_ENV,
  logError: ErrorLogger = defaultErrorLogger
) =>
  (
    err: Error | AppError,
    req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message = err.message || 'Sunucu içi bir hata oluştu.';
    const errors = err instanceof AppError ? err.errors : undefined;
    const isOperational = err instanceof AppError && err.isOperational;
    const canExposeDetails = isOperational && statusCode < 500;
    const errorId = randomUUID();

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
    } else {
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

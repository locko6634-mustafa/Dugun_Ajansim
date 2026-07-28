import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError.js';
import { env } from '../config/env.config.js';

export const createGlobalErrorHandler = (environment = env.NODE_ENV) =>
  (
    err: Error | AppError,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message = err.message || 'Sunucu içi bir hata oluştu.';
    const errors = err instanceof AppError ? err.errors : undefined;

    if (environment === 'development') {
      res.status(statusCode).json({
        success: false,
        status: 'error',
        statusCode,
        message,
        ...(errors ? { errors } : {}),
        stack: err.stack,
      });
    } else {
      // Production modunda hassas hataları gizle
      res.status(statusCode).json({
        success: false,
        status: 'error',
        statusCode,
        message: err instanceof AppError && err.isOperational ? message : 'Bir hata oluştu.',
        ...(err instanceof AppError && err.isOperational && errors ? { errors } : {}),
      });
    }
  };

export const globalErrorHandler = createGlobalErrorHandler();

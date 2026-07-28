import { Request, Response, NextFunction } from 'express';
import { checkDatabaseConnection } from '../config/prisma.js';
import { env } from '../config/env.config.js';

export const getSystemHealth = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isDbConnected = await checkDatabaseConnection();

    res.status(isDbConnected ? 200 : 503).json({
      success: isDbConnected,
      status: isDbConnected ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      uptime: process.uptime(),
      database: isDbConnected ? 'connected' : 'disconnected',
    });
  } catch (error) {
    next(error);
  }
};

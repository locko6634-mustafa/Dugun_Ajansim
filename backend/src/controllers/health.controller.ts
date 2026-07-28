import type { Request, Response, NextFunction } from 'express';
import { checkDatabaseConnection } from '../config/prisma.js';
import { env } from '../config/env.config.js';

type DatabaseHealthCheck = () => Promise<boolean>;

export const createSystemHealthHandler = (
  databaseHealthCheck: DatabaseHealthCheck = checkDatabaseConnection,
  environment = env.NODE_ENV,
  getUptime: () => number = process.uptime
) =>
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isDbConnected = await databaseHealthCheck();
      const diagnostics = environment === 'production'
        ? {}
        : { environment, uptime: getUptime() };

      res.status(isDbConnected ? 200 : 503).json({
        success: isDbConnected,
        status: isDbConnected ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        database: isDbConnected ? 'connected' : 'disconnected',
        ...diagnostics,
      });
    } catch (error) {
      next(error);
    }
  };

export const getSystemHealth = createSystemHealthHandler();

import { checkDatabaseConnection } from '../config/prisma.js';
import { env } from '../config/env.config.js';
export const createSystemHealthHandler = (databaseHealthCheck = checkDatabaseConnection, environment = env.NODE_ENV, getUptime = process.uptime) => async (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
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
    }
    catch (error) {
        next(error);
    }
};
export const getSystemHealth = createSystemHealthHandler();

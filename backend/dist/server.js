import { createUncaughtExceptionHandler } from './utils/processLifecycle.js';
const logFatalError = (message, error) => {
    console.error(message);
    if (process.env.NODE_ENV === 'development') {
        console.error(error);
    }
};
let gracefulShutdown;
// Statik uygulama importlarından önce kurulur; başlangıç hatalarını da kapsar.
process.on('uncaughtException', createUncaughtExceptionHandler({
    getGracefulShutdown: () => gracefulShutdown,
    logFatalError,
}));
const start = async () => {
    try {
        const { startServer } = await import('./bootstrap.js');
        gracefulShutdown = startServer();
    }
    catch (error) {
        logFatalError('💥 STARTUP ERROR! Sunucu başlatılamadı.', error);
        process.exit(1);
    }
};
void start();

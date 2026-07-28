export const createUncaughtExceptionHandler = ({ getGracefulShutdown, logFatalError, exit = process.exit, }) => (error) => {
    logFatalError('💥 UNCAUGHT EXCEPTION! Sunucu kapatılıyor...', error);
    const gracefulShutdown = getGracefulShutdown();
    if (!gracefulShutdown) {
        exit(1);
        return;
    }
    void gracefulShutdown('UNCAUGHT_EXCEPTION', 1);
};

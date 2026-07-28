const logFatalError = (message: string, error: unknown): void => {
  console.error(message);

  if (process.env.NODE_ENV === 'development') {
    console.error(error);
  }
};

// Statik uygulama importlarından önce kurulur; başlangıç hatalarını da kapsar.
process.on('uncaughtException', (error: unknown) => {
  logFatalError('💥 UNCAUGHT EXCEPTION! Sunucu kapatılıyor...', error);
  process.exit(1);
});

const start = async (): Promise<void> => {
  try {
    const { startServer } = await import('./bootstrap.js');
    startServer();
  } catch (error) {
    logFatalError('💥 STARTUP ERROR! Sunucu başlatılamadı.', error);
    process.exit(1);
  }
};

void start();

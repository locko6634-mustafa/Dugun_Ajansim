const EXPECTED_TEST_DATABASE_GUARD = 'dugun_ajansim_local_test_only';
const EXPECTED_TEST_DATABASE_HOST = 'localhost';
const EXPECTED_TEST_DATABASE_PORT = '55432';
const EXPECTED_TEST_DATABASE_NAME = 'dugun_ajansim_test';

export const assertSafeLocalTestDatabase = (environment: NodeJS.ProcessEnv = process.env): URL => {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL entegrasyon testi için zorunludur.');
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL geçerli bir PostgreSQL URL değeri olmalıdır.');
  }

  const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\/+/, ''));
  const isPostgreSqlProtocol = ['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol);
  const isExpectedTarget =
    parsedDatabaseUrl.hostname === EXPECTED_TEST_DATABASE_HOST &&
    parsedDatabaseUrl.port === EXPECTED_TEST_DATABASE_PORT &&
    databaseName === EXPECTED_TEST_DATABASE_NAME;

  if (
    environment.NODE_ENV !== 'test' ||
    environment.TEST_DATABASE_GUARD !== EXPECTED_TEST_DATABASE_GUARD ||
    !isPostgreSqlProtocol ||
    !isExpectedTarget
  ) {
    throw new Error(
      'Test veritabanı işlemi yalnızca açık guard ile localhost:55432/dugun_ajansim_test hedefinde çalıştırılabilir.',
    );
  }

  return parsedDatabaseUrl;
};

const EXPECTED_TEST_DATABASE_GUARD = 'dugun_ajansim_local_test_only';
const EXPECTED_TEST_DATABASE_HOST = 'localhost';
const DEFAULT_TEST_DATABASE_PORT = '55632';
const EXPECTED_TEST_DATABASE_NAME = 'dugun_ajansim_test';

const resolveExpectedTestDatabasePort = (environment: NodeJS.ProcessEnv): string => {
  const configuredPort = environment.TEST_DATABASE_PORT?.trim() || DEFAULT_TEST_DATABASE_PORT;
  const portNumber = Number(configuredPort);

  if (!/^\d{1,5}$/.test(configuredPort) || portNumber < 1 || portNumber > 65535) {
    throw new Error('TEST_DATABASE_PORT 1-65535 aralığında geçerli bir port olmalıdır.');
  }

  return configuredPort;
};

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
  const expectedPort = resolveExpectedTestDatabasePort(environment);
  const isPostgreSqlProtocol = ['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol);
  const isExpectedTarget =
    parsedDatabaseUrl.hostname === EXPECTED_TEST_DATABASE_HOST &&
    parsedDatabaseUrl.port === expectedPort &&
    databaseName === EXPECTED_TEST_DATABASE_NAME;

  if (
    environment.NODE_ENV !== 'test' ||
    environment.TEST_DATABASE_GUARD !== EXPECTED_TEST_DATABASE_GUARD ||
    !isPostgreSqlProtocol ||
    !isExpectedTarget
  ) {
    throw new Error(
      `Test veritabanı işlemi yalnızca açık guard ile localhost:${expectedPort}/dugun_ajansim_test hedefinde çalıştırılabilir.`,
    );
  }

  return parsedDatabaseUrl;
};

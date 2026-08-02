type SecurityLogEntry = {
  level: 'warn';
  event: 'auth_login_failed';
  timestamp: string;
  correlationId: string;
  reasonCode: 'INVALID_CREDENTIALS';
};

type SecurityLogger = (entry: SecurityLogEntry) => void;

const normalizeCorrelationId = (correlationId: string | undefined): string =>
  correlationId && /^[A-Za-z0-9._-]{8,128}$/.test(correlationId) ? correlationId : 'unavailable';

export const createFailedLoginSecurityEvent = (
  correlationId: string | undefined,
  now = new Date(),
): SecurityLogEntry => ({
  level: 'warn',
  event: 'auth_login_failed',
  timestamp: now.toISOString(),
  correlationId: normalizeCorrelationId(correlationId),
  reasonCode: 'INVALID_CREDENTIALS',
});

const defaultSecurityLogger: SecurityLogger = (entry) => {
  console.warn(JSON.stringify(entry));
};

export const logFailedLoginSecurityEvent = (
  correlationId: string | undefined,
  logger: SecurityLogger = defaultSecurityLogger,
): void => {
  logger(createFailedLoginSecurityEvent(correlationId));
};

const normalizeCorrelationId = (correlationId) => correlationId && /^[A-Za-z0-9._-]{8,128}$/.test(correlationId) ? correlationId : 'unavailable';
export const createFailedLoginSecurityEvent = (correlationId, now = new Date()) => ({
    level: 'warn',
    event: 'auth_login_failed',
    timestamp: now.toISOString(),
    correlationId: normalizeCorrelationId(correlationId),
    reasonCode: 'INVALID_CREDENTIALS',
});
const defaultSecurityLogger = (entry) => {
    console.warn(JSON.stringify(entry));
};
export const logFailedLoginSecurityEvent = (correlationId, logger = defaultSecurityLogger) => {
    logger(createFailedLoginSecurityEvent(correlationId));
};

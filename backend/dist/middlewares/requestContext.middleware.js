import { randomUUID } from 'node:crypto';
export const attachRequestContext = (req, res, next) => {
    const incomingId = req.get('X-Correlation-ID');
    req.correlationId =
        incomingId && /^[A-Za-z0-9._-]{8,128}$/.test(incomingId) ? incomingId : randomUUID();
    res.set('X-Correlation-ID', req.correlationId);
    next();
};

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const attachRequestContext = (req: Request, res: Response, next: NextFunction): void => {
  const incomingId = req.get('X-Correlation-ID');
  req.correlationId =
    incomingId && /^[A-Za-z0-9._-]{8,128}$/.test(incomingId) ? incomingId : randomUUID();
  res.set('X-Correlation-ID', req.correlationId);
  next();
};

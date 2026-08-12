import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.config.js';
import { AppError } from './appError.js';

const CURSOR_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ListCursor = {
  id: string;
  sortValue: string;
  secondarySortValue?: string;
};

const sign = (payload: string): Buffer =>
  createHmac('sha256', Buffer.from(env.RATE_LIMIT_HMAC_KEY, 'hex'))
    .update('list-cursor:v1:')
    .update(payload)
    .digest();

const invalidCursor = (): never => {
  throw new AppError('Geçersiz sayfalama imleci.', 400);
};

export const encodeListCursor = (cursor: ListCursor): string => {
  if (
    !UUID_PATTERN.test(cursor.id) ||
    typeof cursor.sortValue !== 'string' ||
    cursor.sortValue.length < 1 ||
    cursor.sortValue.length > 100 ||
    (cursor.secondarySortValue !== undefined &&
      (cursor.secondarySortValue.length < 1 || cursor.secondarySortValue.length > 100))
  ) {
    return invalidCursor();
  }

  const payload = Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      id: cursor.id,
      s: cursor.sortValue,
      ...(cursor.secondarySortValue === undefined ? {} : { s2: cursor.secondarySortValue }),
    }),
  ).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
};

export const decodeListCursor = (value: string): ListCursor => {
  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) return invalidCursor();
    const actual = Buffer.from(signature, 'base64url');
    const expected = sign(payload);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return invalidCursor();

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      v?: unknown;
      id?: unknown;
      s?: unknown;
      s2?: unknown;
    };
    if (
      parsed.v !== CURSOR_VERSION ||
      typeof parsed.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id) ||
      typeof parsed.s !== 'string' ||
      parsed.s.length < 1 ||
      parsed.s.length > 100 ||
      (parsed.s2 !== undefined &&
        (typeof parsed.s2 !== 'string' || parsed.s2.length < 1 || parsed.s2.length > 100))
    ) {
      return invalidCursor();
    }

    return {
      id: parsed.id,
      sortValue: parsed.s,
      ...(parsed.s2 === undefined ? {} : { secondarySortValue: parsed.s2 }),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return invalidCursor();
  }
};

export const listPaginationMeta = (
  totalItems: number,
  pageSize: number,
  nextCursor: string | null,
) => ({
  totalItems,
  pageSize,
  nextCursor,
  hasNextPage: nextCursor !== null,
});

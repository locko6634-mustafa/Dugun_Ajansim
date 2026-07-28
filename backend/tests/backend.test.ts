import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { parseEnvironment } from '../src/config/env.config.js';
import { createSystemHealthHandler } from '../src/controllers/health.controller.js';
import { createGlobalErrorHandler } from '../src/middlewares/error.middleware.js';
import { validateRequest } from '../src/middlewares/validate.middleware.js';
import { AppError } from '../src/utils/appError.js';

const validEnvironment: NodeJS.ProcessEnv = {
  PORT: '5000',
  NODE_ENV: 'test',
  CORS_ORIGIN: 'http://localhost:3000/,https://example.com',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/dugun_ajansim',
};

const createMockResponse = () => {
  let statusCode = 0;
  let body: unknown;

  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(payload: unknown) {
      body = payload;
      return response;
    },
  } as unknown as Response;

  return {
    response,
    getStatusCode: () => statusCode,
    getBody: () => body as Record<string, unknown>,
  };
};

test('ortam değişkenleri doğrulanır ve CORS origin adresleri normalize edilir', () => {
  const parsed = parseEnvironment(validEnvironment);

  assert.equal(parsed.PORT, 5000);
  assert.deepEqual(parsed.CORS_ORIGIN, ['http://localhost:3000', 'https://example.com']);
  assert.throws(() => parseEnvironment({ ...validEnvironment, PORT: '5000abc' }));
  assert.throws(() => parseEnvironment({ ...validEnvironment, CORS_ORIGIN: '*' }));
  assert.throws(() => parseEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/test' }));
});

test('production health yanıtı sistem ayrıntılarını dışarı açmaz', async () => {
  const mock = createMockResponse();
  const handler = createSystemHealthHandler(async () => false, 'production', () => 42);

  await handler({} as Request, mock.response, (() => undefined) as NextFunction);

  assert.equal(mock.getStatusCode(), 503);
  assert.equal(mock.getBody().status, 'unhealthy');
  assert.equal(mock.getBody().database, 'disconnected');
  assert.equal('environment' in mock.getBody(), false);
  assert.equal('uptime' in mock.getBody(), false);
});

test('development health yanıtı tanılama ayrıntılarını korur', async () => {
  const mock = createMockResponse();
  const handler = createSystemHealthHandler(async () => true, 'development', () => 42);

  await handler({} as Request, mock.response, (() => undefined) as NextFunction);

  assert.equal(mock.getStatusCode(), 200);
  assert.equal(mock.getBody().environment, 'development');
  assert.equal(mock.getBody().uptime, 42);
});

test('production hata yanıtı beklenmeyen hata ayrıntılarını gizler', () => {
  const mock = createMockResponse();
  const handler = createGlobalErrorHandler('production');

  handler(
    new Error('gizli sistem ayrıntısı'),
    {} as Request,
    mock.response,
    (() => undefined) as NextFunction
  );

  assert.equal(mock.getStatusCode(), 500);
  assert.equal(mock.getBody().message, 'Bir hata oluştu.');
  assert.equal('stack' in mock.getBody(), false);
});

test('operasyonel AppError durum kodunu ve güvenli ayrıntıları korur', () => {
  const mock = createMockResponse();
  const handler = createGlobalErrorHandler('production');
  const details = [{ field: 'body.email', message: 'Geçersiz e-posta' }];

  handler(
    new AppError('Girdi doğrulama hatası', 400, true, details),
    {} as Request,
    mock.response,
    (() => undefined) as NextFunction
  );

  assert.equal(mock.getStatusCode(), 400);
  assert.equal(mock.getBody().message, 'Girdi doğrulama hatası');
  assert.deepEqual(mock.getBody().errors, details);
});

test('request validator geçersiz girdiyi AppError olarak iletir', async () => {
  const schema = z.object({
    body: z.object({ email: z.string().email() }),
    query: z.record(z.unknown()),
    params: z.record(z.unknown()),
  });
  const middleware = validateRequest(schema);
  let forwardedError: unknown;

  await middleware(
    { body: { email: 'geçersiz' }, query: {}, params: {} } as Request,
    {} as Response,
    ((error?: unknown) => {
      forwardedError = error;
    }) as NextFunction
  );

  assert.ok(forwardedError instanceof AppError);
  assert.equal(forwardedError.statusCode, 400);
});

test('başlangıç yapılandırma hatası port açılmadan kontrollü biçimde sonlanır', () => {
  const result = spawnSync(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: 'geçersiz',
    },
    encoding: 'utf8',
    timeout: 5_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /STARTUP ERROR/);
  assert.doesNotMatch(result.stderr, /ZodError|at file:/);
});

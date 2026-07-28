import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { parseEnvironment } from '../src/config/env.config.js';
import { createDatabaseConnectionChecker } from '../src/config/prisma.js';
import { createSystemHealthHandler } from '../src/controllers/health.controller.js';
import { createGlobalErrorHandler } from '../src/middlewares/error.middleware.js';
import { validateCorsOrigin } from '../src/middlewares/security.middleware.js';
import { validateRequest } from '../src/middlewares/validate.middleware.js';
import { AppError } from '../src/utils/appError.js';
import { createUncaughtExceptionHandler } from '../src/utils/processLifecycle.js';
import type { GracefulShutdown } from '../src/utils/processLifecycle.js';

const validEnvironment: NodeJS.ProcessEnv = {
  PORT: '5000',
  NODE_ENV: 'test',
  CORS_ORIGIN: 'http://localhost:3000/,https://example.com',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/dugun_ajansim',
  TRUST_PROXY: '0',
  HEALTHCHECK_TIMEOUT_MS: '3000',
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
  assert.equal(parsed.TRUST_PROXY, 0);
  assert.equal(parsed.HEALTHCHECK_TIMEOUT_MS, 3000);
  assert.throws(() => parseEnvironment({ ...validEnvironment, PORT: '5000abc' }));
  assert.throws(() => parseEnvironment({ ...validEnvironment, CORS_ORIGIN: '*' }));
  assert.throws(() => parseEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/test' }));
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/dugun_ajansim',
    })
  );

  const productionEnvironment = parseEnvironment({
    ...validEnvironment,
    NODE_ENV: 'production',
    DATABASE_URL:
      'postgresql://app_user:guclu-bir-production-parolasi@db.example.com:5432/dugun_ajansim?sslmode=require',
  });
  assert.equal(productionEnvironment.NODE_ENV, 'production');
});

test('veritabanı healthcheck belirlenen sürede başarısız olur', async () => {
  const checker = createDatabaseConnectionChecker(
    () => new Promise(() => undefined),
    25,
    'test',
    () => undefined
  );
  const startedAt = Date.now();

  assert.equal(await checker(), false);
  assert.ok(Date.now() - startedAt < 250);
});

test('izin verilmeyen CORS origin operasyonel 403 hatası üretir', () => {
  let corsError: Error | null = null;

  validateCorsOrigin(['https://example.com'], 'https://attacker.example', (error) => {
    corsError = error;
  });

  assert.ok(corsError instanceof AppError);
  assert.equal(corsError.statusCode, 403);
  assert.equal(corsError.message.includes('attacker.example'), false);
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
  const logs: Record<string, unknown>[] = [];
  const handler = createGlobalErrorHandler('production', (entry) => logs.push(entry));

  handler(
    new Error('gizli sistem ayrıntısı'),
    {} as Request,
    mock.response,
    (() => undefined) as NextFunction
  );

  assert.equal(mock.getStatusCode(), 500);
  assert.equal(mock.getBody().message, 'Bir hata oluştu.');
  assert.equal('stack' in mock.getBody(), false);
  assert.equal(typeof mock.getBody().errorId, 'string');
  assert.equal(logs.length, 1);
  assert.equal('message' in logs[0], false);
  assert.equal('stack' in logs[0], false);
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

test('production ortamında operasyonel 500 hata ayrıntılarını da gizler', () => {
  const mock = createMockResponse();
  const handler = createGlobalErrorHandler('production', () => undefined);

  handler(
    new AppError('gizli veritabanı ayrıntısı', 500, true, [{ secret: 'gizli' }]),
    {} as Request,
    mock.response,
    (() => undefined) as NextFunction
  );

  assert.equal(mock.getStatusCode(), 500);
  assert.equal(mock.getBody().message, 'Bir hata oluştu.');
  assert.equal('errors' in mock.getBody(), false);
  assert.equal('stack' in mock.getBody(), false);
  assert.equal(typeof mock.getBody().errorId, 'string');
});

test('uncaught exception çalışan sunucuda güvenli kapanışı tetikler', () => {
  const calls: Array<{ signal: string; exitCode: number }> = [];
  const gracefulShutdown: GracefulShutdown = async (signal, exitCode) => {
    calls.push({ signal, exitCode });
  };
  const handler = createUncaughtExceptionHandler({
    getGracefulShutdown: () => gracefulShutdown,
    logFatalError: () => undefined,
    exit: (() => {
      throw new Error('process.exit çağrılmamalı');
    }) as (code: number) => never,
  });

  handler(new Error('beklenmeyen hata'));

  assert.deepEqual(calls, [{ signal: 'UNCAUGHT_EXCEPTION', exitCode: 1 }]);
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

test('request validator normalize edilmiş veriyi request üzerine yazar', async () => {
  const schema = z.object({
    body: z.object({ name: z.string().trim() }),
    query: z.object({ page: z.coerce.number().int() }),
    params: z.object({ id: z.string() }),
  });
  const middleware = validateRequest(schema);
  const request = {
    body: { name: '  Mustafa  ', ignored: true },
    query: { page: '2' },
    params: { id: 'abc' },
  } as unknown as Request;
  let nextCalled = false;

  await middleware(
    request,
    {} as Response,
    (() => {
      nextCalled = true;
    }) as NextFunction
  );

  assert.equal(nextCalled, true);
  assert.deepEqual(request.body, { name: 'Mustafa' });
  assert.deepEqual(request.query, { page: 2 });
  assert.deepEqual(request.params, { id: 'abc' });
});

test('başlangıç yapılandırma hatası port açılmadan kontrollü biçimde sonlanır', () => {
  const result = spawnSync(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: 'geçersiz',
      DATABASE_URL:
        'postgresql://app_user:guclu-bir-production-parolasi@db.example.com:5432/dugun_ajansim?sslmode=require',
    },
    encoding: 'utf8',
    timeout: 5_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /STARTUP ERROR/);
  assert.doesNotMatch(result.stderr, /ZodError|at file:/);
});

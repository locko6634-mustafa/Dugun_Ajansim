import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { parseEnvironment } from '../src/config/env.config.js';
import {
  createDatabaseConnectionChecker,
  createPrismaDatabaseHealthQuery,
} from '../src/config/prisma.js';
import { createSystemHealthHandler } from '../src/controllers/health.controller.js';
import { createGlobalErrorHandler } from '../src/middlewares/error.middleware.js';
import { validateCorsOrigin } from '../src/middlewares/security.middleware.js';
import { validateRequest } from '../src/middlewares/validate.middleware.js';
import { AppError } from '../src/utils/appError.js';
import {
  createGracefulShutdown,
  createUncaughtExceptionHandler,
} from '../src/utils/processLifecycle.js';
import type { GracefulShutdown } from '../src/utils/processLifecycle.js';

const validEnvironment: NodeJS.ProcessEnv = {
  PORT: '5000',
  NODE_ENV: 'test',
  CORS_ORIGIN: 'http://localhost:3000/,https://example.com',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/dugun_ajansim',
  TRUST_PROXY: '0',
  HEALTHCHECK_TIMEOUT_MS: '3000',
  DATA_ENCRYPTION_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const createMockResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const headers = new Map<string, string>();

  const response = {
    set(field: string, value: string) {
      headers.set(field.toLowerCase(), value);
      return response;
    },
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
    getHeader: (field: string) => headers.get(field.toLowerCase()),
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
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://app_user:a@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    })
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://app_user:aaaaaaaaaaaaaaaaaaaaaaaa@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    })
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require',
    })
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict&sslmode=disable',
    })
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://uzun_production_user_2026:uzun_production_user_2026@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    })
  );

  const productionEnvironment = parseEnvironment({
    ...validEnvironment,
    NODE_ENV: 'production',
    DATABASE_URL:
      'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
  });
  assert.equal(productionEnvironment.NODE_ENV, 'production');
});

test('veritabanı healthcheck Prisma timeout kullanır ve eşzamanlı sorguları tekilleştirir', async () => {
  let transactionCalls = 0;
  let transactionOptions: { maxWait: number; timeout: number } | undefined;
  const client = {
    $transaction: async (
      _callback: unknown,
      options: { maxWait: number; timeout: number }
    ): Promise<never> => {
      transactionCalls += 1;
      transactionOptions = options;
      await new Promise((resolve) => setImmediate(resolve));
      throw new Error('QUERY_TIMEOUT');
    },
  } as unknown as PrismaClient;
  const checker = createDatabaseConnectionChecker(
    createPrismaDatabaseHealthQuery(client, 250),
    'test',
    () => undefined
  );

  const firstCheck = checker();
  const secondCheck = checker();

  assert.strictEqual(firstCheck, secondCheck);
  assert.deepEqual(await Promise.all([firstCheck, secondCheck]), [false, false]);
  assert.equal(transactionCalls, 1);
  assert.deepEqual(transactionOptions, { maxWait: 250, timeout: 250 });

  assert.equal(await checker(), false);
  assert.equal(transactionCalls, 2);
});

test('başarılı healthcheck Prisma transaction içinden SELECT 1 çalıştırır', async () => {
  let rawQueryCalls = 0;
  const client = {
    $transaction: async (
      callback: (transaction: { $queryRaw: (query: TemplateStringsArray) => Promise<number> }) => Promise<unknown>,
      options: { maxWait: number; timeout: number }
    ): Promise<unknown> => {
      assert.deepEqual(options, { maxWait: 500, timeout: 500 });
      return callback({
        $queryRaw: async () => {
          rawQueryCalls += 1;
          return 1;
        },
      });
    },
  } as unknown as PrismaClient;
  const checker = createDatabaseConnectionChecker(
    createPrismaDatabaseHealthQuery(client, 500),
    'test',
    () => undefined
  );

  assert.equal(await checker(), true);
  assert.equal(rawQueryCalls, 1);
});

test('izin verilmeyen CORS origin operasyonel 403 hatası üretir', () => {
  let corsError: unknown;

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
  assert.equal(mock.getHeader('Cache-Control'), 'no-store');
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

test('status taşıyan fakat expose edilmeyen hata production ayrıntılarını gizler', () => {
  const mock = createMockResponse();
  const logs: Record<string, unknown>[] = [];
  const handler = createGlobalErrorHandler('production', (entry) => logs.push(entry));
  const error = Object.assign(new Error('gizli framework ayrıntısı'), { status: 400 });

  handler(
    error,
    {} as Request,
    mock.response,
    (() => undefined) as NextFunction
  );

  assert.equal(mock.getStatusCode(), 400);
  assert.equal(mock.getBody().message, 'Bir hata oluştu.');
  assert.equal(typeof mock.getBody().errorId, 'string');
  assert.equal(logs.length, 1);
  assert.equal('message' in logs[0], false);
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

test('uncaught exception çalışan sunucuda asenkron güvenli kapanışı tetikler', async () => {
  const calls: Array<{ signal: string; exitCode: number }> = [];
  let completeShutdown: (() => void) | undefined;
  const shutdownCompleted = new Promise<void>((resolve) => {
    completeShutdown = resolve;
  });
  const gracefulShutdown: GracefulShutdown = async (signal, exitCode) => {
    await Promise.resolve();
    calls.push({ signal, exitCode });
    completeShutdown?.();
  };
  const handler = createUncaughtExceptionHandler({
    getGracefulShutdown: () => gracefulShutdown,
    logFatalError: () => undefined,
    exit: (() => {
      throw new Error('process.exit çağrılmamalı');
    }) as (code: number) => never,
  });

  handler(new Error('beklenmeyen hata'));

  await shutdownCompleted;
  assert.deepEqual(calls, [{ signal: 'UNCAUGHT_EXCEPTION', exitCode: 1 }]);
});

test('güvenli kapanış kaynakları bir kez kapatır ve yinelenen sinyalleri tekilleştirir', async () => {
  let closeCalls = 0;
  let disconnectCalls = 0;
  const exitCodes: number[] = [];
  const shutdown = createGracefulShutdown({
    closeHttpServer: async () => {
      closeCalls += 1;
    },
    forceCloseHttpConnections: () => {
      throw new Error('zorunlu kapanış çağrılmamalı');
    },
    disconnectDatabase: async () => {
      disconnectCalls += 1;
    },
    logInfo: () => undefined,
    logError: () => undefined,
    timeoutMs: 1_000,
    exit: (code) => {
      exitCodes.push(code);
    },
  });

  const firstShutdown = shutdown('SIGTERM', 0);
  const secondShutdown = shutdown('SIGINT', 0);

  assert.strictEqual(firstShutdown, secondShutdown);
  await firstShutdown;
  assert.equal(closeCalls, 1);
  assert.equal(disconnectCalls, 1);
  assert.deepEqual(exitCodes, [0]);
});

test('kapanış zaman aşımı tek disconnect ile kesin olarak hata kodu döndürür', async () => {
  let forceCloseCalls = 0;
  let disconnectCalls = 0;
  const exitCodes: number[] = [];
  const shutdown = createGracefulShutdown({
    closeHttpServer: async () => undefined,
    forceCloseHttpConnections: () => {
      forceCloseCalls += 1;
    },
    disconnectDatabase: () => {
      disconnectCalls += 1;
      return new Promise<void>(() => undefined);
    },
    logInfo: () => undefined,
    logError: () => undefined,
    timeoutMs: 10,
    hardExitTimeoutMs: 10,
    exit: (code) => {
      exitCodes.push(code);
    },
  });

  await shutdown('SIGTERM', 0);
  assert.equal(forceCloseCalls, 1);
  assert.equal(disconnectCalls, 1);
  assert.deepEqual(exitCodes, [1]);
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
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    },
    encoding: 'utf8',
    timeout: 5_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /STARTUP ERROR/);
  assert.doesNotMatch(result.stderr, /ZodError|at file:/);
});

test('Express güvenlik zinciri Helmet, CORS ve HPP davranışlarını uygular', async () => {
  const integrationApp = createApp((application) => {
    application.get('/api/test', (req, res) => {
      res.json({ query: req.query });
    });
  });
  const response = await request(integrationApp)
    .get('/api/test?tag=ilk&tag=son')
    .set('Origin', 'http://localhost:3000');

  assert.equal(response.status, 200);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.body.query.tag, 'son');
});

test('Express güvenlik zinciri izinsiz origin ve büyük body isteğini reddeder', async () => {
  const integrationApp = createApp((application) => {
    application.post('/api/test', (req, res) => {
      res.json({ body: req.body });
    });
  });
  const blockedCorsResponse = await request(integrationApp)
    .post('/api/test')
    .set('Origin', 'https://attacker.example')
    .send({ value: 'güvenli' });
  const oversizedBodyResponse = await request(integrationApp)
    .post('/api/test')
    .set('Origin', 'http://localhost:3000')
    .send({ value: 'x'.repeat(11_000) });

  assert.equal(blockedCorsResponse.status, 403);
  assert.equal(oversizedBodyResponse.status, 413);
  assert.equal(oversizedBodyResponse.body.success, false);
});

test('404 yanıtı query string içeriğini yansıtmaz', async () => {
  const integrationApp = createApp(() => undefined);
  const response = await request(integrationApp)
    .get('/api/bilinmeyen?token=gizli-deger')
    .set('Origin', 'http://localhost:3000');

  assert.equal(response.status, 404);
  assert.equal(response.body.message.includes('gizli-deger'), false);
});

test('genel rate limiter CORS tarafından reddedilen 101. API isteğini de engeller', async () => {
  const integrationApp = createApp((application) => {
    application.get('/api/test', (_req, res) => {
      res.json({ success: true });
    });
  });
  let response: request.Response | undefined;

  for (let requestIndex = 0; requestIndex < 101; requestIndex += 1) {
    response = await request(integrationApp)
      .get('/api/test')
      .set('Origin', 'https://attacker.example');
  }

  assert.equal(response?.status, 429);
  assert.equal(response?.body.success, false);
});

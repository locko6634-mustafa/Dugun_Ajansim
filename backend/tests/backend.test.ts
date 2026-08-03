import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { parseEnvironment } from '../src/config/env.config.js';
import {
  createDatabaseConnectionChecker,
  createPrismaDatabaseHealthQuery,
} from '../src/config/prisma.js';
import { createSystemHealthHandler } from '../src/controllers/health.controller.js';
import {
  calculateSessionTouchIntervalMs,
  getSessionAbsoluteTtlMs,
  getSessionIdleTimeoutMs,
  getSessionTouchIntervalMs,
  isTemporaryPasswordExpired,
} from '../src/middlewares/auth.middleware.js';
import { createGlobalErrorHandler } from '../src/middlewares/error.middleware.js';
import {
  createRateLimitHandler,
  normalizeRateLimitIp,
  rateLimitKeyGenerator,
} from '../src/middlewares/rateLimit.middleware.js';
import { attachRequestContext } from '../src/middlewares/requestContext.middleware.js';
import { validateCorsOrigin } from '../src/middlewares/security.middleware.js';
import { validateRequest } from '../src/middlewares/validate.middleware.js';
import { AppError } from '../src/utils/appError.js';
import { decryptValue, encryptValue } from '../src/utils/crypto.js';
import { createFailedLoginSecurityEvent } from '../src/utils/securityLogger.js';
import { cleanupStaleSessions } from '../src/utils/sessionMaintenance.js';
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
const validProductionEncryptionKey =
  '7d9f3c1a5e8b2d4f6a0c9e7b3d1f5a8c2e4b6d0f9a7c3e1b5d8f2a4c6e0b9d7f';

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
  assert.equal(parsed.ADMIN_SESSION_IDLE_MINUTES, 30);
  assert.equal(parsed.CUSTOMER_SESSION_IDLE_HOURS, 12);
  assert.equal(parsed.TEMPORARY_PASSWORD_TTL_HOURS, 72);
  assert.throws(() => parseEnvironment({ ...validEnvironment, PORT: '5000abc' }));
  assert.throws(() => parseEnvironment({ ...validEnvironment, CORS_ORIGIN: '*' }));
  assert.throws(() =>
    parseEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/test' }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      SESSION_COOKIE_NAME: 'dugunajansim_csrf',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      TEMPORARY_PASSWORD_TTL_HOURS: '169',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/dugun_ajansim',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://app_user:a@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://app_user:aaaaaaaaaaaaaaaaaaaaaaaa@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict&sslmode=disable',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://uzun_production_user_2026:uzun_production_user_2026@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    }),
  );

  const productionEnvironment = parseEnvironment({
    ...validEnvironment,
    NODE_ENV: 'production',
    TRUST_PROXY: '172.30.0.2',
    DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
    DATABASE_URL:
      'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
  });
  assert.equal(productionEnvironment.NODE_ENV, 'production');
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '0',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    }),
  );
  const allowlistedProxyEnvironment = parseEnvironment({
    ...validEnvironment,
    NODE_ENV: 'production',
    TRUST_PROXY: '172.30.0.2',
    DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
    DATABASE_URL:
      'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
  });
  assert.deepEqual(allowlistedProxyEnvironment.TRUST_PROXY, ['172.30.0.2']);

  const privateDockerEnvironment = parseEnvironment({
    ...validEnvironment,
    NODE_ENV: 'production',
    TRUST_PROXY: '172.30.0.2',
    DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
    ALLOW_PRIVATE_DATABASE_WITHOUT_TLS: 'true',
    DATABASE_URL:
      'postgresql://app_user:Guclu-Production-Parolasi-2026%21@postgres:5432/dugun_ajansim?sslmode=disable',
  });
  assert.equal(privateDockerEnvironment.ALLOW_PRIVATE_DATABASE_WITHOUT_TLS, true);
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      ALLOW_PRIVATE_DATABASE_WITHOUT_TLS: 'true',
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=disable',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
      DATABASE_URL:
        'postgresql://app_user:Degistir-Guclu-Production-Parolasi-2026@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      TRUST_PROXY: '172.30.0.2',
      DATA_ENCRYPTION_KEY: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      DATABASE_URL:
        'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
    }),
  );
});

test('rol bazlı oturum süreleri ayrı uygulanır ve ayrıcalıklı rollerde remember yok sayılır', () => {
  assert.equal(getSessionIdleTimeoutMs('ADMIN'), 30 * 60 * 1000);
  assert.equal(getSessionIdleTimeoutMs('SALON_YETKILISI'), 30 * 60 * 1000);
  assert.equal(getSessionIdleTimeoutMs('MUSTERI'), 12 * 60 * 60 * 1000);
  assert.equal(getSessionAbsoluteTtlMs('ADMIN', true), getSessionAbsoluteTtlMs('ADMIN', false));
  assert.equal(
    getSessionAbsoluteTtlMs('SALON_YETKILISI', true),
    getSessionAbsoluteTtlMs('SALON_YETKILISI', false),
  );
  assert.ok(getSessionAbsoluteTtlMs('MUSTERI', true) > getSessionAbsoluteTtlMs('MUSTERI', false));
  assert.ok(getSessionTouchIntervalMs('ADMIN') < getSessionIdleTimeoutMs('ADMIN'));
  assert.ok(getSessionTouchIntervalMs('MUSTERI') < getSessionIdleTimeoutMs('MUSTERI'));
  assert.equal(calculateSessionTouchIntervalMs(5 * 60 * 1000), 2.5 * 60 * 1000);
});

test('geçici parola için boş veya geçmiş süre güvenli biçimde geçersiz sayılır', () => {
  const now = new Date('2026-07-30T12:00:00.000Z');

  assert.equal(
    isTemporaryPasswordExpired({ mustChangePassword: true, temporaryPasswordExpiresAt: null }, now),
    true,
  );
  assert.equal(
    isTemporaryPasswordExpired(
      {
        mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date('2026-07-30T11:59:59.999Z'),
      },
      now,
    ),
    true,
  );
  assert.equal(
    isTemporaryPasswordExpired(
      {
        mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date('2026-07-30T12:00:00.001Z'),
      },
      now,
    ),
    false,
  );
  assert.equal(
    isTemporaryPasswordExpired(
      { mustChangePassword: false, temporaryPasswordExpiresAt: null },
      now,
    ),
    false,
  );
});

test('başarısız giriş güvenlik kaydı yalnız sabit ve kişisel veri içermeyen alanlar taşır', () => {
  const entry = createFailedLoginSecurityEvent(
    'corr_12345678',
    new Date('2026-07-30T12:00:00.000Z'),
  );

  assert.deepEqual(entry, {
    level: 'warn',
    event: 'auth_login_failed',
    timestamp: '2026-07-30T12:00:00.000Z',
    correlationId: 'corr_12345678',
    reasonCode: 'INVALID_CREDENTIALS',
  });
  assert.deepEqual(Object.keys(entry).sort(), [
    'correlationId',
    'event',
    'level',
    'reasonCode',
    'timestamp',
  ]);
  assert.equal(createFailedLoginSecurityEvent('geçersiz\nkimlik').correlationId, 'unavailable');
});

test('oturum temizliği yalnız 30 günden eski kayıtları ve en fazla 100 kimliği siler', async () => {
  const calls: {
    find?: Record<string, unknown>;
    deletedIds?: string[];
  } = {};
  const client = {
    authSession: {
      findMany: async (args: Record<string, unknown>) => {
        calls.find = args;
        return Array.from({ length: 100 }, (_, index) => ({ id: `session-${index}` }));
      },
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        calls.deletedIds = args.where.id.in;
        return { count: args.where.id.in.length };
      },
    },
  };
  const cleaned = await cleanupStaleSessions(client as never, new Date('2026-07-30T12:00:00.000Z'));

  assert.equal(cleaned, 100);
  assert.equal(calls.deletedIds?.length, 100);
  assert.equal((calls.find as { take: number }).take, 100);
  assert.deepEqual(
    (
      calls.find as {
        where: { OR: Array<Record<string, { lt: Date }>> };
      }
    ).where.OR.map((condition) => Object.values(condition)[0].lt.toISOString()),
    ['2026-06-30T12:00:00.000Z', '2026-06-30T12:00:00.000Z'],
  );
});

test('AES-256-GCM yalnız 12 bayt IV, 16 bayt tag ve doğru AAD bağlamını kabul eder', () => {
  const encrypted = encryptValue('https://drive.google.com/file/d/test', 'MessageTask:test-id');

  assert.equal(Buffer.from(encrypted.iv, 'base64').length, 12);
  assert.equal(Buffer.from(encrypted.authTag, 'base64').length, 16);
  assert.equal(
    decryptValue(encrypted, 'MessageTask:test-id'),
    'https://drive.google.com/file/d/test',
  );
  assert.throws(() => decryptValue(encrypted, 'MessageTask:farkli-id'));
  assert.throws(() => decryptValue(encrypted));
  assert.throws(() =>
    decryptValue(
      {
        ...encrypted,
        authTag: Buffer.from(encrypted.authTag, 'base64').subarray(0, 12).toString('base64'),
      },
      'MessageTask:test-id',
    ),
  );
  assert.throws(() =>
    decryptValue({ ...encrypted, iv: `${encrypted.iv}=` }, 'MessageTask:test-id'),
  );
});

test('veritabanı healthcheck Prisma timeout kullanır ve eşzamanlı sorguları tekilleştirir', async () => {
  let transactionCalls = 0;
  let transactionOptions: { maxWait: number; timeout: number } | undefined;
  const client = {
    $transaction: async (
      _callback: unknown,
      options: { maxWait: number; timeout: number },
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
    () => undefined,
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
      callback: (transaction: {
        $queryRaw: (query: TemplateStringsArray) => Promise<number>;
      }) => Promise<unknown>,
      options: { maxWait: number; timeout: number },
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
    () => undefined,
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
  const handler = createSystemHealthHandler(
    async () => false,
    'production',
    () => 42,
  );

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
  const handler = createSystemHealthHandler(
    async () => true,
    'development',
    () => 42,
  );

  await handler({} as Request, mock.response, (() => undefined) as NextFunction);

  assert.equal(mock.getStatusCode(), 200);
  assert.equal(mock.getBody().environment, 'development');
  assert.equal(mock.getBody().uptime, 42);
});

test('production hata yanıtı beklenmeyen hata ayrıntılarını gizler', () => {
  const mock = createMockResponse();
  const logs: Record<string, unknown>[] = [];
  const handler = createGlobalErrorHandler('production', (entry) => logs.push(entry));
  const sensitiveMarker = 'SENSITIVE-MARKER-DO-NOT-LOG';

  handler(
    new Error(
      `password=${sensitiveMarker} token=${sensitiveMarker} https://user:${sensitiveMarker}@example.test/private`,
    ),
    {
      correlationId: 'corr_12345678',
      method: 'GET',
      baseUrl: '/api/v1/admin',
      route: { path: '/customers/:id/reset-password' },
      path: `/api/v1/admin/customers/${sensitiveMarker}/reset-password`,
    } as Request,
    mock.response,
    (() => undefined) as NextFunction,
  );

  assert.equal(mock.getStatusCode(), 500);
  assert.equal(mock.getBody().message, 'Bir hata oluştu.');
  assert.equal('stack' in mock.getBody(), false);
  assert.equal(typeof mock.getBody().errorId, 'string');
  assert.equal(mock.getHeader('Cache-Control'), 'no-store');
  assert.equal(logs.length, 1);
  assert.equal('message' in logs[0], false);
  assert.equal('stack' in logs[0], false);
  assert.equal(logs[0].diagnostic, 'unexpected_error');
  assert.equal(logs[0].correlationId, 'corr_12345678');
  assert.equal(logs[0].path, '/api/v1/admin/customers/:id/reset-password');
  assert.ok(Array.isArray(logs[0].stackFrames));
  assert.equal(JSON.stringify(logs[0]).includes(sensitiveMarker), false);
  assert.equal(JSON.stringify(logs[0]).includes('/private'), false);
});

test('status taşıyan fakat expose edilmeyen hata production ayrıntılarını gizler', () => {
  const mock = createMockResponse();
  const logs: Record<string, unknown>[] = [];
  const handler = createGlobalErrorHandler('production', (entry) => logs.push(entry));
  const error = Object.assign(new Error('gizli framework ayrıntısı'), { status: 400 });

  handler(error, {} as Request, mock.response, (() => undefined) as NextFunction);

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
    (() => undefined) as NextFunction,
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
    (() => undefined) as NextFunction,
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
    }) as NextFunction,
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
    }) as NextFunction,
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
      TRUST_PROXY: '172.30.0.2',
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

test('IPv6 rate-limit anahtarı /56 ağında gruplanır ve IPv4-mapped adresi normalleştirir', () => {
  assert.equal(
    normalizeRateLimitIp('2001:db8:abcd:1200::1'),
    normalizeRateLimitIp('2001:db8:abcd:12ff:ffff::1'),
  );
  assert.notEqual(
    normalizeRateLimitIp('2001:db8:abcd:1200::1'),
    normalizeRateLimitIp('2001:db8:abcd:1300::1'),
  );
  assert.equal(normalizeRateLimitIp('::ffff:192.0.2.128'), '192.0.2.128');
  assert.equal(normalizeRateLimitIp('192.0.2.128'), '192.0.2.128');
  assert.equal(normalizeRateLimitIp('geçersiz'), 'invalid-ip');
});

test('gerçek rate limiter aynı IPv6 /56 ağındaki adreslerle limit aşımını engeller', async () => {
  const integrationApp = express();
  integrationApp.set('trust proxy', true);
  integrationApp.use(attachRequestContext);
  integrationApp.use(
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: rateLimitKeyGenerator,
      handler: createRateLimitHandler('Çok fazla istek gönderdiniz.'),
      validate: { trustProxy: false },
    }),
  );
  integrationApp.get('/test', (_req, res) => {
    res.json({ success: true });
  });

  for (let requestIndex = 0; requestIndex < 5; requestIndex += 1) {
    const response = await request(integrationApp)
      .get('/test')
      .set('X-Forwarded-For', `2001:db8:abcd:12${requestIndex}0::1`);
    assert.equal(response.status, 200);
  }

  const blockedResponse = await request(integrationApp)
    .get('/test')
    .set('X-Forwarded-For', '2001:db8:abcd:12ff::1');
  const independentNetworkResponse = await request(integrationApp)
    .get('/test')
    .set('X-Forwarded-For', '2001:db8:abcd:1300::1');

  assert.equal(blockedResponse.status, 429);
  assert.equal(blockedResponse.body.statusCode, 429);
  assert.equal(typeof blockedResponse.body.correlationId, 'string');
  assert.equal(blockedResponse.headers['cache-control'], 'no-store');
  assert.equal(independentNetworkResponse.status, 200);
});

test('public başvuru limiter IPv6 /56 ağını tek istemci sayar ve ortak 429 sözleşmesini döndürür', async () => {
  const app = createApp();
  app.set('trust proxy', 1);

  for (let index = 0; index < 10; index += 1) {
    const response = await request(app)
      .post('/api/v1/booking-applications')
      .set('X-Forwarded-For', `2001:db8:abcd:${(0x1200 + index).toString(16)}::1`)
      .send({});
    assert.equal(response.status, 400);
  }

  const limited = await request(app)
    .post('/api/v1/booking-applications')
    .set('X-Forwarded-For', '2001:db8:abcd:120a::1')
    .send({});
  assert.equal(limited.status, 429);
  assert.equal(limited.body.success, false);
  assert.equal(limited.body.statusCode, 429);
  assert.equal(typeof limited.body.correlationId, 'string');
  assert.equal(limited.headers['cache-control'], 'no-store');
});

test('CORS preflight CSRF, idempotency ve correlation başlıklarına izin verir', async () => {
  const integrationApp = createApp((application) => {
    application.post('/api/test', (_req, res) => {
      res.json({ success: true });
    });
  });
  const response = await request(integrationApp)
    .options('/api/test')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'x-csrf-token,idempotency-key,x-correlation-id');

  assert.equal(response.status, 204);
  const allowedHeaders = String(response.headers['access-control-allow-headers']).toLowerCase();
  assert.ok(allowedHeaders.includes('x-csrf-token'));
  assert.ok(allowedHeaders.includes('idempotency-key'));
  assert.ok(allowedHeaders.includes('x-correlation-id'));
  assert.equal(String(response.headers['access-control-allow-methods']).includes('PUT'), false);
});

test('bozuk cookie auth endpointini 500 hatasına düşürmez ve cookie temizler', async () => {
  const response = await request(createApp())
    .get('/api/v1/auth/session')
    .set('Cookie', 'dugunajansim_session=%ZZ; unrelated=value');

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(
    (response.headers['set-cookie'] as unknown as string[]).some((cookie) =>
      cookie.startsWith('dugunajansim_session='),
    ),
  );
});

test('yinelenen session cookie HTTP parameter pollution olarak reddedilir', async () => {
  const response = await request(createApp())
    .get('/api/v1/auth/session')
    .set('Cookie', 'dugunajansim_session=ilk; dugunajansim_session=ikinci');

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.headers['cache-control'], 'no-store');
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

test('404 yanıtı path ve query string içeriğini yansıtmaz', async () => {
  const integrationApp = createApp(() => undefined);
  const response = await request(integrationApp)
    .get('/api/gizli-path-degeri?token=gizli-query-degeri')
    .set('Origin', 'http://localhost:3000');

  assert.equal(response.status, 404);
  assert.equal(response.body.message.includes('gizli-path-degeri'), false);
  assert.equal(response.body.message.includes('gizli-query-degeri'), false);
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
  assert.equal(response?.body.status, 'error');
  assert.equal(response?.body.statusCode, 429);
  assert.equal(typeof response?.body.correlationId, 'string');
  assert.equal(response?.headers['cache-control'], 'no-store');
});

test('tüm GET rotaları tanım dışı query parametrelerini 400 ile reddeder', async () => {
  const integrationApp = createApp();
  const response = await request(integrationApp)
    .get('/api/v1/catalog?bilinmeyenParametre=1')
    .set('Origin', 'http://localhost:3000');

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, 'Girdi doğrulama hatası');
});

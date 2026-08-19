import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeTest from 'node:test';
import type { PrismaClient } from '@prisma/client';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import sharp from 'sharp';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { parseEnvironment } from '../src/config/env.config.js';
import { loadFileBackedSecrets } from '../src/config/fileSecrets.js';
import { isSuccessfulLoginAttempt } from '../src/routes/auth.routes.js';
import {
  availabilityRequestSchema,
  PAYMENT_FLOW_COOKIE_NAME,
  paymentFlowCookieOptions,
} from '../src/routes/public.routes.js';
import {
  createDatabaseConnectionChecker,
  createPrismaDatabaseHealthQuery,
} from '../src/config/prisma.js';
import { createSystemHealthHandler } from '../src/controllers/health.controller.js';
import {
  ADMIN_STEP_UP_TTL_MS,
  calculateSessionTouchIntervalMs,
  csrfCookieOptions,
  getSessionAbsoluteTtlMs,
  getSessionIdleTimeoutMs,
  getSessionTouchIntervalMs,
  isMfaEnrollmentRequired,
  isMfaRequiredRole,
  isAdminStepUpFresh,
  isTemporaryPasswordExpired,
  sessionCookieOptions,
} from '../src/middlewares/auth.middleware.js';
import {
  adminStepUpBodySchema,
  montageUserBodySchema,
  montageUserUpdateBodySchema,
  permanentDeleteBodySchema,
} from '../src/schemas/api.schemas.js';
import { createGlobalErrorHandler } from '../src/middlewares/error.middleware.js';
import { hashRateLimitKey } from '../src/middlewares/databaseRateLimitStore.js';
import {
  createRateLimitHandler,
  loginAccountRateLimitKeyGenerator,
  normalizeRateLimitIp,
  rateLimitKeyGenerator,
} from '../src/middlewares/rateLimit.middleware.js';
import { attachRequestContext } from '../src/middlewares/requestContext.middleware.js';
import { validateCorsOrigin } from '../src/middlewares/security.middleware.js';
import { validateRequest } from '../src/middlewares/validate.middleware.js';
import { AppError } from '../src/utils/appError.js';
import { deriveRlsContext } from '../src/utils/asyncHandler.js';
import { writeAuditLog } from '../src/utils/audit.js';
import {
  createBookingFingerprintCryptography,
  bookingFingerprintNeedsRepair,
  serializeBookingFingerprintPayload,
} from '../src/utils/booking-fingerprint.js';
import { decryptValue, encryptValue, encryptValueWithKey } from '../src/utils/crypto.js';
import { createDeliveryCryptography } from '../src/utils/delivery-crypto.js';
import {
  buildRetentionCutoffs,
  countRetentionDeletes,
  runDataRetentionBatch,
} from '../src/utils/dataRetention.js';
import { findBoundedIntervalConflicts } from '../src/utils/intervalConflicts.js';
import { verifyDeliveryLinkAccess } from '../src/utils/delivery-link-access.js';
import { decodeListCursor, encodeListCursor } from '../src/utils/pagination.js';
import {
  BOOKING_APPLICATION_PII_SCHEMA_VERSION,
  assertPiiWriteAllowed,
  bookingApplicationLegacyPiiMatches,
  bookingApplicationWithDecryptedPii,
  buildStaffPiiData,
  createPiiCryptography,
  decryptBookingApplicationPii,
  decryptStaffPii,
  encryptBookingApplicationPii,
  messageTaskLegacyPiiMatches,
  staffLegacyPiiMatches,
  staffWithDecryptedPii,
  weddingLegacyPiiMatches,
} from '../src/utils/pii-crypto.js';
import { createFailedLoginSecurityEvent } from '../src/utils/securityLogger.js';
import {
  readStaffPhoto,
  removeStaffPhoto,
  storeStaffPhoto,
} from '../src/services/staff-photo.service.js';
import { cleanupStaleSessions } from '../src/utils/sessionMaintenance.js';
import {
  createTotpEnrollmentUri,
  createTotpSecret,
  findMatchingTotpStep,
  generateTotpCode,
  totpEncryptionAad,
} from '../src/utils/totp.js';
import {
  DAILY_MFA_TTL_MS,
  describeDevice,
  readTrustedDeviceToken,
  TRUSTED_DEVICE_TTL_MS,
  userAgentHash,
} from '../src/utils/trustedDevice.js';
import {
  createGracefulShutdown,
  createUncaughtExceptionHandler,
} from '../src/utils/processLifecycle.js';
import type { GracefulShutdown } from '../src/utils/processLifecycle.js';
import {
  assertBookingBotProtectionConfigured,
  verifyBookingBotChallenge,
} from '../src/utils/turnstile.js';

const test: typeof nodeTest = ((name: string, ...args: unknown[]) =>
  nodeTest(`[backend-unit] ${name}`, ...(args as [never]))) as typeof nodeTest;
const authTest: typeof nodeTest = ((name: string, ...args: unknown[]) =>
  nodeTest(`[backend-unit] [auth] ${name}`, ...(args as [never]))) as typeof nodeTest;

const validEnvironment: NodeJS.ProcessEnv = {
  PORT: '5000',
  NODE_ENV: 'test',
  CORS_ORIGIN: 'http://localhost:3000/,https://example.com',
  BOT_PROTECTION_MODE: 'turnstile',
  TURNSTILE_SITE_KEY: 'test-site-key',
  TURNSTILE_SECRET_KEY: 'test-secret-key',
  TURNSTILE_EXPECTED_HOSTNAME: 'example.com',
  TURNSTILE_VERIFY_TIMEOUT_MS: '5000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/dugun_ajansim',
  TRUST_PROXY: '0',
  HEALTHCHECK_TIMEOUT_MS: '3000',
  HTTP_REQUEST_TIMEOUT_MS: '15000',
  HTTP_HEADERS_TIMEOUT_MS: '10000',
  HTTP_KEEP_ALIVE_TIMEOUT_MS: '5000',
  DATA_ENCRYPTION_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  DATA_ENCRYPTION_ACTIVE_KEY_ID: 'active-2026',
  DATA_ENCRYPTION_KEYRING_JSON:
    '{"active-2026":"7d9f3c1a5e8b2d4f6a0c9e7b3d1f5a8c2e4b6d0f9a7c3e1b5d8f2a4c6e0b9d7f"}',
  PII_BLIND_INDEX_KEY: 'b6d18a03f74ce9521a6b8d309f5e7c124a8d60f3b91e5c72d4a09b6e38f157c2',
  PII_BLIND_INDEX_ACTIVE_KEY_ID: 'blind-active-2026',
  PII_BLIND_INDEX_KEYRING_JSON:
    '{"blind-active-2026":"b6d18a03f74ce9521a6b8d309f5e7c124a8d60f3b91e5c72d4a09b6e38f157c2"}',
  RATE_LIMIT_HMAC_KEY: 'c7e29b14a85df0632b7c9e401a6f8d235b9e71c4a02d6f83e5b1a9c60d347f28',
  PII_ENCRYPTION_MODE: 'strict',
};
const validProductionEncryptionKey =
  '7d9f3c1a5e8b2d4f6a0c9e7b3d1f5a8c2e4b6d0f9a7c3e1b5d8f2a4c6e0b9d7f';

authTest('login kotası yalnız tam MFA dahil başarılı oturumu sayaçtan düşer', () => {
  const requestStub = {} as Request;

  assert.equal(isSuccessfulLoginAttempt(requestStub, { statusCode: 200 } as Response), true);
  assert.equal(isSuccessfulLoginAttempt(requestStub, { statusCode: 401 } as Response), false);
  assert.equal(isSuccessfulLoginAttempt(requestStub, { statusCode: 429 } as Response), false);
});

authTest('production oturum ve CSRF cookie bayrakları güvenli kalır', () => {
  assert.deepEqual(sessionCookieOptions(60_000, 'production'), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60_000,
  });
  assert.deepEqual(csrfCookieOptions(60_000, 'production'), {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60_000,
  });
  assert.equal(PAYMENT_FLOW_COOKIE_NAME, 'dugunajansim_payment_flow');
  assert.deepEqual(paymentFlowCookieOptions(60_000, 'production'), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/v1/booking-applications',
    maxAge: 60_000,
  });
});

authTest('yönetici adım-yükseltme süresi yalnız son beş dakikayı kabul eder', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');

  assert.equal(isAdminStepUpFresh(null, now), false);
  assert.equal(isAdminStepUpFresh(new Date(now.valueOf() + 1), now), false);
  assert.equal(isAdminStepUpFresh(now, now), true);
  assert.equal(isAdminStepUpFresh(new Date(now.valueOf() - ADMIN_STEP_UP_TTL_MS + 1), now), true);
  assert.equal(isAdminStepUpFresh(new Date(now.valueOf() - ADMIN_STEP_UP_TTL_MS), now), false);
});

authTest('adım-yükseltme ve doğrudan silme gövdeleri katı doğrulanır', () => {
  assert.deepEqual(
    adminStepUpBodySchema.parse({ currentPassword: 'guvenli-parola', totpCode: '123456' }),
    { currentPassword: 'guvenli-parola', totpCode: '123456' },
  );
  assert.equal(
    adminStepUpBodySchema.safeParse({
      currentPassword: 'guvenli-parola',
      totpCode: '123456',
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    permanentDeleteBodySchema.safeParse({ confirmText: 'Mini Paket', reason: 'çok kısa' }).success,
    false,
  );
  assert.deepEqual(permanentDeleteBodySchema.parse({}), {});
});

authTest('oturum bootstrap RLS bağlamı yalnız açık authenticate seçeneğiyle etkinleşir', () => {
  const protectedRequest = {
    baseUrl: '/api/v1/admin',
    originalUrl: '/api/v1/admin/venue-managers',
    get: () => undefined,
  } as unknown as Request;

  assert.equal(deriveRlsContext(protectedRequest).actorRole, 'public');
  assert.equal(
    deriveRlsContext(protectedRequest, { unauthenticatedActorRole: 'auth' }).actorRole,
    'auth',
  );

  protectedRequest.auth = {
    userId: '00000000-0000-4000-8000-000000000001',
    username: 'runtime-admin',
    role: 'ADMIN',
    sessionId: '00000000-0000-4000-8000-000000000002',
    mustChangePassword: false,
    mfaEnabled: true,
    mfaVerified: true,
    adminStepUpVerifiedAt: null,
    mustEnrollMfa: false,
    venueId: null,
  };

  const authenticatedContext = deriveRlsContext(protectedRequest, {
    unauthenticatedActorRole: 'auth',
  });
  assert.equal(authenticatedContext.actorRole, 'admin');
  assert.equal(authenticatedContext.actorUserId, protectedRequest.auth.userId);

  protectedRequest.auth.role = 'MONTAJCI';
  assert.equal(deriveRlsContext(protectedRequest).actorRole, 'montage');
});

authTest('montajcı hesap gövdeleri rol dışındaki alanları ve zayıf parolaları reddeder', () => {
  assert.deepEqual(
    montageUserBodySchema.parse({
      username: 'montaj-ekibi',
      password: 'Guvenli-Montaj-Parolasi-2026!',
      status: 'ACTIVE',
    }),
    {
      username: 'montaj-ekibi',
      password: 'Guvenli-Montaj-Parolasi-2026!',
      status: 'ACTIVE',
    },
  );
  assert.equal(
    montageUserBodySchema.safeParse({
      username: 'montaj-ekibi',
      password: 'kisa',
      venueId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(montageUserUpdateBodySchema.safeParse({}).success, false);
  assert.equal(
    montageUserUpdateBodySchema.safeParse({ status: 'DISABLED', role: 'ADMIN' }).success,
    false,
  );
});

test('audit yazıcısı tek satır insert sonucunu zorunlu tutar ve skipDuplicates kullanmaz', async () => {
  const calls: unknown[] = [];
  const auditData = {
    action: 'test.audit',
    targetType: 'AuditWriterTest',
    correlationId: '00000000-0000-4000-8000-000000000003',
  };

  await writeAuditLog(
    {
      auditLog: {
        createMany: async (args: unknown) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    } as never,
    { data: auditData },
  );
  assert.deepEqual(calls, [{ data: auditData }]);

  await assert.rejects(
    () =>
      writeAuditLog({ auditLog: { createMany: async () => ({ count: 0 }) } } as never, {
        data: auditData,
      }),
    /Denetim kaydı oluşturulamadı/,
  );
});

test('production seed kullanıcı, parola veya operasyon personeli oluşturmaz', async () => {
  const seedSource = await readFile(new URL('../prisma/seed.ts', import.meta.url), 'utf8');

  assert.equal(seedSource.includes('prisma.user'), false);
  assert.equal(seedSource.includes('passwordHash'), false);
  assert.equal(seedSource.includes('SALON_YETKILISI'), false);
  assert.equal(seedSource.includes('prisma.staff'), false);
  assert.equal((seedSource.match(/update:\s*\{\}/g) ?? []).length, 3);
  assert.equal(seedSource.includes('update: { name'), false);
  assert.equal(seedSource.includes('update: { category'), false);
});

test('runtime rolü audit kayıtlarını güncelleyemez veya silemez', async () => {
  const runtimeRoleSource = await readFile(
    new URL('../../deploy/postgres/init-runtime-role.sh', import.meta.url),
    'utf8',
  );

  assert.match(
    runtimeRoleSource,
    /REVOKE UPDATE ON TABLE %I\.%I FROM %I[\s\S]*?'public', 'audit_logs'/,
  );
  assert.match(
    runtimeRoleSource,
    /REVOKE DELETE ON TABLE %I\.%I FROM %I[\s\S]*?'public', 'audit_logs'/,
  );
  assert.doesNotMatch(
    runtimeRoleSource,
    /GRANT DELETE ON TABLE %I\.%I TO %I[\s\S]*?'public', 'audit_logs'/,
  );
});

test('file-backed secret yükleyici allowlist ve fail-closed dosya kurallarını uygular', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'dugun-file-secrets-'));
  try {
    const validPath = join(temporaryDirectory, 'database-url');
    const emptyPath = join(temporaryDirectory, 'empty');
    const oversizedPath = join(temporaryDirectory, 'oversized');
    const nulPath = join(temporaryDirectory, 'nul');
    writeFileSync(validPath, 'postgresql://runtime:secret@postgres:5432/app\n');
    writeFileSync(emptyPath, '');
    writeFileSync(oversizedPath, Buffer.alloc(64 * 1024 + 1, 0x61));
    writeFileSync(nulPath, Buffer.from([0x61, 0x00, 0x62]));

    const validEnvironment: NodeJS.ProcessEnv = {
      USE_FILE_SECRETS: '1',
      DATABASE_URL_FILE: validPath,
    };
    loadFileBackedSecrets(validEnvironment);
    assert.equal(validEnvironment.DATABASE_URL, 'postgresql://runtime:secret@postgres:5432/app');

    assert.throws(() =>
      loadFileBackedSecrets({
        USE_FILE_SECRETS: '1',
        DATABASE_URL: 'postgresql://direct:secret@postgres:5432/app',
        DATABASE_URL_FILE: validPath,
      }),
    );
    assert.throws(() =>
      loadFileBackedSecrets({ USE_FILE_SECRETS: '0', DATABASE_URL_FILE: validPath }),
    );
    assert.throws(() =>
      loadFileBackedSecrets({ USE_FILE_SECRETS: '1', DATABASE_URL_FILE: emptyPath }),
    );
    assert.throws(() =>
      loadFileBackedSecrets({ USE_FILE_SECRETS: '1', DATABASE_URL_FILE: oversizedPath }),
    );
    assert.throws(() =>
      loadFileBackedSecrets({ USE_FILE_SECRETS: '1', DATABASE_URL_FILE: nulPath }),
    );
    assert.throws(() =>
      loadFileBackedSecrets({ USE_FILE_SECRETS: '1', DATABASE_URL_FILE: temporaryDirectory }),
    );
    assert.throws(() =>
      loadFileBackedSecrets(
        { USE_FILE_SECRETS: '1', DATABASE_URL_FILE: validPath },
        {
          lstatSync: () => ({ isSymbolicLink: () => true, isFile: () => false, size: 10 }) as never,
          readFileSync: () => Buffer.from('not-read'),
        },
      ),
    );

    const unallowlistedEnvironment = {
      USE_FILE_SECRETS: '1',
      UNSAFE_SECRET_FILE: validPath,
    };
    loadFileBackedSecrets(unallowlistedEnvironment);
    assert.equal('UNSAFE_SECRET' in unallowlistedEnvironment, false);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

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
  assert.equal(parsed.APP_PROCESS_ROLE, 'api');
  assert.deepEqual(parsed.CORS_ORIGIN, ['http://localhost:3000', 'https://example.com']);
  assert.equal(parsed.TRUST_PROXY, 0);
  assert.equal(parsed.HEALTHCHECK_TIMEOUT_MS, 3000);
  assert.equal(parsed.HTTP_REQUEST_TIMEOUT_MS, 15000);
  assert.equal(parsed.HTTP_HEADERS_TIMEOUT_MS, 10000);
  assert.equal(parsed.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5000);
  assert.equal(parsed.BOT_PROTECTION_MODE, 'turnstile');
  assert.equal(parsed.TURNSTILE_EXPECTED_HOSTNAME, 'example.com');
  assert.equal(
    parsed.TURNSTILE_VERIFY_URL,
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  );
  assert.equal(parsed.DELIVERY_LINK_VERIFICATION_MODE, 'remote');
  assert.equal(parsed.MFA_ENABLED, false);
  assert.equal(parsed.ADMIN_SESSION_TTL_HOURS, 8);
  assert.equal(parsed.ADMIN_SESSION_IDLE_MINUTES, 240);
  assert.equal(parsed.SALON_SESSION_IDLE_MINUTES, 60);
  assert.equal(parsed.CUSTOMER_SESSION_IDLE_HOURS, 12);
  assert.equal(parsed.TEMPORARY_PASSWORD_TTL_HOURS, 24);
  assert.equal(parsed.PUBLIC_APPLICATION_RETENTION_DAYS, 90);
  assert.equal(parsed.ARCHIVED_APPLICATION_RETENTION_DAYS, 365);
  assert.equal(parsed.ARCHIVED_WEDDING_RETENTION_DAYS, 3650);
  assert.equal(parsed.SECURITY_ARTIFACT_RETENTION_DAYS, 30);
  assert.equal(parsed.PAYMENT_MODE, 'test');
  assert.equal(parsed.PAYMENT_IBAN, 'TR000000000000000000000000');
  assert.throws(() => parseEnvironment({ ...validEnvironment, PORT: '5000abc' }));
  assert.throws(() => parseEnvironment({ ...validEnvironment, MFA_ENABLED: 'yes' }));
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

  const productionEnvironmentInput: NodeJS.ProcessEnv = {
    ...validEnvironment,
    NODE_ENV: 'production',
    TRUST_PROXY: '172.30.0.2',
    DATA_ENCRYPTION_KEY: validProductionEncryptionKey,
    DATABASE_URL:
      'postgresql://app_user:Guclu-Production-Parolasi-2026%21@db.example.com:5432/dugun_ajansim?sslmode=require&sslaccept=strict',
  };
  const productionEnvironment = parseEnvironment(productionEnvironmentInput);
  assert.equal(productionEnvironment.NODE_ENV, 'production');
  assert.equal(productionEnvironment.PII_ENCRYPTION_MODE, 'strict');
  assert.throws(
    () =>
      parseEnvironment({
        ...productionEnvironmentInput,
        PII_BLIND_INDEX_ACTIVE_KEY_ID: 'blind-active-2026',
        PII_BLIND_INDEX_KEYRING_JSON: JSON.stringify({
          'blind-active-2026': validEnvironment.PII_BLIND_INDEX_KEY,
          'blind-rotating-2026': validEnvironment.RATE_LIMIT_HMAC_KEY,
        }),
      }),
    (error: unknown) =>
      error instanceof z.ZodError &&
      error.issues.some((issue) => issue.path[0] === 'RATE_LIMIT_HMAC_KEY'),
  );
  assert.throws(() =>
    parseEnvironment({
      ...productionEnvironmentInput,
      PII_ENCRYPTION_MODE: 'encrypted',
    }),
  );
  const piiMaintenanceEnvironment = parseEnvironment({
    ...productionEnvironmentInput,
    APP_PROCESS_ROLE: 'pii-maintenance',
    DATA_ENCRYPTION_KEY: undefined,
    RATE_LIMIT_HMAC_KEY: undefined,
    PII_ENCRYPTION_MODE: 'encrypted',
  });
  assert.equal(piiMaintenanceEnvironment.APP_PROCESS_ROLE, 'pii-maintenance');
  const adminBootstrapEnvironment = parseEnvironment({
    ...productionEnvironmentInput,
    APP_PROCESS_ROLE: 'admin-bootstrap',
    DATA_ENCRYPTION_KEY: undefined,
    DATA_ENCRYPTION_KEYRING_JSON: undefined,
    PII_BLIND_INDEX_KEY: undefined,
    RATE_LIMIT_HMAC_KEY: undefined,
    PII_ENCRYPTION_MODE: 'encrypted',
  });
  assert.equal(adminBootstrapEnvironment.APP_PROCESS_ROLE, 'admin-bootstrap');
  const productionMaintenanceEnvironment = parseEnvironment({
    ...productionEnvironmentInput,
    BOT_PROTECTION_MODE: 'disabled',
  });
  assert.equal(productionMaintenanceEnvironment.BOT_PROTECTION_MODE, 'disabled');
  assert.throws(() => assertBookingBotProtectionConfigured('production', 'disabled'));
  assert.throws(() =>
    parseEnvironment({
      ...productionEnvironmentInput,
      TURNSTILE_EXPECTED_HOSTNAME: 'attacker.example',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...productionEnvironmentInput,
      TURNSTILE_VERIFY_URL: 'http://turnstile-stub:8080/siteverify',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...productionEnvironmentInput,
      DELIVERY_LINK_VERIFICATION_MODE: 'synthetic',
    }),
  );
  assert.throws(() =>
    parseEnvironment({
      ...productionEnvironmentInput,
      PAYMENT_MODE: 'live',
    }),
  );
  const livePaymentEnvironment = parseEnvironment({
    ...productionEnvironmentInput,
    PAYMENT_MODE: 'live',
    PAYMENT_BANK_NAME: 'Örnek Banka A.Ş.',
    PAYMENT_ACCOUNT_HOLDER: 'Düğün Ajansım Turizm Ltd. Şti.',
    PAYMENT_IBAN: 'TR12 0006 1005 1978 6457 8413 26',
    PAYMENT_WHATSAPP_PHONE: '+90 (555) 123 45 67',
  });
  assert.equal(livePaymentEnvironment.PAYMENT_MODE, 'live');
  assert.equal(livePaymentEnvironment.PAYMENT_IBAN, 'TR120006100519786457841326');
  assert.equal(livePaymentEnvironment.PAYMENT_WHATSAPP_PHONE, '905551234567');
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

authTest('MFA özellik anahtarıyla tamamen kapatılır ve ayrıcalıklı remember isteği yok sayılır', () => {
  assert.equal(getSessionIdleTimeoutMs('ADMIN'), 240 * 60 * 1000);
  assert.equal(getSessionIdleTimeoutMs('SALON_YETKILISI'), 60 * 60 * 1000);
  assert.equal(getSessionIdleTimeoutMs('MUSTERI'), 12 * 60 * 60 * 1000);
  assert.equal(getSessionAbsoluteTtlMs('ADMIN', true), 8 * 60 * 60 * 1000);
  assert.equal(getSessionAbsoluteTtlMs('ADMIN', true), getSessionAbsoluteTtlMs('ADMIN', false));
  assert.equal(
    getSessionAbsoluteTtlMs('SALON_YETKILISI', true),
    getSessionAbsoluteTtlMs('SALON_YETKILISI', false),
  );
  assert.ok(getSessionAbsoluteTtlMs('MUSTERI', true) > getSessionAbsoluteTtlMs('MUSTERI', false));
  assert.ok(getSessionTouchIntervalMs('ADMIN') < getSessionIdleTimeoutMs('ADMIN'));
  assert.ok(getSessionTouchIntervalMs('MUSTERI') < getSessionIdleTimeoutMs('MUSTERI'));
  assert.equal(calculateSessionTouchIntervalMs(5 * 60 * 1000), 2.5 * 60 * 1000);
  assert.equal(isMfaRequiredRole('ADMIN', false), false);
  assert.equal(isMfaRequiredRole('ADMIN', true), true);
  assert.equal(isMfaRequiredRole('SALON_YETKILISI', true), false);
  assert.equal(isMfaRequiredRole('MUSTERI', true), false);
  assert.equal(isMfaEnrollmentRequired('ADMIN', false, 'production', false), false);
  assert.equal(isMfaEnrollmentRequired('ADMIN', false, 'production', true), true);
  assert.equal(isMfaEnrollmentRequired('SALON_YETKILISI', false, 'production'), false);
  assert.equal(isMfaEnrollmentRequired('MUSTERI', false, 'production'), false);
  assert.equal(isMfaEnrollmentRequired('ADMIN', true, 'production'), false);
  assert.equal(isMfaEnrollmentRequired('ADMIN', false, 'test'), false);
});

authTest('admin-only MFA migrationı diğer rollerin MFA ve cihaz kayıtlarını temizler', async () => {
  const migration = await readFile(
    new URL('../prisma/migrations/20260812130000_admin_only_mfa/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /DELETE FROM "trusted_devices"/);
  assert.match(migration, /UPDATE "auth_sessions"/);
  assert.match(migration, /UPDATE "users"/);
  assert.equal((migration.match(/account\."role" <> 'ADMIN'/g) ?? []).length, 2);
  assert.match(migration, /WHERE "role" <> 'ADMIN'/);
});

authTest('güvenilen cihaz tokeni tekil cookie ve tarayıcı bağlamına bağlıdır', () => {
  const request = {
    headers: { cookie: 'dugunajansim_trusted_device=guvenli-token' },
    get: (name: string) =>
      name.toLowerCase() === 'user-agent'
        ? 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0'
        : undefined,
  } as never;
  assert.equal(readTrustedDeviceToken(request), 'guvenli-token');
  assert.match(userAgentHash(request), /^[a-f0-9]{64}$/);
  assert.equal(describeDevice(request), 'Chrome / Windows');
  assert.equal(DAILY_MFA_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(TRUSTED_DEVICE_TTL_MS, 30 * 24 * 60 * 60 * 1000);

  const polluted = {
    headers: {
      cookie: 'dugunajansim_trusted_device=ilk; dugunajansim_trusted_device=ikinci',
    },
    get: (name: string) =>
      name.toLowerCase() === 'user-agent'
        ? 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0'
        : undefined,
  } as never;
  assert.equal(readTrustedDeviceToken(polluted), undefined);
});

authTest('RFC 6238 TOTP kodu dar zaman penceresi, AAD ve tekrar adımıyla doğrulanır', () => {
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(generateTotpCode(rfcSecret, 1n), '287082');
  assert.equal(findMatchingTotpStep(rfcSecret, '287082', new Date(59_000)), 1n);
  assert.equal(
    findMatchingTotpStep(rfcSecret, generateTotpCode(rfcSecret, 2n), new Date(89_000)),
    2n,
  );
  assert.equal(
    findMatchingTotpStep(rfcSecret, generateTotpCode(rfcSecret, 1n), new Date(89_000)),
    1n,
  );
  assert.equal(
    findMatchingTotpStep(rfcSecret, generateTotpCode(rfcSecret, 3n), new Date(89_000)),
    3n,
  );
  assert.equal(
    findMatchingTotpStep(rfcSecret, generateTotpCode(rfcSecret, 1n), new Date(119_000)),
    undefined,
  );
  assert.equal(findMatchingTotpStep(rfcSecret, '12345x', new Date(59_000)), undefined);

  const generatedSecret = createTotpSecret();
  assert.match(generatedSecret, /^[A-Z2-7]{32}$/);
  const enrollmentUri = createTotpEnrollmentUri(generatedSecret, 'yonetici');
  assert.equal(enrollmentUri.startsWith('otpauth://totp/'), true);
  assert.equal(new URL(enrollmentUri).searchParams.get('secret'), generatedSecret);

  const encrypted = encryptValue(generatedSecret, totpEncryptionAad('user-one'));
  assert.equal(decryptValue(encrypted, totpEncryptionAad('user-one')), generatedSecret);
  assert.throws(() => decryptValue(encrypted, totpEncryptionAad('user-two')));
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

test('veri saklama politikası yalnız süresi dolan ve ilişkisiz kayıtları sınırlı partide siler', async () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  const policy = {
    publicApplicationDays: 90,
    archivedApplicationDays: 365,
    archivedWeddingDays: 3650,
    securityArtifactDays: 30,
    batchSize: 25,
  };
  const cutoffs = buildRetentionCutoffs(policy, now);
  assert.equal(cutoffs.publicApplication.toISOString(), '2029-10-03T00:00:00.000Z');
  assert.equal(cutoffs.securityArtifact.toISOString(), '2029-12-02T00:00:00.000Z');

  const bookingFindResponses = [[{ id: 'public-application' }], [{ id: 'archived-application' }]];
  const bookingDeleteWhere: unknown[] = [];
  const auditEntries: unknown[] = [];
  const transaction = {
    rateLimitBucket: {
      findMany: async () => [{ keyHash: 'bucket' }],
      deleteMany: async () => ({ count: 1 }),
    },
    authSession: {
      findMany: async () => [{ id: 'session' }],
      deleteMany: async () => ({ count: 1 }),
    },
    trustedDevice: {
      findMany: async () => [{ id: 'trusted-device' }],
      deleteMany: async () => ({ count: 1 }),
    },
    passwordSetupToken: {
      findMany: async () => [{ id: 'setup-token' }],
      deleteMany: async () => ({ count: 1 }),
    },
    bookingApplication: {
      findMany: async () => bookingFindResponses.shift() ?? [],
      deleteMany: async (args: { where: unknown }) => {
        bookingDeleteWhere.push(args.where);
        return { count: 1 };
      },
    },
    wedding: {
      findMany: async () => [
        { id: 'wedding', applicationId: 'approved-application', customerUserId: 'customer' },
      ],
      deleteMany: async () => ({ count: 1 }),
    },
    user: {
      deleteMany: async () => ({ count: 1 }),
    },
    auditLog: {
      createMany: async (args: { data: unknown | unknown[] }) => {
        const entries = Array.isArray(args.data) ? args.data : [args.data];
        auditEntries.push(...entries);
        return { count: entries.length };
      },
    },
  };
  let isolationLevel: unknown;
  const client = {
    $transaction: async (
      operation: (value: typeof transaction) => Promise<unknown>,
      options: { isolationLevel: unknown },
    ) => {
      isolationLevel = options.isolationLevel;
      return operation(transaction);
    },
  } as unknown as PrismaClient;

  const result = await runDataRetentionBatch(client, policy, now);
  assert.equal(countRetentionDeletes(result), 9);
  assert.equal(result.archivedApplications, 2);
  assert.equal(isolationLevel, 'Serializable');
  assert.equal(bookingDeleteWhere.length, 3);
  assert.equal(auditEntries.length, 1);
  assert.deepEqual(auditEntries[0], {
    action: 'maintenance.data_retention',
    targetType: 'System',
    targetId: null,
    outcome: 'SUCCESS',
    correlationId: (auditEntries[0] as { correlationId: string }).correlationId,
    metadata: { deleted: result },
  });
  assert.deepEqual(bookingDeleteWhere[0], {
    id: { in: ['public-application'] },
    source: 'PUBLIC_FORM',
    wedding: null,
  });
  assert.deepEqual(bookingDeleteWhere[2], {
    id: { in: ['approved-application'] },
    wedding: null,
  });
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

test('PII zarfı keyring rotasyonu, kayıt/model AAD bağlamı ve alan ayrımlı blind index uygular', () => {
  const oldKey = '12'.repeat(32);
  const activeKey = '34'.repeat(32);
  const oldBlindIndexKey = '56'.repeat(32);
  const activeBlindIndexKey = '67'.repeat(32);
  const legacyCrypto = createPiiCryptography({
    activeKeyId: 'old-2026',
    keyring: { 'old-2026': oldKey },
    blindIndexActiveKeyId: 'blind-old-2026',
    blindIndexKeyring: { 'blind-old-2026': oldBlindIndexKey },
  });
  const rotatedCrypto = createPiiCryptography({
    activeKeyId: 'active-2026',
    keyring: { 'old-2026': oldKey, 'active-2026': activeKey },
    blindIndexActiveKeyId: 'blind-active-2026',
    blindIndexKeyring: {
      'blind-old-2026': oldBlindIndexKey,
      'blind-active-2026': activeBlindIndexKey,
    },
  });
  const payload = {
    brideFirstName: 'Ada',
    brideLastName: 'Yılmaz',
    bridePhone: '+905551112233',
    groomFirstName: 'Can',
    groomLastName: 'Kaya',
    groomPhone: '+905554445566',
    primaryEmail: 'ada@example.com',
    note: 'Sessiz salon',
    rejectionReason: null,
    customVenueName: null,
  };

  const encrypted = encryptBookingApplicationPii(
    '11111111-1111-4111-8111-111111111111',
    payload,
    legacyCrypto,
  );

  assert.equal(encrypted.piiKeyId, 'old-2026');
  assert.equal(encrypted.piiEncryptionVersion, 3);
  assert.equal(encrypted.piiSchemaVersion, BOOKING_APPLICATION_PII_SCHEMA_VERSION);
  assert.equal(encrypted.piiBlindIndexKeyId, 'blind-old-2026');
  assert.deepEqual(
    decryptBookingApplicationPii('11111111-1111-4111-8111-111111111111', encrypted, rotatedCrypto),
    payload,
  );
  assert.throws(() =>
    decryptBookingApplicationPii('22222222-2222-4222-8222-222222222222', encrypted, rotatedCrypto),
  );

  const normalizedEmail = rotatedCrypto.blindIndex(
    'BookingApplication.primaryEmail',
    '  ADA@Example.COM ',
    'email',
  );
  assert.equal(
    normalizedEmail,
    rotatedCrypto.blindIndex('BookingApplication.primaryEmail', 'ada@example.com', 'email'),
  );
  assert.notEqual(
    normalizedEmail,
    rotatedCrypto.blindIndex('Wedding.primaryEmail', 'ada@example.com', 'email'),
  );
  assert.notEqual(
    rotatedCrypto.blindIndex('BookingApplication.bridePhone', '+90 (555) 111 22 33', 'phone'),
    rotatedCrypto.blindIndex('BookingApplication.groomPhone', '+90 (555) 111 22 33', 'phone'),
  );
  const rotationCandidates = rotatedCrypto.blindIndexCandidates(
    'BookingApplication.primaryEmail',
    'ada@example.com',
    'email',
  );
  assert.deepEqual(
    rotationCandidates.map((candidate) => candidate.keyId),
    ['blind-old-2026', 'blind-active-2026'],
  );
  assert.notEqual(rotationCandidates[0]?.value, rotationCandidates[1]?.value);
});

test('PII payload doğrulaması bilinmeyen alanı reddeder; encrypted fallback ve strict kesimi uygular', () => {
  const cryptography = createPiiCryptography({
    activeKeyId: 'active-2026',
    keyring: { 'active-2026': '78'.repeat(32) },
    blindIndexKey: '9a'.repeat(32),
  });
  const recordId = '33333333-3333-4333-8333-333333333333';
  const payloadWithUnknownField = {
    brideFirstName: 'Ada',
    brideLastName: 'Yılmaz',
    bridePhone: '+905551112233',
    groomFirstName: 'Can',
    groomLastName: 'Kaya',
    groomPhone: '+905554445566',
    primaryEmail: 'ada@example.com',
    note: null,
    rejectionReason: null,
    leaked: 'yasak',
  };

  assert.throws(() =>
    encryptBookingApplicationPii(recordId, payloadWithUnknownField, cryptography),
  );
  const legacySource = {
    brideFirstName: 'Ada',
    brideLastName: 'Yılmaz',
    bridePhone: '+905551112233',
    groomFirstName: 'Can',
    groomLastName: 'Kaya',
    groomPhone: '+905554445566',
    primaryEmail: 'ada@example.com',
    note: null,
    rejectionReason: null,
    piiCiphertext: null,
    piiIv: null,
    piiAuthTag: null,
    piiKeyId: null,
    piiEncryptionVersion: null,
    piiSchemaVersion: null,
  };
  assert.equal(
    decryptBookingApplicationPii(recordId, legacySource, cryptography, 'encrypted').primaryEmail,
    'ada@example.com',
  );
  assert.throws(() => decryptBookingApplicationPii(recordId, legacySource, cryptography, 'strict'));
});

test('Staff PII zarfı plaintext ve persistence metadata alanlarını DTO dışına çıkarır', () => {
  const cryptography = createPiiCryptography({
    activeKeyId: 'staff-active',
    keyring: { 'staff-active': '81'.repeat(32) },
    blindIndexActiveKeyId: 'staff-blind-active',
    blindIndexKeyring: { 'staff-blind-active': '92'.repeat(32) },
  });
  const id = '44444444-4444-4444-8444-444444444444';
  const encrypted = buildStaffPiiData(
    id,
    { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905551112233' },
    1,
    'encrypted',
    cryptography,
  );

  assert.equal(encrypted.firstName, null);
  assert.equal(decryptStaffPii(id, encrypted, cryptography, 'strict').phone, '+905551112233');
  const dto = staffWithDecryptedPii(
    {
      id,
      ...encrypted,
      isActive: true,
      photoStorageKey: `${id}/${randomUUID()}.webp`,
      photoUpdatedAt: new Date(),
    },
    cryptography,
    'strict',
  );
  assert.equal(dto.firstName, 'Ayşe');
  assert.equal(dto.lastName, 'Yılmaz');
  assert.equal(dto.phone, '+905551112233');
  for (const secret of [
    'piiCiphertext',
    'piiIv',
    'piiAuthTag',
    'piiKeyId',
    'phoneBlindIndex',
    'piiBlindIndexKeyId',
    'photoStorageKey',
    'photoUpdatedAt',
  ]) {
    assert.equal(secret in dto, false);
  }
});

nodeTest(
  'backend-unit personel fotoğrafını güvenli anahtarla WebP olarak saklar ve kaldırır',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dugun-ajansim-staff-photo-'));
    try {
      const staffId = randomUUID();
      const source = await sharp({
        create: { width: 40, height: 60, channels: 3, background: '#7f8b62' },
      })
        .png()
        .toBuffer();
      const stored = await storeStaffPhoto(staffId, source, 'image/png', directory);
      assert.match(stored.key, new RegExp(`^${staffId}/[0-9a-f-]{36}\\.webp$`, 'i'));

      const output = await readStaffPhoto(stored.key, directory);
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, 512);
      assert.equal(metadata.height, 512);

      await assert.rejects(
        storeStaffPhoto(staffId, source, 'image/jpeg', directory),
        (error: unknown) => error instanceof AppError && error.statusCode === 415,
      );
      await removeStaffPhoto(stored.key, directory);
      await assert.rejects(
        readStaffPhoto(stored.key, directory),
        (error: unknown) => error instanceof AppError && error.statusCode === 404,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('Legacy PII redaction tutarlılık denetimi normalize eşleşmeyi kabul edip sapmayı reddeder', () => {
  const bookingPayload = {
    brideFirstName: 'Ayşe',
    brideLastName: 'Yılmaz',
    bridePhone: '+905551234567',
    groomFirstName: 'Mehmet',
    groomLastName: 'Demir',
    groomPhone: '+905559876543',
    primaryEmail: 'cift@example.com',
    note: 'Not',
    rejectionReason: null,
    customVenueName: null,
  };
  assert.equal(
    bookingApplicationLegacyPiiMatches(
      { ...bookingPayload, primaryEmail: ' CIFT@EXAMPLE.COM ', bridePhone: '0555 123 45 67' },
      bookingPayload,
    ),
    true,
  );
  assert.equal(
    bookingApplicationLegacyPiiMatches(
      { ...bookingPayload, brideFirstName: 'Başka kişi' },
      bookingPayload,
    ),
    false,
  );
  assert.equal(weddingLegacyPiiMatches(bookingPayload, bookingPayload), true);
  assert.equal(
    messageTaskLegacyPiiMatches(
      { recipientPhone: '0555 123 45 67' },
      { recipientPhone: '+905551234567' },
    ),
    true,
  );
  assert.equal(
    staffLegacyPiiMatches(
      { firstName: 'Ada', lastName: 'Lovelace', phone: '+905551234567' },
      { firstName: 'Ada', lastName: 'Byron', phone: '+905551234567' },
    ),
    false,
  );
});

test('Booking DTO merkezi sanitizer ile idempotency ve ödeme akışı sırlarını kaldırır', () => {
  const cryptography = createPiiCryptography({
    activeKeyId: 'booking-active',
    keyring: { 'booking-active': '83'.repeat(32) },
    blindIndexActiveKeyId: 'booking-blind-active',
    blindIndexKeyring: { 'booking-blind-active': '94'.repeat(32) },
  });
  const id = '55555555-5555-4555-8555-555555555555';
  const encrypted = encryptBookingApplicationPii(
    id,
    {
      brideFirstName: 'Ada',
      brideLastName: 'Yılmaz',
      bridePhone: '+905551112233',
      groomFirstName: 'Can',
      groomLastName: 'Kaya',
      groomPhone: '+905554445566',
      primaryEmail: 'ada@example.com',
      note: null,
      rejectionReason: null,
      customVenueName: 'Özel Bahçe',
    },
    cryptography,
  );
  const dto = bookingApplicationWithDecryptedPii(
    {
      id,
      ...encrypted,
      brideFirstName: null,
      brideLastName: null,
      bridePhone: null,
      groomFirstName: null,
      groomLastName: null,
      groomPhone: null,
      primaryEmail: null,
      note: null,
      rejectionReason: null,
      piiRevision: 1,
      idempotencyKey: 'secret-key',
      idempotencyFingerprint: null,
      idempotencyFingerprintHmac: 'ab'.repeat(32),
      idempotencyFingerprintKeyId: 'booking-active',
      idempotencyFingerprintVersion: 2,
      paymentFlowTokenHash: 'cd'.repeat(32),
    },
    cryptography,
    'strict',
  );

  assert.equal(dto.customVenueName, 'Özel Bahçe');
  for (const secret of [
    'idempotencyKey',
    'idempotencyFingerprint',
    'idempotencyFingerprintHmac',
    'idempotencyFingerprintKeyId',
    'idempotencyFingerprintVersion',
    'paymentFlowTokenHash',
  ]) {
    assert.equal(secret in dto, false);
  }
});

test('Idempotency HMAC alan ayrımlı keyring rotasyonu ve exact-key doğrulaması uygular', () => {
  const oldCryptography = createBookingFingerprintCryptography({
    activeKeyId: 'old-key',
    keyring: { 'old-key': 'a1'.repeat(32) },
  });
  const rotatedCryptography = createBookingFingerprintCryptography({
    activeKeyId: 'new-key',
    keyring: { 'old-key': 'a1'.repeat(32), 'new-key': 'b2'.repeat(32) },
  });
  const canonicalPayload = serializeBookingFingerprintPayload({
    source: 'PUBLIC_FORM',
    brideFirstName: 'Ada',
    brideLastName: 'Yılmaz',
    bridePhone: '+905551112233',
    groomFirstName: 'Can',
    groomLastName: 'Kaya',
    groomPhone: '+905554445566',
    primaryContact: 'GELIN',
    primaryEmail: 'ada@example.com',
    startsAt: new Date('2026-09-01T15:00:00.000Z'),
    endsAt: new Date('2026-09-01T20:00:00.000Z'),
    venueId: null,
    customVenueName: 'Özel Bahçe',
    packageCode: 'premium',
    serviceCodes: ['video', 'album'],
    paymentMethod: 'DEPOSIT',
    note: null,
    privacyConsent: true,
    marketingConsent: false,
  });
  const legacyEnvelope = oldCryptography.create(canonicalPayload);
  const activeEnvelope = rotatedCryptography.create(canonicalPayload);

  assert.equal(rotatedCryptography.verify(canonicalPayload, legacyEnvelope), true);
  assert.equal(
    bookingFingerprintNeedsRepair(canonicalPayload, activeEnvelope, rotatedCryptography),
    false,
  );
  assert.equal(
    bookingFingerprintNeedsRepair(canonicalPayload, legacyEnvelope, rotatedCryptography),
    true,
  );
  assert.equal(
    bookingFingerprintNeedsRepair(
      canonicalPayload,
      { ...activeEnvelope, idempotencyFingerprintHmac: '00'.repeat(32) },
      rotatedCryptography,
    ),
    true,
  );
  assert.equal(
    bookingFingerprintNeedsRepair(
      null,
      {
        idempotencyFingerprintHmac: null,
        idempotencyFingerprintKeyId: null,
        idempotencyFingerprintVersion: null,
      },
      rotatedCryptography,
    ),
    false,
  );
  assert.equal(bookingFingerprintNeedsRepair(null, activeEnvelope, rotatedCryptography), true);
  assert.equal(rotatedCryptography.verify(`${canonicalPayload}tamper`, legacyEnvelope), false);
  assert.equal(
    rotatedCryptography.verify(canonicalPayload, {
      ...legacyEnvelope,
      idempotencyFingerprintKeyId: 'unknown-key',
    }),
    false,
  );
  assert.equal(activeEnvelope.idempotencyFingerprintKeyId, 'new-key');
});

test('Delivery URL rotasyonu legacy fallback ile exact keyId davranışını ayırır', () => {
  const legacyKey = 'c3'.repeat(32);
  const cryptography = createDeliveryCryptography({
    activeKeyId: 'delivery-new',
    keyring: { 'delivery-new': 'd4'.repeat(32) },
    legacyKey,
  });
  const id = '66666666-6666-4666-8666-666666666666';
  const encrypted = cryptography.buildDriveUrlData(id, 'https://drive.google.com/file/d/test');

  assert.equal(encrypted.driveUrlKeyId, 'delivery-new');
  assert.equal(
    cryptography.decryptDriveUrl({ id, ...encrypted }),
    'https://drive.google.com/file/d/test',
  );
  const legacyEncrypted = encryptValueWithKey(
    'https://drive.google.com/file/d/legacy',
    legacyKey,
    `delivery-url:${id}`,
  );
  assert.equal(
    cryptography.decryptDriveUrl({
      id,
      driveUrlCiphertext: legacyEncrypted.ciphertext,
      driveUrlIv: legacyEncrypted.iv,
      driveUrlAuthTag: legacyEncrypted.authTag,
      driveUrlKeyId: null,
      encryptionVersion: 2,
    }),
    'https://drive.google.com/file/d/legacy',
  );
  assert.throws(() =>
    cryptography.decryptDriveUrl({ id, ...encrypted, driveUrlKeyId: 'unknown-key' }),
  );
});

test('Production dışı PII yazımı açık sentetik veri opt-in olmadan fail-closed kalır', () => {
  assert.throws(() =>
    assertPiiWriteAllowed({
      NODE_ENV: 'development',
      ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES: false,
    }),
  );
  assert.doesNotThrow(() =>
    assertPiiWriteAllowed({
      NODE_ENV: 'test',
      ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES: true,
    }),
  );
  assert.doesNotThrow(() =>
    assertPiiWriteAllowed({
      NODE_ENV: 'production',
      ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES: false,
    }),
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
    } as unknown as Request,
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
  const request = { correlationId: 'corr_validation_123' } as Request;

  handler(
    new AppError('Girdi doğrulama hatası', 422, true, details, {
      code: 'VALIDATION_ERROR',
    }),
    request,
    mock.response,
    (() => undefined) as NextFunction,
  );

  assert.equal(mock.getStatusCode(), 422);
  assert.equal(mock.getBody().message, 'Girdi doğrulama hatası');
  assert.equal(mock.getBody().code, 'VALIDATION_ERROR');
  assert.equal(mock.getBody().requestId, 'corr_validation_123');
  assert.deepEqual(mock.getBody().errors, details);
  assert.deepEqual(mock.getBody().fieldErrors, [{ field: 'email', message: 'Geçersiz e-posta' }]);
});

test('backend-unit [pagination] cursor sıralama alanlarını güvenli ve değiştirilemez taşır', () => {
  const cursor = encodeListCursor({
    id: '11111111-1111-4111-8111-111111111111',
    sortValue: '2026-08-12T19:30:00.000Z',
  });

  assert.deepEqual(decodeListCursor(cursor), {
    id: '11111111-1111-4111-8111-111111111111',
    sortValue: '2026-08-12T19:30:00.000Z',
  });
  assert.throws(() => decodeListCursor(`${cursor}x`), /Geçersiz sayfalama imleci/);
});

test('backend-unit [delivery-link] yayın öncesi erişim smoke kontrolü kapalı bağlantıyı reddeder', async () => {
  const accessible = await verifyDeliveryLinkAccess(
    'https://drive.google.com/file/d/demo/view',
    {
      fetchImpl: async () => new Response(null, { status: 200 }),
    },
  );
  assert.equal(accessible.status, 200);

  const weTransferRedirect = await verifyDeliveryLinkAccess('https://we.tl/t-demo', {
    fetchImpl: async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://wetransfer.com/downloads/demo' },
      }),
  });
  assert.equal(weTransferRedirect.redirectHost, 'wetransfer.com');

  await assert.rejects(
    verifyDeliveryLinkAccess('https://drive.google.com/file/d/demo/view', {
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://accounts.google.com/ServiceLogin' },
        }),
    }),
    /anonim erişime açık görünmüyor/,
  );

  await assert.rejects(
    verifyDeliveryLinkAccess('https://we.tl/t-demo', {
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://drive.google.com/file/d/cross-provider' },
        }),
    }),
    /anonim erişime açık görünmüyor/,
  );
});

test('backend-unit [delivery-link] yönlendirme allowlist ve servis hata dallarını korur', async () => {
  const sourceUrl = 'https://drive.google.com/file/d/demo/view';
  const allowedRedirects = [
    'https://google.com/open',
    'https://drive.google.com/open',
    'https://googleusercontent.com/download',
    'https://lh3.googleusercontent.com/download',
  ];

  for (const location of allowedRedirects) {
    const result = await verifyDeliveryLinkAccess(sourceUrl, {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location } }),
    });
    assert.equal(result.redirectHost, new URL(location).hostname);
  }

  const rejectedResponses = [
    { response: new Response(null, { status: 403 }), statusCode: 422 },
    { response: new Response(null, { status: 503 }), statusCode: 503 },
    { response: new Response(null, { status: 302 }), statusCode: 422 },
    {
      response: new Response(null, { status: 302, headers: { location: 'http://[invalid' } }),
      statusCode: 422,
    },
    {
      response: new Response(null, {
        status: 302,
        headers: { location: 'http://drive.google.com/open' },
      }),
      statusCode: 422,
    },
    {
      response: new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/open' },
      }),
      statusCode: 422,
    },
    { response: new Response(null, { status: 418 }), statusCode: 422 },
  ];

  for (const { response, statusCode } of rejectedResponses) {
    await assert.rejects(
      verifyDeliveryLinkAccess(sourceUrl, { fetchImpl: async () => response }),
      (error: unknown) => error instanceof AppError && error.statusCode === statusCode,
    );
  }

  await assert.rejects(
    verifyDeliveryLinkAccess(sourceUrl, {
      fetchImpl: async () => {
        throw new Error('network unavailable');
      },
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 503,
  );
});

authTest(
  'adım-yükseltme machine-code ayrıntısı production yanıtında details altında korunur',
  () => {
    const mock = createMockResponse();
    const handler = createGlobalErrorHandler('production');

    handler(
      new AppError('Güncel doğrulama gerekli.', 428, true, undefined, {
        code: 'ADMIN_STEP_UP_REQUIRED',
      }),
      {} as Request,
      mock.response,
      (() => undefined) as NextFunction,
    );

    assert.equal(mock.getStatusCode(), 428);
    assert.deepEqual(mock.getBody().details, { code: 'ADMIN_STEP_UP_REQUIRED' });
    assert.equal('errors' in mock.getBody(), false);
  },
);

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
    { body: { email: 'geçersiz' }, query: {}, params: {} } as unknown as Request,
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

test('public uygunluk isteği bilinmeyen query alanlarını reddeder', async () => {
  const middleware = validateRequest(availabilityRequestSchema);
  let forwardedError: unknown;

  await middleware(
    {
      body: {},
      query: { date: '2026-08-10', unexpected: '1' },
      params: { venueId: 'de305d54-75b4-431b-adb2-eb6b9e546014' },
    } as unknown as Request,
    {} as Response,
    ((error?: unknown) => {
      forwardedError = error;
    }) as NextFunction,
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

test('ortak rate-limit anahtarları HMAC ile gizlenir ve hesap adı kanonikleştirilir', () => {
  const secret = '42'.repeat(32);
  const first = hashRateLimitKey('auth-login', '192.0.2.4', secret);
  assert.equal(first, hashRateLimitKey('auth-login', '192.0.2.4', secret));
  assert.notEqual(first, hashRateLimitKey('public-booking', '192.0.2.4', secret));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes('192.0.2.4'), false);
  assert.equal(
    loginAccountRateLimitKeyGenerator({ body: { username: '  YÖNETİCİ  ' } } as Request),
    'yonetici',
  );
});

test('takvim çakışmaları personel bazında sıralı ve sınırlı hesaplanır', () => {
  const values = [
    { staff: 'a', id: '1', start: new Date(0), end: new Date(30) },
    { staff: 'b', id: '4', start: new Date(5), end: new Date(50) },
    { staff: 'a', id: '2', start: new Date(10), end: new Date(20) },
    { staff: 'a', id: '3', start: new Date(15), end: new Date(40) },
  ];
  const result = findBoundedIntervalConflicts(values, {
    groupKey: (value) => value.staff,
    startsAt: (value) => value.start,
    endsAt: (value) => value.end,
    maxConflicts: 2,
  });
  assert.deepEqual(
    result.pairs.map(([left, right]) => [left.id, right.id]),
    [
      ['1', '2'],
      ['1', '3'],
    ],
  );
  assert.equal(result.truncated, true);
});

test('Turnstile doğrulaması token, hostname, action ve test endpoint sözleşmesini denetler', async () => {
  let requestBody: Record<string, unknown> | undefined;
  let requestUrl = '';
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        success: true,
        hostname: 'example.com',
        action: 'booking_application',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const configuration = {
    mode: 'turnstile' as const,
    secretKey: 'server-only-secret',
    expectedHostname: 'example.com',
    timeoutMs: 1_000,
    verifyUrl: 'http://turnstile-stub:8080/siteverify',
  };

  await verifyBookingBotChallenge({
    token: 'opaque-client-token',
    remoteIp: '203.0.113.10',
    idempotencyKey: '9c3715de-f949-469a-bc06-a00af46cf9b6',
    fetchImpl,
    configuration,
  });
  assert.deepEqual(requestBody, {
    secret: 'server-only-secret',
    response: 'opaque-client-token',
    remoteip: '203.0.113.10',
    idempotency_key: '9c3715de-f949-469a-bc06-a00af46cf9b6',
  });
  assert.equal(requestUrl, 'http://turnstile-stub:8080/siteverify');

  await assert.rejects(
    verifyBookingBotChallenge({
      token: 'opaque-client-token',
      remoteIp: undefined,
      idempotencyKey: '9c3715de-f949-469a-bc06-a00af46cf9b6',
      configuration,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: true,
            hostname: 'attacker.example',
            action: 'booking_application',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test('Turnstile servis hatasında güvenli biçimde kapalı kalır', async () => {
  await assert.rejects(
    verifyBookingBotChallenge({
      token: 'opaque-client-token',
      remoteIp: undefined,
      idempotencyKey: '9c3715de-f949-469a-bc06-a00af46cf9b6',
      configuration: {
        mode: 'turnstile',
        secretKey: 'server-only-secret',
        expectedHostname: 'example.com',
        timeoutMs: 1_000,
      },
      fetchImpl: async () => {
        throw new Error('provider unavailable');
      },
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 503,
  );
});

test('Turnstile kapalı mod, token sınırı ve sağlayıcı yanıt hatalarını korur', async () => {
  assert.doesNotThrow(() => assertBookingBotProtectionConfigured('development', 'disabled'));

  let disabledFetchCalled = false;
  await verifyBookingBotChallenge({
    token: undefined,
    remoteIp: undefined,
    idempotencyKey: '9c3715de-f949-469a-bc06-a00af46cf9b6',
    fetchImpl: async () => {
      disabledFetchCalled = true;
      throw new Error('disabled mode must not call provider');
    },
  });
  assert.equal(disabledFetchCalled, false);

  const configuration = {
    mode: 'turnstile' as const,
    secretKey: 'server-only-secret',
    expectedHostname: 'example.com',
    timeoutMs: 1_000,
  };
  for (const token of ['   ', 'x'.repeat(2_049)]) {
    await assert.rejects(
      verifyBookingBotChallenge({
        token,
        remoteIp: undefined,
        idempotencyKey: '9c3715de-f949-469a-bc06-a00af46cf9b6',
        configuration,
      }),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  }

  const providerCases = [
    { response: new Response(null, { status: 502 }), statusCode: 503 },
    {
      response: new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      statusCode: 503,
    },
    {
      response: new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      statusCode: 503,
    },
    {
      response: new Response(
        JSON.stringify({
          success: false,
          hostname: 'example.com',
          action: 'booking_application',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      statusCode: 400,
    },
    {
      response: new Response(
        JSON.stringify({ success: true, hostname: 'example.com', action: 'wrong-action' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      statusCode: 400,
    },
  ];

  for (const { response, statusCode } of providerCases) {
    await assert.rejects(
      verifyBookingBotChallenge({
        token: 'opaque-client-token',
        remoteIp: undefined,
        idempotencyKey: '9c3715de-f949-469a-bc06-a00af46cf9b6',
        configuration,
        fetchImpl: async () => response,
      }),
      (error: unknown) => error instanceof AppError && error.statusCode === statusCode,
    );
  }
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
  const uniqueNetwork = randomUUID().slice(0, 4);

  for (let index = 0; index < 10; index += 1) {
    const response = await request(app)
      .post('/api/v1/booking-applications')
      .set('X-Forwarded-For', `2001:db8:${uniqueNetwork}:${(0x1200 + index).toString(16)}::1`)
      .send({});
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
    assert.equal(typeof response.body.requestId, 'string');
    assert.equal(Array.isArray(response.body.fieldErrors), true);
  }

  const limited = await request(app)
    .post('/api/v1/booking-applications')
    .set('X-Forwarded-For', `2001:db8:${uniqueNetwork}:120a::1`)
    .send({});
  assert.equal(limited.status, 429);
  assert.equal(limited.body.success, false);
  assert.equal(limited.body.statusCode, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
  assert.equal(typeof limited.body.correlationId, 'string');
  assert.equal(limited.body.requestId, limited.body.correlationId);
  assert.equal(Number.isInteger(limited.body.retryAfterSeconds), true);
  assert.equal(limited.headers['cache-control'], 'no-store');
});

test('public başvuru geçerli UUID idempotency anahtarı olmadan işleme alınmaz', async () => {
  const bookingBody = {
    brideFirstName: 'Ayşe',
    brideLastName: 'Yılmaz',
    bridePhone: '+90 555 123 45 67',
    groomFirstName: 'Mehmet',
    groomLastName: 'Demir',
    groomPhone: '05559876543',
    primaryContact: 'GELIN',
    primaryEmail: 'ayse@example.com',
    weddingDate: '2099-08-10',
    startTime: '19:00',
    endTime: '23:00',
    endsNextDay: false,
    venueId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
    packageCode: 'mini',
    serviceCodes: [],
    paymentMethod: 'CASH',
    privacyConsent: true,
    marketingConsent: false,
  };

  const missing = await request(createApp())
    .post('/api/v1/booking-applications')
    .set('Payment-Flow-Key', 'payment-flow-key-with-at-least-32-characters')
    .send(bookingBody);
  const malformed = await request(createApp())
    .post('/api/v1/booking-applications')
    .set('Payment-Flow-Key', 'payment-flow-key-with-at-least-32-characters')
    .set('Idempotency-Key', 'not-a-uuid')
    .send(bookingBody);

  assert.equal(missing.status, 400);
  assert.equal(malformed.status, 400);
  assert.match(missing.body.message, /Idempotency-Key/);
  assert.match(malformed.body.message, /UUID/);
});

test('CORS preflight CSRF, idempotency, ödeme akışı ve correlation başlıklarına izin verir', async () => {
  const integrationApp = createApp((application) => {
    application.post('/api/test', (_req, res) => {
      res.json({ success: true });
    });
  });
  const response = await request(integrationApp)
    .options('/api/test')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'POST')
    .set(
      'Access-Control-Request-Headers',
      'x-csrf-token,idempotency-key,payment-flow-key,turnstile-token,x-correlation-id',
    );

  assert.equal(response.status, 204);
  const allowedHeaders = String(response.headers['access-control-allow-headers']).toLowerCase();
  assert.ok(allowedHeaders.includes('x-csrf-token'));
  assert.ok(allowedHeaders.includes('idempotency-key'));
  assert.ok(allowedHeaders.includes('payment-flow-key'));
  assert.ok(allowedHeaders.includes('turnstile-token'));
  assert.ok(allowedHeaders.includes('x-correlation-id'));
  assert.equal(String(response.headers['access-control-allow-methods']).includes('PUT'), false);
});

authTest('bozuk cookie auth endpointini 500 hatasına düşürmez ve cookie temizler', async () => {
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

authTest('yinelenen session cookie HTTP parameter pollution olarak reddedilir', async () => {
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

test('reddedilen çapraz kaynaklı istekler genel API kotasını tüketmez', async () => {
  const integrationApp = createApp((application) => {
    application.get('/api/test', (_req, res) => {
      res.json({ success: true });
    });
  });

  for (let requestIndex = 0; requestIndex < 101; requestIndex += 1) {
    const blockedResponse = await request(integrationApp)
      .get('/api/test')
      .set('Origin', 'https://attacker.example');

    assert.equal(blockedResponse.status, 403);
  }

  for (let requestIndex = 0; requestIndex < 101; requestIndex += 1) {
    const blockedResponse = await request(integrationApp)
      .get('/api/test')
      .set('Sec-Fetch-Site', 'cross-site');

    assert.equal(blockedResponse.status, 403);
  }

  const legitimateResponse = await request(integrationApp)
    .get('/api/test')
    .set('Origin', 'http://localhost:3000')
    .set('Sec-Fetch-Site', 'cross-site');

  assert.equal(legitimateResponse.status, 200);
  assert.equal(legitimateResponse.body.success, true);
  assert.equal(legitimateResponse.headers['ratelimit-remaining'], '299');

  for (let requestIndex = 0; requestIndex < 299; requestIndex += 1) {
    const allowedResponse = await request(integrationApp)
      .get('/api/test')
      .set('Origin', 'http://localhost:3000')
      .set('Sec-Fetch-Site', 'cross-site');

    assert.equal(allowedResponse.status, 200);
  }

  const rateLimitedResponse = await request(integrationApp)
    .get('/api/test')
    .set('Origin', 'http://localhost:3000')
    .set('Sec-Fetch-Site', 'cross-site');

  assert.equal(rateLimitedResponse.status, 429);
  assert.equal(rateLimitedResponse.body.success, false);
  assert.equal(rateLimitedResponse.body.statusCode, 429);
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

test('ödeme talimatları test modunda açık uyarı ve yalnız gerekli bilgileri döndürür', async () => {
  const app = createApp();
  const response = await request(app).get('/api/v1/payment-instructions');

  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.data.mode, 'test');
  assert.equal(response.body.data.enabled, true);
  assert.equal(response.body.data.iban, 'TR000000000000000000000000');
  assert.match(response.body.data.notice, /gerçek para göndermeyin/i);
  assert.equal('idempotencyKey' in response.body.data, false);
});

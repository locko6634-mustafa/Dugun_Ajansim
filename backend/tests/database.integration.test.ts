import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.config.js';
import { prisma } from '../src/config/prisma.js';
import { CSRF_COOKIE_NAME } from '../src/middlewares/auth.middleware.js';
import { assertSafeLocalTestDatabase } from '../src/scripts/testDatabaseGuard.js';
import {
  approveBookingApplication,
  createBookingApplication,
} from '../src/services/booking.service.js';
import { decryptValue, hashPassword, hashToken, verifyPassword } from '../src/utils/crypto.js';
import {
  addCalendarDays,
  deliveryEncryptionAad,
  getIstanbulDate,
  messageSecretEncryptionAad,
} from '../src/utils/domain.js';

assertSafeLocalTestDatabase();

after(async () => {
  await prisma.$disconnect();
});

test('test veritabanı guard yalnızca açık yerel hedefi kabul eder', () => {
  const safeEnvironment = { ...process.env };
  const unsafeEnvironments = [
    { ...safeEnvironment, TEST_DATABASE_GUARD: undefined },
    {
      ...safeEnvironment,
      DATABASE_URL: 'postgresql://test_user:test_password@example.com:55632/dugun_ajansim_test',
    },
    {
      ...safeEnvironment,
      DATABASE_URL: 'postgresql://test_user:test_password@localhost:5432/dugun_ajansim_test',
    },
    {
      ...safeEnvironment,
      DATABASE_URL: 'postgresql://test_user:test_password@localhost:55632/baska_test',
    },
  ];

  assert.doesNotThrow(() => assertSafeLocalTestDatabase(safeEnvironment));
  for (const unsafeEnvironment of unsafeEnvironments) {
    assert.throws(() => assertSafeLocalTestDatabase(unsafeEnvironment));
  }
});

test('migration ile oluşturulan tablo ve gerçek healthcheck birlikte çalışır', async (context) => {
  assert.equal(env.ADMIN_SESSION_IDLE_MINUTES, 30);
  assert.equal(env.CUSTOMER_SESSION_IDLE_HOURS, 12);
  assert.equal(env.TEMPORARY_PASSWORD_TTL_HOURS, 72);
  const healthRecord = await prisma.systemHealth.create({
    data: { status: 'integration-test' },
  });

  context.after(async () => {
    await prisma.systemHealth.delete({ where: { id: healthRecord.id } });
  });

  const storedRecord = await prisma.systemHealth.findUnique({
    where: { id: healthRecord.id },
  });
  assert.equal(storedRecord?.status, 'integration-test');

  const userDefault = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'mustChangePassword'
  `;
  assert.equal(userDefault[0]?.column_default, null);

  const response = await request(createApp()).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.database, 'connected');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('expired, revoked, idle, disabled ve süresi dolmuş geçici kimlikler reddedilir', async (context) => {
  const marker = `guard-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const password = 'yalnizca-guard-entegrasyon-parolasi';
  const user = await prisma.user.create({
    data: {
      username: marker,
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
      temporaryPasswordExpiresAt: null,
      passwordChangedAt: new Date(),
    },
  });
  context.after(async () => {
    await prisma.user.delete({ where: { id: user.id } });
  });
  const app = createApp();
  const sessionCookie = (token: string) => `${env.SESSION_COOKIE_NAME}=${token}`;
  const now = Date.now();

  await assert.rejects(
    prisma.user.update({
      where: { id: user.id },
      data: { temporaryPasswordExpiresAt: new Date(now + 60_000) },
    }),
  );
  await assert.rejects(
    prisma.authSession.create({
      data: {
        tokenHash: hashToken(`${marker}-invalid-expiry`),
        csrfTokenHash: hashToken(`${marker}-invalid-expiry-csrf`),
        userId: user.id,
        createdAt: new Date(now),
        expiresAt: new Date(now - 1),
      },
    }),
  );

  const expiredToken = `${marker}-expired`;
  const expiredSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(expiredToken),
      csrfTokenHash: hashToken(`${expiredToken}-csrf`),
      userId: user.id,
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
      lastUsedAt: new Date(now - 2 * 60 * 60 * 1000),
      expiresAt: new Date(now - 60 * 60 * 1000),
    },
  });
  assert.equal(
    (await request(app).get('/api/v1/auth/session').set('Cookie', sessionCookie(expiredToken)))
      .status,
    401,
  );
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: expiredSession.id } })).revokedAt,
  );

  const revokedToken = `${marker}-revoked`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(revokedToken),
      csrfTokenHash: hashToken(`${revokedToken}-csrf`),
      userId: user.id,
      expiresAt: new Date(now + 60 * 60 * 1000),
      revokedAt: new Date(),
    },
  });
  assert.equal(
    (await request(app).get('/api/v1/auth/session').set('Cookie', sessionCookie(revokedToken)))
      .status,
    401,
  );

  const idleToken = `${marker}-idle`;
  const idleSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(idleToken),
      csrfTokenHash: hashToken(`${idleToken}-csrf`),
      userId: user.id,
      createdAt: new Date(now - 60 * 60 * 1000),
      lastUsedAt: new Date(now - 31 * 60 * 1000),
      expiresAt: new Date(now + 60 * 60 * 1000),
    },
  });
  assert.equal(
    (await request(app).get('/api/v1/auth/session').set('Cookie', sessionCookie(idleToken))).status,
    401,
  );
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: idleSession.id } })).revokedAt,
  );

  const disabledToken = `${marker}-disabled`;
  const disabledSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(disabledToken),
      csrfTokenHash: hashToken(`${disabledToken}-csrf`),
      userId: user.id,
      expiresAt: new Date(now + 60 * 60 * 1000),
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
  assert.equal(
    (await request(app).get('/api/v1/auth/session').set('Cookie', sessionCookie(disabledToken)))
      .status,
    401,
  );
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: disabledSession.id } })).revokedAt,
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: 'ACTIVE',
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(now - 1),
      passwordChangedAt: null,
    },
  });
  const expiredTemporaryLogin = await request(app).post('/api/v1/auth/login').send({
    username: user.username,
    password,
    remember: false,
  });
  const unknownLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({
      username: `${marker}-unknown`,
      password,
      remember: false,
    });
  assert.equal(expiredTemporaryLogin.status, 401);
  assert.equal(unknownLogin.status, 401);
  assert.equal(expiredTemporaryLogin.body.message, unknownLogin.body.message);
});

test('başvuru, atomik onay, rol izolasyonu ve gizli teslimat uçtan uca çalışır', async (context) => {
  const marker = `it-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const correlationId = `integration-${marker}`;
  const weddingDate = addCalendarDays(getIstanbulDate(new Date()), 30);
  let venueId: string | undefined;
  let secondaryVenueId: string | undefined;
  let adminId: string | undefined;
  let managerId: string | undefined;
  const staffIds: string[] = [];

  context.after(async () => {
    await prisma.auditLog.deleteMany({ where: { correlationId } });
    const applications = await prisma.bookingApplication.findMany({
      where: { primaryEmail: { contains: marker } },
      select: { id: true },
    });
    const applicationIds = applications.map((item) => item.id);
    const weddings = await prisma.wedding.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { id: true, customerUserId: true },
    });
    await prisma.wedding.deleteMany({ where: { id: { in: weddings.map((item) => item.id) } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: weddings.map((item) => item.customerUserId) } },
    });
    await prisma.bookingApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.package.deleteMany({ where: { code: { contains: marker } } });
    if (managerId) await prisma.user.deleteMany({ where: { id: managerId } });
    if (secondaryVenueId) await prisma.venue.deleteMany({ where: { id: secondaryVenueId } });
    if (venueId) await prisma.venue.deleteMany({ where: { id: venueId } });
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
  });

  const venue = await prisma.venue.create({
    data: { slug: marker, name: `Test Salonu ${marker}` },
  });
  venueId = venue.id;
  const packageRecord = await prisma.package.create({
    data: {
      code: marker,
      name: `Test Paketi ${marker}`,
      priceCents: 2_000_000,
    },
  });
  const admin = await prisma.user.create({
    data: {
      username: `admin-${marker}`,
      passwordHash: await hashPassword('Guvenli-Test-123'),
      role: 'ADMIN',
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });
  adminId = admin.id;

  const applicationInput = {
    brideFirstName: 'Ayşe',
    brideLastName: 'Yılmaz',
    bridePhone: '05551234567',
    groomFirstName: 'Mehmet',
    groomLastName: 'Demir',
    groomPhone: '05559876543',
    primaryContact: 'GELIN' as const,
    primaryEmail: `bir-${marker}@example.com`,
    weddingDate,
    startTime: '20:00',
    endTime: '02:00',
    endsNextDay: true,
    venueId: venue.id,
    packageCode: packageRecord.code,
    serviceCodes: [],
    paymentMethod: 'CASH' as const,
    note: '',
    privacyConsent: true,
    marketingConsent: false,
  };
  const firstApplication = await createBookingApplication(applicationInput, {
    source: 'PUBLIC_FORM',
    idempotencyKey: `${marker}-idempotent`,
    correlationId,
  });
  const duplicateApplication = await createBookingApplication(applicationInput, {
    source: 'PUBLIC_FORM',
    idempotencyKey: `${marker}-idempotent`,
    correlationId,
  });
  assert.equal(duplicateApplication.id, firstApplication.id);
  assert.equal(firstApplication.totalPriceCents, 1_800_000);
  await assert.rejects(
    prisma.bookingApplication.update({
      where: { id: firstApplication.id },
      data: { payableNowCents: 1 },
    }),
  );
  await assert.rejects(
    prisma.bookingApplication.update({
      where: { id: firstApplication.id },
      data: { weddingEndsAt: new Date(`${weddingDate}T17:00:00.000Z`) },
    }),
  );
  const concurrentIdempotencyKey = `${marker}-concurrent-idempotency`;
  const concurrentApplications = await Promise.all([
    createBookingApplication(
      { ...applicationInput, primaryEmail: `eszamanli-${marker}@example.com` },
      {
        source: 'PUBLIC_FORM',
        idempotencyKey: concurrentIdempotencyKey,
        correlationId,
      },
    ),
    createBookingApplication(
      { ...applicationInput, primaryEmail: `eszamanli-${marker}@example.com` },
      {
        source: 'PUBLIC_FORM',
        idempotencyKey: concurrentIdempotencyKey,
        correlationId,
      },
    ),
  ]);
  assert.equal(concurrentApplications[0].id, concurrentApplications[1].id);
  assert.equal(
    await prisma.bookingApplication.count({
      where: { idempotencyKey: concurrentIdempotencyKey },
    }),
    1,
  );
  await assert.rejects(
    createBookingApplication(
      {
        ...applicationInput,
        brideFirstName: 'Farkli',
      },
      {
        source: 'PUBLIC_FORM',
        idempotencyKey: `${marker}-idempotent`,
        correlationId,
      },
    ),
    (error: unknown) =>
      error instanceof Error &&
      'statusCode' in error &&
      (error as { statusCode: number }).statusCode === 409,
  );

  // Aynı salon ve saat aralığında çakışan başvuru reddedilmelidir (400 Bad Request)
  await assert.rejects(
    createBookingApplication(
      {
        ...applicationInput,
        primaryEmail: `cakisan-${marker}@example.com`,
      },
      {
        source: 'PUBLIC_FORM',
        idempotencyKey: `${marker}-conflicting-test`,
        correlationId,
      },
    ),
    (error: unknown) =>
      error instanceof Error &&
      'statusCode' in error &&
      (error as { statusCode: number }).statusCode === 400,
  );

  const secondApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: addCalendarDays(weddingDate, 1),
      brideFirstName: 'Elif',
      groomFirstName: 'Can',
      primaryEmail: `iki-${marker}@example.com`,
    },
    {
      source: 'ADMIN',
      idempotencyKey: `${marker}-second`,
      actor: { id: admin.id },
      correlationId,
    },
  );

  const retryApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: addCalendarDays(weddingDate, 2),
      brideFirstName: 'Derya',
      groomFirstName: 'Mert',
      primaryEmail: `retry-${marker}@example.com`,
    },
    {
      source: 'ADMIN',
      idempotencyKey: `${marker}-username-retry`,
      actor: { id: admin.id },
      correlationId,
    },
  );
  let usernameAttempts = 0;
  const retryUsername = `retry-${marker}`;
  const retriedApproval = await approveBookingApplication(
    retryApplication.id,
    admin.id,
    correlationId,
    {
      createUsername: async () => {
        usernameAttempts += 1;
        return usernameAttempts === 1 ? admin.username : retryUsername;
      },
    },
  );
  assert.equal(usernameAttempts, 2);
  assert.equal(retriedApproval.username, retryUsername);

  const concurrentApprovals = await Promise.allSettled([
    approveBookingApplication(firstApplication.id, admin.id, correlationId),
    approveBookingApplication(firstApplication.id, admin.id, correlationId),
  ]);
  assert.equal(concurrentApprovals.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentApprovals.filter((result) => result.status === 'rejected').length, 1);
  const rejectedApprovalResult = concurrentApprovals.find((result) => result.status === 'rejected');
  assert.ok(rejectedApprovalResult);
  assert.equal(
    rejectedApprovalResult.reason instanceof Error && 'statusCode' in rejectedApprovalResult.reason
      ? (rejectedApprovalResult.reason as { statusCode: unknown }).statusCode
      : undefined,
    409,
  );
  assert.equal(await prisma.wedding.count({ where: { applicationId: firstApplication.id } }), 1);
  const firstApprovalResult = concurrentApprovals.find((result) => result.status === 'fulfilled');
  assert.ok(firstApprovalResult);
  const firstApproval = firstApprovalResult.value;
  const secondApproval = await approveBookingApplication(
    secondApplication.id,
    admin.id,
    correlationId,
  );
  assert.notEqual(firstApproval.username, secondApproval.username);

  const wedding = await prisma.wedding.findUniqueOrThrow({
    where: { id: firstApproval.weddingId },
    include: { customerUser: true, delivery: true, messageTasks: true },
  });
  assert.ok(wedding.delivery);
  assert.equal(wedding.messageTasks.length, 2);
  const activationTask = wedding.messageTasks.find((task) => task.kind === 'ACCOUNT_ACTIVATION');
  assert.ok(
    activationTask?.secretCiphertext && activationTask.secretIv && activationTask.secretAuthTag,
  );
  const temporaryPassword = decryptValue(
    {
      ciphertext: activationTask.secretCiphertext,
      iv: activationTask.secretIv,
      authTag: activationTask.secretAuthTag,
    },
    messageSecretEncryptionAad(wedding.id, activationTask.kind),
  );
  assert.equal(await verifyPassword(wedding.customerUser.passwordHash, temporaryPassword), true);
  assert.notEqual(temporaryPassword, weddingDate.replaceAll('-', ''));
  assert.equal(activationTask.encryptionVersion, 2);
  assert.equal(wedding.delivery?.encryptionVersion, 2);
  assert.ok(wedding.customerUser.temporaryPasswordExpiresAt);
  assert.ok(wedding.customerUser.activeAt);
  assert.equal(
    wedding.customerUser.temporaryPasswordExpiresAt.valueOf() -
      wedding.customerUser.activeAt.valueOf(),
    env.TEMPORARY_PASSWORD_TTL_HOURS * 60 * 60 * 1000,
  );
  assert.equal(wedding.endsAt.toISOString(), `${weddingDate}T23:00:00.000Z`);
  assert.equal(
    wedding.delivery?.dueDate.toISOString().slice(0, 10),
    addCalendarDays(weddingDate, 21),
  );

  const preActivationToken = `${marker}-pre-activation-session-token`;
  const preActivationSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(preActivationToken),
      csrfTokenHash: hashToken(`${marker}-pre-activation-csrf`),
      userId: wedding.customerUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const app = createApp();
  const publicRouteApplication = await request(app)
    .post('/api/v1/booking-applications')
    .set('X-Correlation-ID', correlationId)
    .set('Idempotency-Key', `${marker}-public-route-key`)
    .send({
      ...applicationInput,
      brideFirstName: 'Route',
      groomFirstName: 'Public',
      primaryEmail: `route-${marker}@example.com`,
    });
  assert.equal(publicRouteApplication.status, 201);
  assert.equal(publicRouteApplication.headers['cache-control'], 'no-store');
  assert.equal('idempotencyKey' in publicRouteApplication.body.data, false);

  const beforeActivation = await request(app)
    .get('/api/v1/customer/dashboard')
    .set('Cookie', `${env.SESSION_COOKIE_NAME}=${preActivationToken}`);
  assert.equal(beforeActivation.status, 401);
  const revokedPreActivationSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: preActivationSession.id },
  });
  assert.ok(revokedPreActivationSession.revokedAt);

  await prisma.user.update({
    where: { id: wedding.customerUserId },
    data: { activeAt: new Date(Date.now() - 60_000) },
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set('X-Correlation-ID', correlationId)
    .send({
      username: wedding.customerUser.username,
      password: temporaryPassword,
      remember: true,
    });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.mustChangePassword, true);
  const loginCookies = login.headers['set-cookie'] as unknown as string[];
  const loginSessionCookie = loginCookies.find((cookie) =>
    cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`),
  );
  const loginCsrfCookie = loginCookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`));
  assert.ok(loginSessionCookie);
  assert.ok(loginCsrfCookie);
  let customerCookie = loginSessionCookie.split(';', 1)[0];
  let customerCsrfCookie = loginCsrfCookie.split(';', 1)[0];
  const customerToken = customerCookie.slice(`${env.SESSION_COOKIE_NAME}=`.length);
  let customerCsrfToken = customerCsrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);

  const secondarySession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(`${marker}-secondary-session-token`),
      csrfTokenHash: hashToken(`${marker}-secondary-csrf`),
      userId: wedding.customerUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const forcedPasswordChange = await request(app)
    .get('/api/v1/customer/dashboard')
    .set('Cookie', customerCookie);
  assert.equal(forcedPasswordChange.status, 428);

  const passwordHashBeforeCsrfFailure = (
    await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })
  ).passwordHash;
  const csrfRejectedPasswordChange = await request(app)
    .post('/api/v1/auth/password/change')
    .set('Cookie', `${customerCookie}; ${customerCsrfCookie}`)
    .send({
      currentPassword: temporaryPassword,
      newPassword: 'csrf-olmadan-kullanilamayacak-kalici-parola',
    });
  assert.equal(csrfRejectedPasswordChange.status, 403);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })).passwordHash,
    passwordHashBeforeCsrfFailure,
  );

  const passwordChange = await request(app)
    .post('/api/v1/auth/password/change')
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', `${customerCookie}; ${customerCsrfCookie}`)
    .set('X-CSRF-Token', customerCsrfToken)
    .send({
      currentPassword: temporaryPassword,
      newPassword: 'yalnizca-entegrasyonda-kullanilan-kalici-parola',
    });
  assert.equal(passwordChange.status, 200);
  const rotatedSessionCookie = (passwordChange.headers['set-cookie'] as unknown as string[]).find(
    (cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`),
  );
  const rotatedCsrfCookie = (passwordChange.headers['set-cookie'] as unknown as string[]).find(
    (cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`),
  );
  assert.ok(rotatedSessionCookie);
  assert.ok(rotatedCsrfCookie);
  customerCookie = rotatedSessionCookie.split(';', 1)[0];
  customerCsrfCookie = rotatedCsrfCookie.split(';', 1)[0];
  customerCsrfToken = customerCsrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);

  const invalidatedTemporaryTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: activationTask.id },
  });
  assert.equal(invalidatedTemporaryTask.status, 'CANCELLED');
  assert.equal(invalidatedTemporaryTask.secretCiphertext, null);
  assert.equal(invalidatedTemporaryTask.secretIv, null);
  assert.equal(invalidatedTemporaryTask.secretAuthTag, null);
  const changedCustomer = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId },
  });
  assert.equal(changedCustomer.mustChangePassword, false);
  assert.equal(changedCustomer.temporaryPasswordExpiresAt, null);
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: secondarySession.id } })).revokedAt,
  );

  const rotatedOldSession = await request(app)
    .get('/api/v1/customer/dashboard')
    .set('Cookie', `${env.SESSION_COOKIE_NAME}=${customerToken}`);
  assert.equal(rotatedOldSession.status, 401);
  const ownDashboard = await request(app)
    .get(`/api/v1/customer/dashboard?weddingId=${secondApproval.weddingId}`)
    .set('Cookie', customerCookie);
  assert.equal(ownDashboard.status, 200);
  assert.equal(ownDashboard.body.data.couple.bride, 'Ayşe Yılmaz');

  const adminToken = `${marker}-admin-session-token`;
  const adminCsrfToken = `${marker}-admin-csrf`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(adminToken),
      csrfTokenHash: hashToken(adminCsrfToken),
      userId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const adminCookie = `${env.SESSION_COOKIE_NAME}=${adminToken}`;
  const adminAuthCookie = `${adminCookie}; ${CSRF_COOKIE_NAME}=${adminCsrfToken}`;
  const adminForbidden = await request(app)
    .get('/api/v1/customer/dashboard')
    .set('Cookie', adminCookie);
  assert.equal(adminForbidden.status, 403);
  const applicationLookup = await request(app)
    .get(`/api/v1/admin/booking-applications?referenceCode=${firstApplication.referenceCode}`)
    .set('Cookie', adminCookie);
  assert.equal(applicationLookup.status, 200);
  assert.equal(applicationLookup.body.data.length, 1);
  assert.equal(applicationLookup.body.data[0].id, firstApplication.id);
  assert.equal('idempotencyKey' in applicationLookup.body.data[0], false);
  assert.equal('idempotencyFingerprint' in applicationLookup.body.data[0], false);
  const applicationDetail = await request(app)
    .get(`/api/v1/admin/booking-applications/${firstApplication.id}`)
    .set('Cookie', adminCookie);
  assert.equal(applicationDetail.status, 200);
  assert.equal('idempotencyKey' in applicationDetail.body.data, false);
  assert.equal('idempotencyFingerprint' in applicationDetail.body.data, false);

  const createdStaff = await request(app)
    .post('/api/v1/admin/staff')
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      firstName: 'Deniz',
      lastName: 'Kamera',
      phone: '05551112233',
      venueId: venue.id,
      specialties: ['PHOTOGRAPHY', 'VIDEO'],
      isActive: true,
    });
  assert.equal(createdStaff.status, 201);
  staffIds.push(createdStaff.body.data.id as string);
  assert.equal(createdStaff.body.data.phone, '+905551112233');

  const createdManager = await request(app)
    .post('/api/v1/admin/venue-managers')
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      username: `sorumlu-${marker}`,
      password: 'Manager-Test-2026!',
      venueId: venue.id,
      status: 'ACTIVE',
    });
  assert.equal(createdManager.status, 201);
  managerId = createdManager.body.data.id as string;
  await prisma.user.update({
    where: { id: managerId },
    data: {
      mustChangePassword: false,
      temporaryPasswordExpiresAt: null,
      passwordChangedAt: new Date(),
    },
  });
  const managerToken = `${marker}-manager-token`;
  const managerCsrfToken = `${marker}-manager-csrf`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(managerToken),
      csrfTokenHash: hashToken(managerCsrfToken),
      userId: managerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const managerCookie = `${env.SESSION_COOKIE_NAME}=${managerToken}`;
  const managerAuthCookie = `${managerCookie}; ${CSRF_COOKIE_NAME}=${managerCsrfToken}`;
  const secondaryVenue = await prisma.venue.create({
    data: { slug: `other-${marker}`, name: `Diğer Salon ${marker}` },
  });
  secondaryVenueId = secondaryVenue.id;
  const foreignStaff = await prisma.staff.create({
    data: {
      firstName: 'Başka',
      lastName: 'Salon',
      phone: '+905559990011',
      specialties: ['VIDEO'],
      venueId: secondaryVenue.id,
    },
  });
  staffIds.push(foreignStaff.id);

  const venueOperationsDashboard = await request(app)
    .get('/api/v1/operations/dashboard')
    .set('Cookie', managerCookie);
  assert.equal(venueOperationsDashboard.status, 200);
  assert.equal(venueOperationsDashboard.body.data.venue.id, venue.id);
  const operationsWeddingUpdate = await request(app)
    .patch(`/api/v1/operations/weddings/${wedding.id}`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', managerAuthCookie)
    .set('X-CSRF-Token', managerCsrfToken)
    .send({
      weddingDate,
      startTime: '20:00',
      endTime: '02:00',
      endsNextDay: true,
      note: 'Salon sorumlusu operasyon notu',
    });
  assert.equal(operationsWeddingUpdate.status, 200);
  const applicationAfterOperationsUpdate = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: wedding.applicationId },
  });
  assert.equal(applicationAfterOperationsUpdate.note, 'Salon sorumlusu operasyon notu');
  const operationsStaff = await request(app)
    .get('/api/v1/operations/staff')
    .set('Cookie', managerCookie);
  assert.equal(operationsStaff.status, 200);
  assert.equal(
    operationsStaff.body.data.some(
      (staff: { id: string }) => staff.id === createdStaff.body.data.id,
    ),
    true,
  );
  assert.equal(
    operationsStaff.body.data.some((staff: { id: string }) => staff.id === foreignStaff.id),
    false,
  );
  const updatedOwnStaff = await request(app)
    .patch(`/api/v1/operations/staff/${createdStaff.body.data.id}`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', managerAuthCookie)
    .set('X-CSRF-Token', managerCsrfToken)
    .send({ firstName: 'Denizcan' });
  assert.equal(updatedOwnStaff.status, 200);
  const rejectedForeignStaff = await request(app)
    .patch(`/api/v1/operations/staff/${foreignStaff.id}`)
    .set('Cookie', managerAuthCookie)
    .set('X-CSRF-Token', managerCsrfToken)
    .send({ firstName: 'Erişilmemeli' });
  assert.equal(rejectedForeignStaff.status, 404);

  const invalidStaff = await request(app)
    .post('/api/v1/admin/staff')
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({ firstName: 'Eksik', lastName: 'Uzmanlık', phone: '05551112244', specialties: [] });
  assert.equal(invalidStaff.status, 400);

  const firstAssignment = await request(app)
    .post(`/api/v1/admin/weddings/${wedding.id}/assignments`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      staffId: createdStaff.body.data.id,
      specialty: 'PHOTOGRAPHY',
      allowConflict: false,
    });
  assert.equal(firstAssignment.status, 201);

  const rejectedConflict = await request(app)
    .post(`/api/v1/admin/weddings/${secondApproval.weddingId}/assignments`)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      staffId: createdStaff.body.data.id,
      specialty: 'VIDEO',
      allowConflict: false,
    });
  assert.equal(rejectedConflict.status, 409);
  assert.equal(rejectedConflict.body.errors.code, 'STAFF_CONFLICT');
  assert.equal(rejectedConflict.body.errors.conflicts.length, 1);

  const allowedConflict = await request(app)
    .post(`/api/v1/admin/weddings/${secondApproval.weddingId}/assignments`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      staffId: createdStaff.body.data.id,
      specialty: 'VIDEO',
      allowConflict: true,
    });
  assert.equal(allowedConflict.status, 201);
  assert.equal(allowedConflict.body.data.hasConflict, true);

  const operationsDashboard = await request(app)
    .get(`/api/v1/admin/dashboard?weekStart=${weddingDate}`)
    .set('Cookie', adminCookie);
  assert.equal(operationsDashboard.status, 200);
  assert.equal(operationsDashboard.body.data.conflicts.length, 1);
  assert.equal(operationsDashboard.body.data.distribution.PHOTOGRAPHY, 1);
  assert.equal(operationsDashboard.body.data.distribution.VIDEO, 1);

  const venueCalendar = await request(app)
    .get(`/api/v1/admin/calendar?month=${weddingDate.slice(0, 7)}&venueId=${venue.id}`)
    .set('Cookie', adminCookie);
  assert.equal(venueCalendar.status, 200);
  assert.equal(venueCalendar.body.data.selectedVenue.id, venue.id);
  assert.equal(venueCalendar.body.data.month, weddingDate.slice(0, 7));
  assert.equal(venueCalendar.body.data.weddings.length, 3);
  assert.equal(
    venueCalendar.body.data.weddings.every(
      (calendarWedding: { venue: { name: string } }) => calendarWedding.venue.name === venue.name,
    ),
    true,
  );

  const invalidCalendarMonth = await request(app)
    .get('/api/v1/admin/calendar?month=2026-13')
    .set('Cookie', adminCookie);
  assert.equal(invalidCalendarMonth.status, 400);

  const weddingDetail = await request(app)
    .get(`/api/v1/admin/weddings/${wedding.id}`)
    .set('Cookie', adminCookie);
  assert.equal(weddingDetail.status, 200);
  assert.equal(weddingDetail.body.data.assignments.length, 1);
  assert.equal(
    JSON.stringify(weddingDetail.body.data.messageTasks).includes('secretCiphertext'),
    false,
  );

  const removedAssignment = await request(app)
    .delete(
      `/api/v1/admin/weddings/${secondApproval.weddingId}/assignments/${allowedConflict.body.data.id}`,
    )
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({});
  assert.equal(removedAssignment.status, 200);

  const archivedStaff = await request(app)
    .patch(`/api/v1/admin/staff/${createdStaff.body.data.id}`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({ isActive: false });
  assert.equal(archivedStaff.status, 200);
  assert.equal(archivedStaff.body.data.isActive, false);

  const routePackageCode = `route-${marker}`;
  const createdRoutePackage = await request(app)
    .post('/api/v1/admin/packages')
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      code: routePackageCode,
      name: 'Route Test Paketi',
      description: null,
      imagePath: null,
      priceCents: 1_000_000,
      isActive: true,
    });
  assert.equal(createdRoutePackage.status, 201);
  const duplicateRoutePackage = await request(app)
    .post('/api/v1/admin/packages')
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      code: routePackageCode,
      name: 'Çakışan Route Test Paketi',
      description: null,
      imagePath: null,
      priceCents: 1_100_000,
      isActive: true,
    });
  assert.equal(duplicateRoutePackage.status, 409);
  const routePackageId = createdRoutePackage.body.data.id as string;
  const patchedRoutePackage = await request(app)
    .patch(`/api/v1/admin/packages/${routePackageId}`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({ priceCents: 1_200_000 });
  assert.equal(patchedRoutePackage.status, 200);
  assert.equal(patchedRoutePackage.body.data.priceCents, 1_200_000);
  const emptyRoutePackagePatch = await request(app)
    .patch(`/api/v1/admin/packages/${routePackageId}`)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({});
  assert.equal(emptyRoutePackagePatch.status, 400);
  const archivedRoutePackage = await request(app)
    .delete(`/api/v1/admin/packages/${routePackageId}`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({});
  assert.equal(archivedRoutePackage.status, 200);
  assert.equal(archivedRoutePackage.body.data.isActive, false);

  const customerPasswordHashBeforeWeddingUpdate = (
    await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })
  ).passwordHash;
  const updatedWeddingDate = addCalendarDays(weddingDate, 1);
  const weddingUpdate = await request(app)
    .patch(`/api/v1/admin/weddings/${wedding.id}`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({
      brideFirstName: wedding.brideFirstName,
      brideLastName: wedding.brideLastName,
      bridePhone: wedding.bridePhone,
      groomFirstName: wedding.groomFirstName,
      groomLastName: wedding.groomLastName,
      groomPhone: '05550001122',
      primaryContact: 'DAMAT',
      primaryEmail: wedding.primaryEmail,
      weddingDate: updatedWeddingDate,
      startTime: '20:00',
      endTime: '02:00',
      endsNextDay: true,
      venueId: wedding.venueId,
      note: wedding.note ?? '',
    });
  assert.equal(weddingUpdate.status, 200);
  assert.equal(weddingUpdate.body.data.credentialsRegenerated, false);
  assert.equal(weddingUpdate.body.data.username, wedding.customerUser.username);
  const customerAfterWeddingUpdate = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId },
  });
  assert.equal(customerAfterWeddingUpdate.passwordHash, customerPasswordHashBeforeWeddingUpdate);
  const linkedDeliveryAfterWeddingUpdate = await prisma.delivery.findUniqueOrThrow({
    where: { id: wedding.delivery!.id },
  });
  assert.equal(
    linkedDeliveryAfterWeddingUpdate.dueDate.toISOString().slice(0, 10),
    addCalendarDays(updatedWeddingDate, 21),
  );
  const preparationAfterWeddingUpdate = await prisma.messageTask.findUniqueOrThrow({
    where: {
      weddingId_kind: { weddingId: wedding.id, kind: 'PREPARATION_UPDATE' },
    },
  });
  assert.equal(preparationAfterWeddingUpdate.recipientPhone, '+905550001122');
  assert.equal(
    preparationAfterWeddingUpdate.dueAt.toISOString(),
    `${addCalendarDays(updatedWeddingDate, 2)}T07:00:00.000Z`,
  );

  const driveUrl = 'https://drive.google.com/file/d/integration-test';
  const preparedDelivery = await request(app)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({ status: 'TESLIME_HAZIR', driveUrl });
  assert.equal(preparedDelivery.status, 200);
  assert.equal(preparedDelivery.body.data.status, 'TESLIME_HAZIR');
  const encryptedDelivery = await prisma.delivery.findUniqueOrThrow({
    where: { id: wedding.delivery!.id },
  });
  assert.ok(
    encryptedDelivery.driveUrlCiphertext &&
      encryptedDelivery.driveUrlIv &&
      encryptedDelivery.driveUrlAuthTag,
  );
  assert.equal(encryptedDelivery.driveUrlCiphertext.includes('drive.google.com'), false);
  assert.equal(
    decryptValue(
      {
        ciphertext: encryptedDelivery.driveUrlCiphertext,
        iv: encryptedDelivery.driveUrlIv,
        authTag: encryptedDelivery.driveUrlAuthTag,
      },
      deliveryEncryptionAad(encryptedDelivery.id),
    ),
    driveUrl,
  );
  const hiddenDelivery = await request(app)
    .get('/api/v1/customer/delivery')
    .set('Cookie', customerCookie);
  assert.equal(hiddenDelivery.status, 404);
  assert.equal(JSON.stringify(ownDashboard.body).includes('drive.google.com'), false);
  const safeAdminWeddings = await request(app)
    .get('/api/v1/admin/weddings')
    .set('Cookie', adminCookie);
  assert.equal(safeAdminWeddings.status, 200);
  assert.equal(JSON.stringify(safeAdminWeddings.body).includes('driveUrlCiphertext'), false);

  await assert.rejects(
    prisma.delivery.update({
      where: { id: wedding.delivery!.id },
      data: { status: 'TESLIM_EDILDI', releasedAt: null },
    }),
  );
  const concurrentDeliveries = await Promise.all([
    request(app)
      .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/deliver`)
      .set('X-Correlation-ID', correlationId)
      .set('Cookie', adminAuthCookie)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({}),
    request(app)
      .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/deliver`)
      .set('X-Correlation-ID', correlationId)
      .set('Cookie', adminAuthCookie)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({}),
  ]);
  assert.deepEqual(concurrentDeliveries.map((response) => response.status).sort(), [200, 409]);
  const deliveryHistory = await prisma.deliveryStatusHistory.findMany({
    where: { deliveryId: wedding.delivery!.id },
  });
  assert.equal(deliveryHistory.filter((entry) => entry.toStatus === 'TESLIM_EDILDI').length, 1);
  await assert.rejects(
    prisma.deliveryStatusHistory.create({
      data: {
        deliveryId: wedding.delivery!.id,
        fromStatus: 'TESLIM_EDILDI',
        toStatus: 'TESLIM_EDILDI',
        actorUserId: admin.id,
      },
    }),
  );
  const deliveryMessage = await prisma.messageTask.findUniqueOrThrow({
    where: {
      weddingId_kind: { weddingId: wedding.id, kind: 'DELIVERY_READY' },
    },
  });
  assert.equal(deliveryMessage.status, 'PENDING');
  const releasedDelivery = await request(app)
    .get('/api/v1/customer/delivery')
    .set('Cookie', customerCookie);
  assert.equal(releasedDelivery.status, 200);
  assert.equal(releasedDelivery.body.data.driveUrl, driveUrl);

  const logout = await request(app)
    .post('/api/v1/auth/logout')
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', `${customerCookie}; ${customerCsrfCookie}`)
    .set('X-CSRF-Token', customerCsrfToken)
    .send({});
  assert.equal(logout.status, 200);
  const loggedOutSession = await request(app)
    .get('/api/v1/auth/session')
    .set('Cookie', customerCookie);
  assert.equal(loggedOutSession.status, 401);

  const passwordReset = await request(app)
    .post(`/api/v1/admin/customers/${wedding.customerUserId}/reset-password`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({});
  assert.equal(passwordReset.status, 200);
  assert.equal(passwordReset.headers['cache-control'], 'no-store');
  const resetTaskId = passwordReset.body.data.taskId as string;
  const pendingResetTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: resetTaskId },
  });
  assert.equal(pendingResetTask.status, 'PENDING');
  assert.ok(
    pendingResetTask.secretCiphertext &&
      pendingResetTask.secretIv &&
      pendingResetTask.secretAuthTag,
  );
  assert.equal(pendingResetTask.encryptionVersion, 2);
  await assert.rejects(
    prisma.messageTask.update({
      where: { id: resetTaskId },
      data: { status: 'SENT', sentAt: new Date(), sentById: admin.id },
    }),
  );
  const resetCustomer = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId },
  });
  assert.equal(resetCustomer.mustChangePassword, true);
  assert.ok(resetCustomer.temporaryPasswordExpiresAt);

  const renderedReset = await request(app)
    .get(`/api/v1/admin/message-tasks/${resetTaskId}/render`)
    .set('Cookie', adminCookie);
  assert.equal(renderedReset.status, 200);
  assert.equal(renderedReset.headers['cache-control'], 'no-store');
  assert.equal(renderedReset.body.data.message.includes('Geçici parolanız'), true);
  const expectedUpdatedAt = renderedReset.body.data.expectedUpdatedAt as string;
  const markedSent = await request(app)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/mark-sent`)
    .set('X-Correlation-ID', correlationId)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({ expectedUpdatedAt });
  assert.equal(markedSent.status, 200);
  const sentResetTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: resetTaskId },
  });
  assert.equal(sentResetTask.status, 'SENT');
  assert.equal(sentResetTask.secretCiphertext, null);
  assert.equal(sentResetTask.secretIv, null);
  assert.equal(sentResetTask.secretAuthTag, null);
  const replayedMarkSent = await request(app)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/mark-sent`)
    .set('Cookie', adminAuthCookie)
    .set('X-CSRF-Token', adminCsrfToken)
    .send({ expectedUpdatedAt });
  assert.equal(replayedMarkSent.status, 409);

  const auditLogs = await prisma.auditLog.findMany({ where: { correlationId } });
  const serializedLogs = JSON.stringify(auditLogs);
  assert.equal(serializedLogs.includes(driveUrl), false);
  assert.equal(serializedLogs.includes(temporaryPassword), false);
  assert.equal(serializedLogs.includes(firstApproval.username), false);
  assert.equal(serializedLogs.includes(applicationInput.bridePhone), false);
  assert.equal(serializedLogs.includes(applicationInput.primaryEmail), false);
  assert.equal(
    wedding.messageTasks.some((task) => task.secretCiphertext === temporaryPassword),
    false,
  );

  const availabilityRes = await request(app).get(
    `/api/v1/public/venues/${venue.id}/availability?date=${weddingDate}`,
  );
  assert.equal(availabilityRes.status, 200);
  assert.equal(availabilityRes.body.success, true);
  assert.ok(Array.isArray(availabilityRes.body.data.occupiedSlots));
});

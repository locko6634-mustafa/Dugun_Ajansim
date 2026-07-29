import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.config.js';
import { prisma } from '../src/config/prisma.js';
import {
  approveBookingApplication,
  createBookingApplication,
} from '../src/services/booking.service.js';
import { encryptValue, hashPassword, hashToken, verifyPassword } from '../src/utils/crypto.js';
import { addCalendarDays, getIstanbulDate, temporaryWeddingPassword } from '../src/utils/domain.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL entegrasyon testi için zorunludur.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ''));

if (process.env.NODE_ENV !== 'test' || !databaseName.endsWith('_test')) {
  throw new Error(
    'Entegrasyon testi yalnızca NODE_ENV=test ve *_test veritabanında çalıştırılabilir.'
  );
}

after(async () => {
  await prisma.$disconnect();
});

test('migration ile oluşturulan tablo ve gerçek healthcheck birlikte çalışır', async (context) => {
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

  const response = await request(createApp()).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.database, 'connected');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('başvuru, atomik onay, rol izolasyonu ve gizli teslimat uçtan uca çalışır', async (context) => {
  const marker = `it-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const correlationId = `integration-${marker}`;
  const weddingDate = addCalendarDays(getIstanbulDate(new Date()), 30);
  const venue = await prisma.venue.create({
    data: { slug: marker, name: `Test Salonu ${marker}` },
  });
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

  context.after(async () => {
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
    await prisma.user.deleteMany({
      where: { id: { in: weddings.map((item) => item.customerUserId) } },
    });
    await prisma.bookingApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.package.delete({ where: { id: packageRecord.id } });
    await prisma.venue.delete({ where: { id: venue.id } });
    await prisma.user.delete({ where: { id: admin.id } });
  });

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

  const secondApplication = await createBookingApplication(
    {
      ...applicationInput,
      brideFirstName: 'Elif',
      groomFirstName: 'Can',
      primaryEmail: `iki-${marker}@example.com`,
    },
    {
      source: 'ADMIN',
      idempotencyKey: `${marker}-second`,
      actor: { id: admin.id },
      correlationId,
    }
  );

  const firstApproval = await approveBookingApplication(
    firstApplication.id,
    admin.id,
    correlationId
  );
  const secondApproval = await approveBookingApplication(
    secondApplication.id,
    admin.id,
    correlationId
  );
  assert.notEqual(firstApproval.username, secondApproval.username);

  const wedding = await prisma.wedding.findUniqueOrThrow({
    where: { id: firstApproval.weddingId },
    include: { customerUser: true, delivery: true, messageTasks: true },
  });
  assert.ok(wedding.delivery);
  assert.equal(wedding.messageTasks.length, 2);
  assert.equal(
    await verifyPassword(wedding.customerUser.passwordHash, temporaryWeddingPassword(weddingDate)),
    true
  );
  assert.equal(wedding.endsAt.toISOString(), `${weddingDate}T23:00:00.000Z`);
  assert.equal(
    wedding.delivery?.dueDate.toISOString().slice(0, 10),
    addCalendarDays(weddingDate, 21)
  );

  const customerToken = `${marker}-customer-session-token`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(customerToken),
      csrfTokenHash: hashToken(`${marker}-csrf`),
      userId: wedding.customerUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const app = createApp();
  const customerCookie = `${env.SESSION_COOKIE_NAME}=${customerToken}`;

  const beforeActivation = await request(app)
    .get('/api/v1/customer/dashboard')
    .set('Cookie', customerCookie);
  assert.equal(beforeActivation.status, 401);

  await prisma.user.update({
    where: { id: wedding.customerUserId },
    data: { activeAt: new Date(Date.now() - 60_000) },
  });
  const forcedPasswordChange = await request(app)
    .get('/api/v1/customer/dashboard')
    .set('Cookie', customerCookie);
  assert.equal(forcedPasswordChange.status, 428);

  await prisma.user.update({
    where: { id: wedding.customerUserId },
    data: { mustChangePassword: false, passwordChangedAt: new Date() },
  });
  const ownDashboard = await request(app)
    .get(`/api/v1/customer/dashboard?weddingId=${secondApproval.weddingId}`)
    .set('Cookie', customerCookie);
  assert.equal(ownDashboard.status, 200);
  assert.equal(ownDashboard.body.data.couple.bride, 'Ayşe Yılmaz');

  const adminToken = `${marker}-admin-session-token`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(adminToken),
      csrfTokenHash: hashToken(`${marker}-admin-csrf`),
      userId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const adminForbidden = await request(app)
    .get('/api/v1/customer/dashboard')
    .set('Cookie', `${env.SESSION_COOKIE_NAME}=${adminToken}`);
  assert.equal(adminForbidden.status, 403);
  const applicationLookup = await request(app)
    .get(`/api/v1/admin/booking-applications?referenceCode=${firstApplication.referenceCode}`)
    .set('Cookie', `${env.SESSION_COOKIE_NAME}=${adminToken}`);
  assert.equal(applicationLookup.status, 200);
  assert.equal(applicationLookup.body.data.length, 1);
  assert.equal(applicationLookup.body.data[0].id, firstApplication.id);

  const driveUrl = 'https://drive.google.com/file/d/integration-test';
  const encryptedDriveUrl = encryptValue(driveUrl);
  await prisma.delivery.update({
    where: { id: wedding.delivery!.id },
    data: {
      status: 'KONTROL',
      driveUrlCiphertext: encryptedDriveUrl.ciphertext,
      driveUrlIv: encryptedDriveUrl.iv,
      driveUrlAuthTag: encryptedDriveUrl.authTag,
    },
  });
  const hiddenDelivery = await request(app)
    .get('/api/v1/customer/delivery')
    .set('Cookie', customerCookie);
  assert.equal(hiddenDelivery.status, 404);
  assert.equal(JSON.stringify(ownDashboard.body).includes('drive.google.com'), false);
  const safeAdminWeddings = await request(app)
    .get('/api/v1/admin/weddings')
    .set('Cookie', `${env.SESSION_COOKIE_NAME}=${adminToken}`);
  assert.equal(safeAdminWeddings.status, 200);
  assert.equal(JSON.stringify(safeAdminWeddings.body).includes('driveUrlCiphertext'), false);

  await prisma.delivery.update({
    where: { id: wedding.delivery!.id },
    data: { status: 'TESLIM_EDILDI', releasedAt: new Date() },
  });
  const releasedDelivery = await request(app)
    .get('/api/v1/customer/delivery')
    .set('Cookie', customerCookie);
  assert.equal(releasedDelivery.status, 200);
  assert.equal(releasedDelivery.body.data.driveUrl, driveUrl);

  const auditLogs = await prisma.auditLog.findMany({ where: { correlationId } });
  const serializedLogs = JSON.stringify(auditLogs);
  assert.equal(serializedLogs.includes(driveUrl), false);
  assert.equal(serializedLogs.includes(temporaryWeddingPassword(weddingDate)), false);
  assert.equal(
    wedding.messageTasks.some(
      (task) => task.secretCiphertext === temporaryWeddingPassword(weddingDate)
    ),
    false
  );
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/crypto.js';
import { assertSafeLocalTestDatabase } from '../src/scripts/testDatabaseGuard.js';

assertSafeLocalTestDatabase();

const apiBaseUrl = process.env.PHASE01_API_URL ?? 'http://127.0.0.1:5000/api/v1';
const acceptanceYear = process.env.PHASE01_ACCEPTANCE_YEAR ?? '2098';
assert.match(acceptanceYear, /^20\d{2}$/);
const ownerPrisma = new PrismaClient();
const marker = randomUUID();
const adminUsername = `phase01-admin-${marker}`;
const adminPassword = `Phase01-${marker}!`;
const references: string[] = [];

const readJson = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? '';
  assert.match(contentType, /^application\/json\b/i);
  return response.json() as Promise<Record<string, any>>;
};

try {
  const [catalogResponse, venuesResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/catalog`),
    fetch(`${apiBaseUrl}/venues`),
  ]);
  assert.equal(catalogResponse.status, 200);
  assert.equal(venuesResponse.status, 200);
  const catalogPayload = await readJson(catalogResponse);
  const venuesPayload = await readJson(venuesResponse);
  const selectedPackage = catalogPayload.data.packages[0];
  const selectedService = catalogPayload.data.services[0];
  const selectedVenue = venuesPayload.data[0];
  assert.ok(selectedPackage?.code);
  assert.ok(selectedService?.code);
  assert.ok(selectedVenue?.id);

  const subtotalCents = selectedPackage.priceCents + selectedService.priceCents;
  const cashTotalCents = Math.round(
    (subtotalCents * (100 - catalogPayload.data.paymentPolicy.cashDiscountPercent)) / 100,
  );
  const depositPayableCents = Math.min(
    catalogPayload.data.paymentPolicy.depositMaximumCents,
    subtotalCents,
  );

  const expectedByReference = new Map<string, Record<string, any>>();
  const ordinalNames = ['Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı'];
  for (let index = 0; index < 6; index += 1) {
    const paymentMethod = index < 3 ? 'CASH' : 'DEPOSIT';
    const brideFirstName = `Sentetik ${ordinalNames[index]}`;
    const groomFirstName = `Deneme ${ordinalNames[index]}`;
    const weddingDate = `${acceptanceYear}-01-${String(index + 10).padStart(2, '0')}`;
    const response = await fetch(`${apiBaseUrl}/booking-applications`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'Payment-Flow-Key': `${randomUUID()}${randomUUID()}`.replaceAll('-', ''),
        'X-Booking-Elapsed-Ms': '5000',
      },
      body: JSON.stringify({
        brideFirstName,
        brideLastName: 'Kabul',
        bridePhone: `05551000${String(index).padStart(3, '0')}`,
        groomFirstName,
        groomLastName: 'Testi',
        groomPhone: `05552000${String(index).padStart(3, '0')}`,
        primaryContact: 'GELIN',
        primaryEmail: `phase01-${marker}-${index}@example.invalid`,
        weddingDate,
        startTime: '19:00',
        endTime: '23:00',
        endsNextDay: false,
        venueId: selectedVenue.id,
        packageCode: selectedPackage.code,
        serviceCodes: [selectedService.code],
        paymentMethod,
        privacyConsent: true,
        marketingConsent: false,
      }),
    });
    assert.equal(response.status, 201);
    const payload = await readJson(response);
    assert.equal(payload.success, true);
    assert.equal(typeof payload.correlationId, 'string');
    assert.equal(payload.data.packageCodeSnapshot, selectedPackage.code);
    assert.equal(payload.data.packagePriceCents, selectedPackage.priceCents);
    assert.deepEqual(payload.data.services, [
      {
        codeSnapshot: selectedService.code,
        nameSnapshot: selectedService.name,
        priceCents: selectedService.priceCents,
      },
    ]);
    const expectedTotalCents = paymentMethod === 'CASH' ? cashTotalCents : subtotalCents;
    const expectedPayableCents =
      paymentMethod === 'CASH' ? cashTotalCents : depositPayableCents;
    assert.equal(payload.data.totalPriceCents, expectedTotalCents);
    assert.equal(payload.data.payableNowCents, expectedPayableCents);
    assert.equal(references.includes(payload.data.referenceCode), false);
    references.push(payload.data.referenceCode);
    expectedByReference.set(payload.data.referenceCode, {
      brideFirstName,
      groomFirstName,
      weddingDate,
      paymentMethod,
      expectedTotalCents,
      expectedPayableCents,
    });
  }

  const admin = await ownerPrisma.user.create({
    data: {
      username: adminUsername,
      passwordHash: await hashPassword(adminPassword),
      role: 'ADMIN',
      mustChangePassword: false,
    },
  });
  try {
    const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUsername, password: adminPassword, remember: false }),
    });
    assert.equal(loginResponse.status, 200);
    const sessionCookie = loginResponse.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ');
    assert.match(sessionCookie, /dugunajansim_session=/);

    const queueResponse = await fetch(`${apiBaseUrl}/admin/booking-applications`, {
      headers: { Accept: 'application/json', Cookie: sessionCookie },
    });
    assert.equal(queueResponse.status, 200);
    const queuePayload = await readJson(queueResponse);
    const acceptedApplications = queuePayload.data.filter((application: Record<string, any>) =>
      references.includes(application.referenceCode),
    );
    assert.equal(acceptedApplications.length, 6);
    for (const application of acceptedApplications) {
      const expected = expectedByReference.get(application.referenceCode)!;
      assert.equal(application.brideFirstName, expected.brideFirstName);
      assert.equal(application.groomFirstName, expected.groomFirstName);
      assert.equal(application.venue.name, selectedVenue.name);
      assert.equal(application.packageCodeSnapshot, selectedPackage.code);
      assert.equal(application.paymentMethod, expected.paymentMethod);
      assert.equal(application.totalPriceCents, expected.expectedTotalCents);
      assert.equal(application.payableNowCents, expected.expectedPayableCents);
      assert.equal(application.services.length, 1);
      assert.equal(application.services[0].codeSnapshot, selectedService.code);
      assert.equal(application.weddingStartsAt.slice(0, 10), expected.weddingDate);
    }
  } finally {
    await ownerPrisma.authSession.deleteMany({ where: { userId: admin.id } });
    await ownerPrisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: admin.id }, { targetId: admin.id }] },
    });
    await ownerPrisma.user.delete({ where: { id: admin.id } });
  }

  console.log(
    JSON.stringify({
      result: 'passed',
      nginx: 'http://127.0.0.1:8181/healthz',
      api: apiBaseUrl,
      cashApplications: 3,
      depositApplications: 3,
      uniqueReferences: references.length,
      adminQueueMatches: 6,
    }),
  );
} finally {
  await ownerPrisma.$disconnect();
}

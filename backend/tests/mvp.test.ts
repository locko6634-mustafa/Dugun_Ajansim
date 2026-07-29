import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingBodySchema, weddingUpdateBodySchema } from '../src/schemas/api.schemas.js';
import { calculatePayment } from '../src/services/booking.service.js';
import { decryptValue, encryptValue, hashPassword, verifyPassword } from '../src/utils/crypto.js';
import {
  addCalendarDays,
  assertGoogleDriveUrl,
  createWeddingRange,
  normalizePhone,
  normalizeUsername,
  temporaryWeddingPassword,
} from '../src/utils/domain.js';

test('gece yarısını aşan düğün aralığı İstanbul saatine göre oluşturulur', () => {
  const range = createWeddingRange('2026-08-10', '20:00', '02:00', true);
  assert.equal(range.startsAt.toISOString(), '2026-08-10T17:00:00.000Z');
  assert.equal(range.endsAt.toISOString(), '2026-08-10T23:00:00.000Z');
  assert.throws(() => createWeddingRange('2026-08-10', '20:00', '19:00', false));
});

test('müşteri kullanıcı adı ve geçici parola kuralları kararlı çalışır', () => {
  assert.equal(normalizeUsername('Yılmaz ÇAĞLAR'), 'yilmaz-caglar');
  assert.equal(temporaryWeddingPassword('2026-06-26'), '26062026');
  assert.equal(addCalendarDays('2026-06-26', 21), '2026-07-17');
  assert.equal(normalizePhone('0555 123 45 67'), '+905551234567');
});

test('fiyat istemciden alınmaz ve ödeme kuralı backend hesabıyla uygulanır', () => {
  assert.deepEqual(calculatePayment(3_000_000, 'CASH'), {
    totalPriceCents: 2_700_000,
    payableNowCents: 2_700_000,
  });
  assert.deepEqual(calculatePayment(3_000_000, 'DEPOSIT'), {
    totalPriceCents: 3_000_000,
    payableNowCents: 500_000,
  });

  const parsed = bookingBodySchema.parse({
    brideFirstName: 'Ayşe',
    brideLastName: 'Yılmaz',
    bridePhone: '05551234567',
    groomFirstName: 'Mehmet',
    groomLastName: 'Demir',
    groomPhone: '05559876543',
    primaryContact: 'GELIN',
    primaryEmail: 'ayse@example.com',
    weddingDate: '2026-08-10',
    startTime: '19:00',
    endTime: '01:00',
    endsNextDay: true,
    venueId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
    packageCode: 'mini',
    serviceCodes: ['video'],
    paymentMethod: 'CASH',
    privacyConsent: true,
    marketingConsent: false,
    totalPriceCents: 1,
  });
  assert.equal('totalPriceCents' in parsed, false);
});

test('parolalar Argon2id ile hashlenir ve hassas değerler AES-GCM ile şifrelenir', async () => {
  const hash = await hashPassword('26062026');
  assert.equal(hash.startsWith('$argon2id$'), true);
  assert.equal(await verifyPassword(hash, '26062026'), true);
  assert.equal(await verifyPassword(hash, 'yanlis-parola'), false);

  const encrypted = encryptValue('https://drive.google.com/file/d/ornek');
  assert.equal(encrypted.ciphertext.includes('drive.google.com'), false);
  assert.equal(decryptValue(encrypted), 'https://drive.google.com/file/d/ornek');
});

test('yalnızca HTTPS Google Drive bağlantıları kabul edilir', () => {
  assert.equal(
    assertGoogleDriveUrl('https://drive.google.com/file/d/ornek'),
    'https://drive.google.com/file/d/ornek'
  );
  assert.throws(() => assertGoogleDriveUrl('https://attacker.example/file'));
  assert.throws(() => assertGoogleDriveUrl('http://drive.google.com/file/d/ornek'));
});

test('admin düğün güncellemesinde çift, iletişim ve gerçek zaman aralığı birlikte doğrulanır', () => {
  const parsed = weddingUpdateBodySchema.parse({
    brideFirstName: 'Ayşe',
    brideLastName: 'Yılmaz',
    bridePhone: '05551234567',
    groomFirstName: 'Mehmet',
    groomLastName: 'Demir',
    groomPhone: '05559876543',
    primaryContact: 'GELIN',
    primaryEmail: 'ayse@example.com',
    weddingDate: '2026-08-10',
    startTime: '19:00',
    endTime: '01:00',
    endsNextDay: true,
    venueId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
    note: '',
  });
  assert.equal(parsed.weddingDate, '2026-08-10');
  assert.throws(() =>
    weddingUpdateBodySchema.parse({
      ...parsed,
      primaryEmail: 'gecersiz',
    })
  );
});

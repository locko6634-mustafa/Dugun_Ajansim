import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingBodySchema,
  deliveryUpdateBodySchema,
  passwordChangeBodySchema,
  strongPasswordSchema,
  weddingUpdateBodySchema
} from "../src/schemas/api.schemas.js";
import { calculatePayment } from "../src/services/booking.service.js";
import { decryptValue, encryptValue, hashPassword, verifyPassword } from "../src/utils/crypto.js";
import {
  addCalendarDays,
  assertGoogleDriveUrl,
  createTemporaryPasswordExpiry,
  createWeddingRange,
  deliveryEncryptionAad,
  isStrictGregorianDate,
  normalizePhone,
  normalizeUsername,
  randomTemporaryPassword
} from "../src/utils/domain.js";

test("gece yarısını aşan düğün aralığı İstanbul saatine göre oluşturulur", () => {
  const range = createWeddingRange("2026-08-10", "20:00", "02:00", true);
  assert.equal(range.startsAt.toISOString(), "2026-08-10T17:00:00.000Z");
  assert.equal(range.endsAt.toISOString(), "2026-08-10T23:00:00.000Z");
  assert.throws(() => createWeddingRange("2026-08-10", "20:00", "19:00", false));
});

test("müşteri kullanıcı adı ve geçici parola kuralları güvenli çalışır", () => {
  assert.equal(normalizeUsername("Yılmaz ÇAĞLAR"), "yilmaz-caglar");
  const firstPassword = randomTemporaryPassword();
  const secondPassword = randomTemporaryPassword();
  assert.match(firstPassword, /^Da![A-HJ-NP-Za-km-z2-9]{18}$/);
  assert.notEqual(firstPassword, secondPassword);
  const expiryBase = new Date("2026-06-26T09:00:00.000Z");
  assert.equal(
    createTemporaryPasswordExpiry(72, expiryBase).toISOString(),
    "2026-06-29T09:00:00.000Z"
  );
  assert.equal(addCalendarDays("2026-06-26", 21), "2026-07-17");
  assert.equal(normalizePhone("0555 123 45 67"), "+905551234567");
});

test("takvim tarihleri rollover yapmadan katı Gregoryen kurallarıyla doğrulanır", () => {
  assert.equal(isStrictGregorianDate("2024-02-29"), true);
  assert.equal(isStrictGregorianDate("2026-02-29"), false);
  assert.equal(isStrictGregorianDate("2026-04-31"), false);
  assert.throws(() => createWeddingRange("2026-02-29", "19:00", "23:00", false));
  assert.throws(() => addCalendarDays("2026-04-31", 1));
});

test("kişi adı ve telefon alanları kontrol karakteri veya harf gizlenmiş numara kabul etmez", () => {
  const validBooking = {
    brideFirstName: "Ayşe",
    brideLastName: "O'Connor-Yılmaz",
    bridePhone: "+90 (555) 123 45 67",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "05559876543",
    primaryContact: "GELIN",
    primaryEmail: "ayse@example.com",
    weddingDate: "2026-08-10",
    startTime: "19:00",
    endTime: "23:00",
    endsNextDay: false,
    venueId: "de305d54-75b4-431b-adb2-eb6b9e546014",
    packageCode: "mini",
    serviceCodes: [],
    paymentMethod: "CASH",
    privacyConsent: true,
    marketingConsent: false
  };

  assert.equal(bookingBodySchema.safeParse(validBooking).success, true);
  assert.equal(
    bookingBodySchema.safeParse({
      ...validBooking,
      venueId: undefined,
      customVenueName: "Yıldızlar Düğün Salonu"
    }).success,
    true
  );
  assert.equal(
    bookingBodySchema.safeParse({
      ...validBooking,
      customVenueName: "Yıldızlar Düğün Salonu"
    }).success,
    false
  );
  assert.equal(
    bookingBodySchema.safeParse({ ...validBooking, brideFirstName: "Ayşe\nYönetici" }).success,
    false
  );
  assert.equal(
    bookingBodySchema.safeParse({ ...validBooking, bridePhone: "abc05551234567" }).success,
    false
  );
});

test("kalıcı parola uzunluk ve normalize edilmiş blocklist kurallarını uygular", () => {
  assert.equal(
    passwordChangeBodySchema.safeParse({
      currentPassword: "gecici-parola",
      newPassword: "yalnizcakucukharflerdenolusur"
    }).success,
    true
  );
  assert.equal(
    passwordChangeBodySchema.safeParse({
      currentPassword: "gecici-parola",
      newPassword: "DUGUNAJANSIM123"
    }).success,
    false
  );
  assert.equal(
    passwordChangeBodySchema.safeParse({
      currentPassword: "gecici-parola",
      newPassword: "ondortkarakter"
    }).success,
    false
  );
  assert.equal(strongPasswordSchema.safeParse("DUGUNAJANSIM123").success, false);
  assert.equal(strongPasswordSchema.safeParse("a".repeat(129)).success, false);
});

test("teslimat PATCH boş body ve geçersiz takvim tarihi kabul etmez", () => {
  assert.equal(deliveryUpdateBodySchema.safeParse({}).success, false);
  assert.equal(deliveryUpdateBodySchema.safeParse({ dueDate: "2026-04-31" }).success, false);
  assert.equal(deliveryUpdateBodySchema.safeParse({ driveUrl: null }).success, true);
});

test("fiyat istemciden alınmaz ve ödeme kuralı backend hesabıyla uygulanır", () => {
  assert.deepEqual(calculatePayment(3_000_000, "CASH"), {
    totalPriceCents: 2_700_000,
    payableNowCents: 2_700_000
  });
  assert.deepEqual(calculatePayment(3_000_000, "DEPOSIT"), {
    totalPriceCents: 3_000_000,
    payableNowCents: 500_000
  });

  const clientPricedPayload = {
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "05551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "05559876543",
    primaryContact: "GELIN",
    primaryEmail: "ayse@example.com",
    weddingDate: "2026-08-10",
    startTime: "19:00",
    endTime: "01:00",
    endsNextDay: true,
    venueId: "de305d54-75b4-431b-adb2-eb6b9e546014",
    packageCode: "mini",
    serviceCodes: ["video"],
    paymentMethod: "CASH",
    privacyConsent: true,
    marketingConsent: false,
    totalPriceCents: 1
  };
  assert.equal(bookingBodySchema.safeParse(clientPricedPayload).success, false);
});

test("parolalar Argon2id ile hashlenir ve hassas değerler AES-GCM ile şifrelenir", async () => {
  const hash = await hashPassword("26062026");
  assert.equal(hash.startsWith("$argon2id$"), true);
  assert.equal(await verifyPassword(hash, "26062026"), true);
  assert.equal(await verifyPassword(hash, "yanlis-parola"), false);

  const aad = deliveryEncryptionAad("delivery-id");
  const encrypted = encryptValue("https://drive.google.com/file/d/ornek", aad);
  assert.equal(encrypted.ciphertext.includes("drive.google.com"), false);
  assert.equal(decryptValue(encrypted, aad), "https://drive.google.com/file/d/ornek");
  assert.throws(() => decryptValue(encrypted, deliveryEncryptionAad("different-delivery-id")));
});

test("yalnızca HTTPS Google Drive bağlantıları kabul edilir", () => {
  assert.equal(
    assertGoogleDriveUrl("https://drive.google.com/file/d/ornek"),
    "https://drive.google.com/file/d/ornek"
  );
  assert.throws(() => assertGoogleDriveUrl("https://attacker.example/file"));
  assert.throws(() => assertGoogleDriveUrl("http://drive.google.com/file/d/ornek"));
});

test("admin düğün güncellemesinde çift, iletişim ve gerçek zaman aralığı birlikte doğrulanır", () => {
  const parsed = weddingUpdateBodySchema.parse({
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "05551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "05559876543",
    primaryContact: "GELIN",
    primaryEmail: "ayse@example.com",
    weddingDate: "2026-08-10",
    startTime: "19:00",
    endTime: "01:00",
    endsNextDay: true,
    venueId: "de305d54-75b4-431b-adb2-eb6b9e546014",
    packageCode: "mini",
    serviceCodes: ["drone"],
    note: ""
  });
  assert.equal(parsed.weddingDate, "2026-08-10");
  assert.throws(() =>
    weddingUpdateBodySchema.parse({
      ...parsed,
      primaryEmail: "gecersiz"
    })
  );
});

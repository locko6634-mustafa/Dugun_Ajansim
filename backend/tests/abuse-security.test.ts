import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import nodeTest from "node:test";
import request from "supertest";
import { ZodError } from "zod";
import { createApp } from "../src/app.js";
import { parseEnvironment } from "../src/config/env.config.js";
import { DatabaseRateLimitStore } from "../src/middlewares/databaseRateLimitStore.js";
import { createGlobalRateLimitStore } from "../src/middlewares/security.middleware.js";
import {
  assertPublicPiiWritesAllowed,
  getPublicBookingContactRateLimitKeys,
  validateBookingAbuseSignals
} from "../src/routes/public.routes.js";
import { AppError } from "../src/utils/appError.js";

const test: typeof nodeTest = ((name: string, ...args: unknown[]) =>
  nodeTest(`[abuse-security] ${name}`, ...(args as [never]))) as typeof nodeTest;

const syntheticEnvironment = {
  NODE_ENV: "test",
  CORS_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://test_user:test_password@localhost:5432/dugun_ajansim_test"
} satisfies NodeJS.ProcessEnv;

const bookingBody = {
  brideFirstName: "Ayşe",
  brideLastName: "Yılmaz",
  bridePhone: "+90 555 123 45 67",
  groomFirstName: "Mehmet",
  groomLastName: "Demir",
  groomPhone: "05559876543",
  primaryContact: "GELIN",
  primaryEmail: "ayse@example.com",
  weddingDate: "2099-08-10",
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

test("global API limiter production ortamında PostgreSQL deposu kullanır", () => {
  const productionStore = createGlobalRateLimitStore("production");

  assert.ok(productionStore instanceof DatabaseRateLimitStore);
  assert.equal(productionStore.prefix, "global-api-ip:");
  assert.equal(createGlobalRateLimitStore("development"), undefined);
  assert.equal(createGlobalRateLimitStore("test"), undefined);
});

test("sentetik PII yazımı non-production ortamlarında açık opt-in gerektirir", () => {
  const defaultEnvironment = parseEnvironment(syntheticEnvironment);
  const optedInEnvironment = parseEnvironment({
    ...syntheticEnvironment,
    ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES: "true"
  });

  assert.equal(defaultEnvironment.ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES, false);
  assert.equal(optedInEnvironment.ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES, true);
  assert.throws(
    () => assertPublicPiiWritesAllowed("test", false),
    (error: unknown) => error instanceof AppError && error.statusCode === 503
  );
  assert.doesNotThrow(() => assertPublicPiiWritesAllowed("test", true));
  assert.doesNotThrow(() => assertPublicPiiWritesAllowed("production", false));

  assert.throws(
    () =>
      parseEnvironment({
        ...syntheticEnvironment,
        NODE_ENV: "production",
        ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES: "true"
      }),
    (error: unknown) =>
      error instanceof ZodError &&
      error.issues.some((issue) => issue.path[0] === "ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES")
  );
});

test("honeypot ve form süresi sinyalleri eski istemcileri bozmadan şüpheli isteği reddeder", () => {
  assert.doesNotThrow(() => validateBookingAbuseSignals({}));
  assert.doesNotThrow(() => validateBookingAbuseSignals({ website: "", elapsedMs: "1500" }));

  for (const signals of [
    { website: "https://spam.example", elapsedMs: "5000" },
    { website: "", elapsedMs: "1499" },
    { website: "", elapsedMs: "not-a-number" }
  ]) {
    assert.throws(
      () => validateBookingAbuseSignals(signals),
      (error: unknown) => error instanceof AppError && error.statusCode === 400
    );
  }
});

test("tekrar kotası e-posta ve iki telefonu ayrı kanonik sinyaller olarak kullanır", () => {
  assert.deepEqual(getPublicBookingContactRateLimitKeys(bookingBody), {
    email: "ayse@example.com",
    bridePhone: "+905551234567",
    groomPhone: "+905559876543"
  });
});

test("public başvuru honeypot ve çok hızlı form sinyalinde PII yazımına ulaşmaz", async () => {
  const app = createApp();
  app.set("trust proxy", 1);
  const uniqueTestIp = () => {
    const value = randomBytes(6).toString("hex");
    return `2001:db8:${value.slice(0, 4)}:${value.slice(4, 8)}:${value.slice(8)}::1`;
  };

  const honeypotResponse = await request(app)
    .post("/api/v1/booking-applications")
    .set("X-Forwarded-For", uniqueTestIp())
    .set("Idempotency-Key", "150b0d7d-c283-41c5-a821-d6d71dd38bc0")
    .set("X-Booking-Elapsed-Ms", "5000")
    .set("X-Booking-Website", "https://spam.example")
    .send(bookingBody);
  const fastResponse = await request(app)
    .post("/api/v1/booking-applications")
    .set("X-Forwarded-For", uniqueTestIp())
    .set("Idempotency-Key", "b525d3bb-858b-4689-957c-a754edac00aa")
    .set("X-Booking-Elapsed-Ms", "10")
    .send(bookingBody);
  const legacyClientResponse = await request(app)
    .post("/api/v1/booking-applications")
    .set("X-Forwarded-For", uniqueTestIp())
    .send(bookingBody);

  assert.equal(honeypotResponse.status, 400);
  assert.equal(fastResponse.status, 400);
  assert.match(honeypotResponse.body.message, /Başvuru doğrulanamadı/);
  assert.match(fastResponse.body.message, /Başvuru doğrulanamadı/);
  assert.equal(typeof honeypotResponse.body.correlationId, "string");
  assert.equal(legacyClientResponse.status, 400);
  assert.match(legacyClientResponse.body.message, /Idempotency-Key/);
});

test("CORS ve public form istemcisi abuse sinyali başlıklarını birlikte taşır", async () => {
  const corsResponse = await request(
    createApp((application) => {
      application.post("/api/test", (_req, res) => res.json({ success: true }));
    })
  )
    .options("/api/test")
    .set("Origin", "http://localhost:3000")
    .set("Access-Control-Request-Method", "POST")
    .set(
      "Access-Control-Request-Headers",
      "x-booking-elapsed-ms,x-booking-website,idempotency-key,turnstile-token"
    );
  const allowedHeaders = String(corsResponse.headers["access-control-allow-headers"]).toLowerCase();
  const applicationSource = await readFile(
    new URL("../../js/package-builder/application.js", import.meta.url),
    "utf8"
  );
  const packageBuilderPage = await readFile(
    new URL("../../paketini-olustur.html", import.meta.url),
    "utf8"
  );

  assert.equal(corsResponse.status, 204);
  assert.ok(allowedHeaders.includes("x-booking-elapsed-ms"));
  assert.ok(allowedHeaders.includes("x-booking-website"));
  assert.match(applicationSource, /"X-Booking-Elapsed-Ms"/);
  assert.match(applicationSource, /"X-Booking-Website"/);
  assert.match(packageBuilderPage, /name="companyWebsite"[\s\S]*?hidden/);
});

import { createCipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { request as playwrightRequest } from "@playwright/test";
import { expect, test } from "./browser-gate.js";

const backendRequire = createRequire(pathToFileURL(resolve("backend/package.json")));
const { PrismaClient } = backendRequire("@prisma/client");
const argon2Module = backendRequire("argon2");
const argon2 = argon2Module.default ?? argon2Module;

const requiredEnvironment = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} Faz 06 kalite koşusu için zorunludur.`);
  return value;
};

const baseURL = process.env.PHASE06_BASE_URL || "http://127.0.0.1:8186";
const ownerDatabaseUrl = requiredEnvironment("PHASE06_DATABASE_URL");
const runtimeDatabaseUrl = requiredEnvironment("PHASE06_RUNTIME_DATABASE_URL");
const encryptionKey = requiredEnvironment("PHASE06_DATA_ENCRYPTION_KEY");
const adminPassword = requiredEnvironment("PHASE06_ADMIN_PASSWORD");
const salonPassword = requiredEnvironment("PHASE06_SALON_PASSWORD");
const customerPassword = requiredEnvironment("PHASE06_CUSTOMER_PASSWORD");
const adminTotpSecret = requiredEnvironment("PHASE06_ADMIN_TOTP_SECRET");

const assertIsolatedDatabaseUrl = (value, expectedUser) => {
  const url = new URL(value);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/dugun_ajansim_phase06" ||
    decodeURIComponent(url.username) !== expectedUser
  ) {
    throw new Error(
      "Faz 06 yalnız yerel ve izole dugun_ajansim_phase06 veritabanında çalışabilir."
    );
  }
};

assertIsolatedDatabaseUrl(ownerDatabaseUrl, "phase06_owner");
assertIsolatedDatabaseUrl(runtimeDatabaseUrl, "phase06_runtime");

const prisma = new PrismaClient({ datasources: { db: { url: ownerDatabaseUrl } } });

const encryptTotpSecret = (userId, value) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, "hex"), iv);
  cipher.setAAD(Buffer.from(`user-totp:${userId}:v1`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    totpSecretCiphertext: ciphertext.toString("base64"),
    totpSecretIv: iv.toString("base64"),
    totpSecretAuthTag: cipher.getAuthTag().toString("base64")
  };
};

const decodeBase32 = (value) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const decoded = [];
  for (const character of value.trim().toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Sentetik TOTP biçimi geçersiz.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(decoded);
};

const totpCode = (step) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", decodeBase32(adminTotpSecret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

const safeTotpStep = async () => {
  const periodMs = 30_000;
  const elapsed = Date.now() % periodMs;
  if (elapsed > 22_000) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, periodMs - elapsed + 500));
  }
  return BigInt(Math.floor(Date.now() / 1_000 / 30));
};

const csrfToken = async (context) => {
  const state = await context.storageState();
  const cookie = state.cookies.find((item) => item.name === "dugunajansim_csrf");
  if (!cookie) throw new Error("CSRF cookie alınamadı.");
  return cookie.value;
};

const authenticatedRequest = async (context, method, path, data) =>
  context[method](path, {
    data,
    headers: { "X-CSRF-Token": await csrfToken(context) }
  });

const responseJson = async (response, status, label, requestIds) => {
  const requestId = response.headers()["x-correlation-id"];
  if (requestId && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) requestIds.add(requestId);
  expect(response.status(), label).toBe(status);
  return response.json().catch(() => ({}));
};

const attachRequestIds = async (testInfo, requestIds) => {
  await testInfo.attach("api-request-ids", {
    body: Buffer.from(JSON.stringify([...requestIds].sort(), null, 2)),
    contentType: "application/json"
  });
};

const createIdentity = async (suffix) => {
  const venue = await prisma.venue.findFirstOrThrow({ where: { slug: "rena-garden" } });
  const adminId = randomUUID();
  const salonId = randomUUID();
  const prefix = `phase06-${suffix}-${randomBytes(3).toString("hex")}`;
  const [adminHash, salonHash] = await Promise.all([
    argon2.hash(adminPassword, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2 }),
    argon2.hash(salonPassword, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2 })
  ]);
  await prisma.user.createMany({
    data: [
      {
        id: adminId,
        username: `${prefix}-admin`,
        passwordHash: adminHash,
        role: "ADMIN",
        status: "ACTIVE",
        mustChangePassword: false,
        activeAt: new Date(Date.now() - 60_000),
        passwordChangedAt: new Date(),
        ...encryptTotpSecret(adminId, adminTotpSecret),
        totpKeyId: "phase06",
        totpEnabledAt: new Date(),
        totpLastUsedStep: BigInt(Math.floor(Date.now() / 1_000 / 30)) - 2n
      },
      {
        id: salonId,
        username: `${prefix}-salon`,
        passwordHash: salonHash,
        role: "SALON_YETKILISI",
        status: "ACTIVE",
        mustChangePassword: false,
        activeAt: new Date(Date.now() - 60_000),
        passwordChangedAt: new Date(),
        venueId: venue.id
      }
    ]
  });
  return {
    prefix,
    venue,
    admin: { id: adminId, username: `${prefix}-admin` },
    salon: { id: salonId, username: `${prefix}-salon` },
    applicationIds: new Set(),
    idempotencyKeys: new Set(),
    staffIds: new Set(),
    otherTargetIds: new Set([adminId, salonId])
  };
};

const cleanupIdentity = async (identity) => {
  const applications = await prisma.bookingApplication.findMany({
    where: {
      OR: [
        ...(identity.applicationIds.size ? [{ id: { in: [...identity.applicationIds] } }] : []),
        ...(identity.idempotencyKeys.size
          ? [{ idempotencyKey: { in: [...identity.idempotencyKeys] } }]
          : [])
      ]
    },
    select: { id: true }
  });
  const applicationIds = applications.map((item) => item.id);
  const weddings = await prisma.wedding.findMany({
    where: { applicationId: { in: applicationIds } },
    select: { id: true, customerUserId: true, delivery: { select: { id: true } } }
  });
  const targetIds = new Set([
    ...identity.otherTargetIds,
    ...identity.staffIds,
    ...applicationIds,
    ...weddings.flatMap((item) => [item.id, item.customerUserId, item.delivery?.id].filter(Boolean))
  ]);

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        {
          actorUserId: {
            in: [identity.admin.id, identity.salon.id, ...weddings.map((w) => w.customerUserId)]
          }
        },
        { targetId: { in: [...targetIds] } }
      ]
    }
  });
  await prisma.wedding.deleteMany({ where: { id: { in: weddings.map((item) => item.id) } } });
  await prisma.staff.deleteMany({ where: { id: { in: [...identity.staffIds] } } });
  await prisma.bookingApplication.deleteMany({ where: { id: { in: applicationIds } } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [identity.admin.id, identity.salon.id, ...weddings.map((item) => item.customerUserId)]
      }
    }
  });
  await prisma.rateLimitBucket.deleteMany();

  const residual = {
    users: await prisma.user.count({ where: { username: { startsWith: identity.prefix } } }),
    applications: await prisma.bookingApplication.count({
      where: { idempotencyKey: { in: [...identity.idempotencyKeys] } }
    }),
    weddings: await prisma.wedding.count({ where: { applicationId: { in: applicationIds } } }),
    staff: await prisma.staff.count({ where: { id: { in: [...identity.staffIds] } } })
  };
  if (Object.values(residual).some((count) => count !== 0)) {
    throw new Error(
      `Faz 06 cleanup başarısız; kalıntı kimlikleri: ${JSON.stringify({ applicationIds, targetIds: [...targetIds] })}`
    );
  }
};

const loginAdminAndStepUp = async (context, identity, requestIds, withStepUp = true) => {
  const step = await safeTotpStep();
  const login = await context.post("/api/v1/auth/login", {
    data: {
      username: identity.admin.username,
      password: adminPassword,
      totpCode: totpCode(step),
      remember: false,
      trustDevice: false
    }
  });
  await responseJson(login, 200, "admin login", requestIds);
  if (!withStepUp) return;
  const stepUp = await authenticatedRequest(context, "post", "/api/v1/auth/admin-step-up", {
    currentPassword: adminPassword,
    totpCode: totpCode(step + 1n)
  });
  await responseJson(stepUp, 200, "admin step-up", requestIds);
};

const loginSalon = async (context, identity, requestIds) => {
  const response = await context.post("/api/v1/auth/login", {
    data: { username: identity.salon.username, password: salonPassword, remember: false }
  });
  await responseJson(response, 200, "salon login", requestIds);
};

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("@phase06 production imajı, Nginx, migration ve least-privilege runtime sözleşmesi", async ({
  request
}, testInfo) => {
  const requestIds = new Set();
  const healthz = await request.get("/healthz");
  expect(healthz.status()).toBe(200);
  const health = await request.get("/api/v1/health");
  await responseJson(health, 200, "backend health", requestIds);
  const catalog = await request.get("/api/v1/catalog");
  const catalogBody = await responseJson(catalog, 200, "public catalog", requestIds);
  expect(catalogBody.data.packages.length).toBeGreaterThan(0);
  const venues = await request.get("/api/v1/venues");
  const venuesBody = await responseJson(venues, 200, "public venues", requestIds);
  expect(venuesBody.data.length).toBeGreaterThan(0);
  expect(catalogBody.data.botProtection).toMatchObject({
    provider: "turnstile",
    enabled: true,
    action: "booking_application"
  });
  expect(catalog.headers()["content-security-policy"]).toContain("default-src 'self'");

  const migrationCount = await prisma.$queryRaw`
    SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL
  `;
  expect(migrationCount[0].count).toBeGreaterThan(0);
  const runtime = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl } } });
  try {
    const current = await runtime.$queryRaw`SELECT current_user AS "currentUser"`;
    expect(current[0].currentUser).toBe("phase06_runtime");
    await expect(
      runtime.$executeRawUnsafe("CREATE TABLE phase06_forbidden_probe(id int)")
    ).rejects.toBeTruthy();
  } finally {
    await runtime.$disconnect();
  }
  await attachRequestIds(testInfo, requestIds);
});

test("@phase06 rol, route, CSRF, CORS ve step-up negatif matrisi", async ({}, testInfo) => {
  const identity = await createIdentity("matrix");
  const requestIds = new Set();
  const anonymous = await playwrightRequest.newContext({ baseURL });
  const admin = await playwrightRequest.newContext({ baseURL });
  const salon = await playwrightRequest.newContext({ baseURL });
  const foreignId = randomUUID();
  try {
    await responseJson(await anonymous.get("/api/v1/catalog"), 200, "anon public", requestIds);
    await responseJson(
      await anonymous.get("/api/v1/admin/booking-applications?pageSize=5"),
      401,
      "anon admin",
      requestIds
    );
    await responseJson(
      await anonymous.get("/api/v1/operations/weddings?pageSize=5"),
      401,
      "anon salon",
      requestIds
    );
    await responseJson(
      await anonymous.get("/api/v1/customer/dashboard"),
      401,
      "anon customer",
      requestIds
    );
    await responseJson(
      await anonymous.get("/api/v1/catalog", { headers: { Origin: "https://attacker.invalid" } }),
      403,
      "wrong CORS origin",
      requestIds
    );
    await responseJson(
      await anonymous.get("/api/v1/catalog", { headers: { "Sec-Fetch-Site": "cross-site" } }),
      403,
      "originless cross-site",
      requestIds
    );

    await loginAdminAndStepUp(admin, identity, requestIds, false);
    await responseJson(
      await admin.get("/api/v1/admin/booking-applications?pageSize=5"),
      200,
      "admin own route",
      requestIds
    );
    await responseJson(
      await admin.get("/api/v1/operations/weddings?pageSize=5"),
      403,
      "admin salon route",
      requestIds
    );
    await responseJson(
      await admin.get("/api/v1/customer/dashboard"),
      403,
      "admin customer route",
      requestIds
    );
    await responseJson(
      await authenticatedRequest(admin, "post", `/api/v1/admin/weddings/${foreignId}/cancel`, {
        reason: "Sentetik step-up negatif matris kontrolü"
      }),
      428,
      "admin step-up required",
      requestIds
    );
    await responseJson(
      await admin.post(`/api/v1/admin/booking-applications/${foreignId}/approve`, { data: {} }),
      403,
      "missing CSRF",
      requestIds
    );

    await loginSalon(salon, identity, requestIds);
    await responseJson(
      await salon.get("/api/v1/operations/weddings?pageSize=5"),
      200,
      "salon own route",
      requestIds
    );
    await responseJson(
      await salon.get(`/api/v1/operations/weddings/${foreignId}`),
      404,
      "salon foreign wedding",
      requestIds
    );
    await responseJson(
      await salon.get("/api/v1/admin/booking-applications?pageSize=5"),
      403,
      "salon admin route",
      requestIds
    );
    await responseJson(
      await salon.get("/api/v1/customer/dashboard"),
      403,
      "salon customer route",
      requestIds
    );
  } finally {
    await Promise.all([anonymous.dispose(), admin.dispose(), salon.dispose()]);
    await cleanupIdentity(identity);
    await attachRequestIds(testInfo, requestIds);
  }
});

test("@phase06 mocksuz telefon ve WhatsApp altın yolu", async ({ page }, testInfo) => {
  const identity = await createIdentity("golden");
  const requestIds = new Set();
  const publicApi = await playwrightRequest.newContext({ baseURL });
  const admin = await playwrightRequest.newContext({ baseURL });
  const salon = await playwrightRequest.newContext({ baseURL });
  const customer = await playwrightRequest.newContext({ baseURL });
  const idempotencyKey = randomUUID();
  const paymentFlowKey = randomBytes(32).toString("base64url");
  identity.idempotencyKeys.add(idempotencyKey);
  try {
    await loginAdminAndStepUp(admin, identity, requestIds);
    await loginSalon(salon, identity, requestIds);

    const catalogBody = await responseJson(
      await publicApi.get("/api/v1/catalog"),
      200,
      "catalog",
      requestIds
    );
    const venuesBody = await responseJson(
      await publicApi.get("/api/v1/venues"),
      200,
      "venues",
      requestIds
    );
    const venue = venuesBody.data.find((item) => item.id === identity.venue.id);
    const packageRecord = catalogBody.data.packages.find((item) => item.code === "mini");
    expect(venue).toBeTruthy();
    expect(packageRecord).toBeTruthy();
    const weddingDate = new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10);
    const uniqueDigits = String(Date.now()).slice(-4);
    const applicationResponse = await publicApi.post("/api/v1/booking-applications", {
      headers: {
        "Idempotency-Key": idempotencyKey,
        "Payment-Flow-Key": paymentFlowKey,
        "Turnstile-Token": `phase06-valid-${randomBytes(8).toString("hex")}`,
        "X-Booking-Elapsed-Ms": "5000"
      },
      data: {
        brideFirstName: "Sentetik",
        brideLastName: "Gelin",
        bridePhone: `+90555000${uniqueDigits}`,
        groomFirstName: "Sentetik",
        groomLastName: "Damat",
        groomPhone: `+90555100${uniqueDigits}`,
        primaryContact: "GELIN",
        primaryEmail: `${identity.prefix}@example.invalid`,
        weddingDate,
        startTime: "19:00",
        endTime: "23:00",
        endsNextDay: false,
        venueId: venue.id,
        packageCode: packageRecord.code,
        serviceCodes: [],
        paymentMethod: "CASH",
        privacyConsent: true,
        marketingConsent: false
      }
    });
    const applicationBody = await responseJson(
      applicationResponse,
      201,
      "public cash application",
      requestIds
    );
    const applicationId = applicationBody.data.id;
    identity.applicationIds.add(applicationId);
    identity.otherTargetIds.add(applicationId);

    await responseJson(
      await publicApi.post(`/api/v1/booking-applications/${applicationId}/whatsapp-handoff`, {
        headers: { "Payment-Flow-Key": paymentFlowKey },
        data: {}
      }),
      200,
      "WhatsApp handoff",
      requestIds
    );
    const queueBody = await responseJson(
      await admin.get(
        `/api/v1/admin/booking-applications?referenceCode=${encodeURIComponent(applicationBody.data.referenceCode)}&pageSize=5`
      ),
      200,
      "admin queue",
      requestIds
    );
    expect(queueBody.data.items.some((item) => item.id === applicationId)).toBe(true);

    const approvalBody = await responseJson(
      await authenticatedRequest(
        admin,
        "post",
        `/api/v1/admin/booking-applications/${applicationId}/approve`,
        {}
      ),
      200,
      "admin approval",
      requestIds
    );
    const weddingId = approvalBody.data.weddingId;
    expect(approvalBody.data.decisionTaskId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(approvalBody.data.activationTaskId).toMatch(/^[0-9a-f-]{36}$/i);
    identity.otherTargetIds.add(weddingId);
    const weddingBody = await responseJson(
      await admin.get(`/api/v1/admin/weddings/${weddingId}`),
      200,
      "admin wedding detail",
      requestIds
    );
    expect(weddingBody.data.delivery.status).toBe("HAZIRLANIYOR");
    expect(weddingBody.data.messageTasks.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["ACCOUNT_ACTIVATION", "PREPARATION_UPDATE"])
    );
    const activationTask = weddingBody.data.messageTasks.find(
      (item) => item.kind === "ACCOUNT_ACTIVATION"
    );
    expect(activationTask).toBeTruthy();
    expect(activationTask.id).toBe(approvalBody.data.activationTaskId);

    await responseJson(
      await authenticatedRequest(
        admin,
        "post",
        `/api/v1/admin/message-tasks/${activationTask.id}/render`,
        {}
      ),
      200,
      "activation render",
      requestIds
    );
    await responseJson(
      await authenticatedRequest(
        admin,
        "post",
        `/api/v1/admin/message-tasks/${activationTask.id}/verify`,
        { activateCustomerNow: true }
      ),
      409,
      "activation early verify",
      requestIds
    );
    await responseJson(
      await authenticatedRequest(
        admin,
        "post",
        `/api/v1/admin/message-tasks/${activationTask.id}/override-due`,
        { reason: "Sentetik Faz 06 kontrollü zaman penceresi" }
      ),
      200,
      "activation override",
      requestIds
    );
    const verificationBody = await responseJson(
      await authenticatedRequest(
        admin,
        "post",
        `/api/v1/admin/message-tasks/${activationTask.id}/verify`,
        { activateCustomerNow: true }
      ),
      200,
      "activation verify",
      requestIds
    );
    const setupToken = String(verificationBody.data.message).match(
      /#setup=([A-Za-z0-9_-]{43})&purpose=ACCOUNT_ACTIVATION/
    )?.[1];
    expect(setupToken).toBeTruthy();
    expect(verificationBody.data.customerActivatedEarly).toBe(true);
    const customerRecord = await prisma.wedding.findUniqueOrThrow({
      where: { id: weddingId },
      select: { customerUserId: true, customerUser: { select: { activeAt: true } } }
    });
    identity.otherTargetIds.add(customerRecord.customerUserId);
    expect(customerRecord.customerUser.activeAt.valueOf()).toBeLessThanOrEqual(Date.now());
    await responseJson(
      await authenticatedRequest(
        admin,
        "post",
        `/api/v1/admin/message-tasks/${activationTask.id}/mark-sent`,
        { expectedUpdatedAt: verificationBody.data.expectedUpdatedAt }
      ),
      200,
      "activation mark sent",
      requestIds
    );
    const passwordSetupBody = await responseJson(
      await publicApi.post("/api/v1/auth/password/setup", {
        data: {
          token: setupToken,
          purpose: "ACCOUNT_ACTIVATION",
          newPassword: customerPassword
        }
      }),
      200,
      "real password setup token",
      requestIds
    );
    const customerUsername = passwordSetupBody.data.username;
    await responseJson(
      await customer.post("/api/v1/auth/login", {
        data: { username: customerUsername, password: customerPassword, remember: false }
      }),
      200,
      "customer login",
      requestIds
    );
    await responseJson(
      await customer.get(`/api/v1/customer/dashboard?weddingId=${randomUUID()}`),
      404,
      "customer foreign wedding",
      requestIds
    );
    await responseJson(
      await customer.get("/api/v1/admin/booking-applications?pageSize=5"),
      403,
      "customer admin route",
      requestIds
    );
    await responseJson(
      await customer.get("/api/v1/operations/weddings?pageSize=5"),
      403,
      "customer salon route",
      requestIds
    );

    const salonWeddingsBody = await responseJson(
      await salon.get(
        `/api/v1/operations/weddings?search=${encodeURIComponent(applicationBody.data.referenceCode)}&pageSize=5`
      ),
      200,
      "salon sees wedding",
      requestIds
    );
    expect(salonWeddingsBody.data.items.some((item) => item.id === weddingId)).toBe(true);
    const staffBody = await responseJson(
      await authenticatedRequest(salon, "post", "/api/v1/operations/staff", {
        firstName: "Sentetik",
        lastName: "Personel",
        phone: `+90555200${uniqueDigits}`,
        specialties: ["PHOTOGRAPHY"],
        isActive: true
      }),
      201,
      "salon staff create",
      requestIds
    );
    identity.staffIds.add(staffBody.data.id);
    identity.otherTargetIds.add(staffBody.data.id);
    await responseJson(
      await authenticatedRequest(salon, "patch", `/api/v1/operations/staff/${staffBody.data.id}`, {
        lastName: "Güncel Personel"
      }),
      200,
      "salon staff edit",
      requestIds
    );
    const assignmentBody = await responseJson(
      await authenticatedRequest(
        salon,
        "post",
        `/api/v1/operations/weddings/${weddingId}/assignments`,
        { staffId: staffBody.data.id, specialty: "PHOTOGRAPHY" }
      ),
      201,
      "assignment add",
      requestIds
    );
    identity.otherTargetIds.add(assignmentBody.data.id);
    await responseJson(
      await authenticatedRequest(
        salon,
        "delete",
        `/api/v1/operations/weddings/${weddingId}/assignments/${assignmentBody.data.id}`,
        {}
      ),
      200,
      "assignment remove",
      requestIds
    );

    const deliveryId = weddingBody.data.delivery.id;
    identity.otherTargetIds.add(deliveryId);
    for (const status of ["MONTAJ", "KONTROL", "TESLIME_HAZIR"]) {
      await responseJson(
        await authenticatedRequest(admin, "patch", `/api/v1/admin/deliveries/${deliveryId}`, {
          status,
          ...(status === "TESLIME_HAZIR"
            ? { driveUrl: "https://drive.google.com/drive/folders/phase06-safe-fixture" }
            : {})
        }),
        200,
        `delivery ${status}`,
        requestIds
      );
    }
    await responseJson(
      await authenticatedRequest(admin, "post", `/api/v1/admin/deliveries/${deliveryId}/deliver`, {
        sharingConfirmed: true,
        sharingConfirmation: "ERİŞİMİ DOĞRULADIM"
      }),
      200,
      "delivery release",
      requestIds
    );
    const customerDeliveryBody = await responseJson(
      await customer.get(`/api/v1/customer/delivery?deliveryId=${deliveryId}`),
      200,
      "customer delivery",
      requestIds
    );
    expect(customerDeliveryBody.data.driveUrl).toBe(
      "https://drive.google.com/drive/folders/phase06-safe-fixture"
    );

    await responseJson(
      await page.context().request.post("/api/v1/auth/login", {
        data: { username: customerUsername, password: customerPassword, remember: false }
      }),
      200,
      "browser customer login",
      requestIds
    );
    await page.goto("/musteri-paneli.html");
    await expect(page.locator(".delivery-release")).toBeVisible();
    const popupPromise = page.waitForEvent("popup");
    await page.locator(".js-open-delivery").click();
    const popup = await popupPromise;
    await popup.waitForURL(/^https:\/\/drive\.google\.com\//, { waitUntil: "commit" });
    expect(popup.url()).toBe("https://drive.google.com/drive/folders/phase06-safe-fixture");
    await popup.close();

    await responseJson(
      await authenticatedRequest(admin, "post", `/api/v1/admin/deliveries/${deliveryId}/revoke`, {
        reason: "Sentetik Faz 06 teslimat geri çekme kontrolü"
      }),
      200,
      "delivery revoke",
      requestIds
    );
    await responseJson(
      await customer.get(`/api/v1/customer/delivery?deliveryId=${deliveryId}`),
      404,
      "revoked delivery hidden",
      requestIds
    );
    await page.reload();
    await expect(page.locator(".delivery-release")).toBeHidden();

    await responseJson(
      await authenticatedRequest(admin, "post", `/api/v1/admin/weddings/${weddingId}/cancel`, {
        reason: "Sentetik Faz 06 iptal ve rol matrisi kontrolü"
      }),
      200,
      "wedding cancel",
      requestIds
    );
    await responseJson(
      await authenticatedRequest(admin, "post", `/api/v1/admin/weddings/${weddingId}/cancel`, {
        reason: "Sentetik Faz 06 tekrar iptal kontrolü"
      }),
      409,
      "cancelled wedding conflict",
      requestIds
    );
    await responseJson(
      await customer.get("/api/v1/customer/dashboard"),
      404,
      "cancelled wedding customer isolation",
      requestIds
    );
    await responseJson(
      await authenticatedRequest(admin, "post", `/api/v1/admin/weddings/${weddingId}/archive`, {}),
      200,
      "wedding archive",
      requestIds
    );
    await responseJson(
      await salon.get(`/api/v1/operations/weddings/${weddingId}`),
      404,
      "archived wedding salon isolation",
      requestIds
    );
    await responseJson(
      await authenticatedRequest(admin, "post", `/api/v1/admin/weddings/${weddingId}/archive`, {}),
      404,
      "archived wedding repeat",
      requestIds
    );
  } finally {
    await Promise.all([publicApi.dispose(), admin.dispose(), salon.dispose(), customer.dispose()]);
    await cleanupIdentity(identity);
    await attachRequestIds(testInfo, requestIds);
  }
});

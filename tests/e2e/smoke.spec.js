import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pages = ["/index.html", "/login.html", "/paketini-olustur.html"];

async function clickPanel(page, panelName, isOps = false) {
  const toggleSelector = isOps ? ".js-toggle-ops-sidebar" : ".js-toggle-sidebar";
  const toggleBtn = page.locator(toggleSelector);
  if (await toggleBtn.isVisible()) {
    await toggleBtn.click();
    await page.waitForTimeout(200);
  }
  await page.locator(`[data-panel="${panelName}"]`).first().click();
}

async function selectWeddingDate(page, value) {
  const dateTrigger = page.locator(".js-date-trigger");
  await dateTrigger.click();
  for (let month = 0; month < 12; month += 1) {
    await page.locator(".js-calendar-next").click();
  }
  await page.locator(`[data-date-value="${value}"]`).click();
}

async function selectWeddingTime(page, pickerName, value) {
  const picker = page.locator(`.js-time-picker[data-time-picker="${pickerName}"]`);
  await picker.locator(".js-time-trigger").click();
  await picker.locator(`[data-time-value="${value}"]`).click();
}

for (const pagePath of pages) {
  test(`${pagePath} temel sayfa kontrolleri`, async ({ page }) => {
    await page.goto(pagePath);
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.locator("h1:visible")).toHaveCount(1);
    await expect(page).toHaveTitle(/.+/);
  });

  test(`${pagePath} yatay tasma uretmiyor`, async ({ page }) => {
    await page.goto(pagePath);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test(`${pagePath} axe kritik ihlal icermiyor`, async ({ page }) => {
    await page.goto(pagePath);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  });
}

test("ana sayfa mobil menu acilip kapanir", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");
  const menuButton = page.locator("[aria-controls]").first();
  if (await menuButton.count()) {
    await menuButton.click();
    await page.keyboard.press("Escape");
    await expect(menuButton).toBeVisible();
  }
});

test("ana sayfa header navigasyon linkleri aktif durumu gunceller", async ({ page, isMobile }) => {
  await page.goto("/index.html");
  if (isMobile) {
    const menuButton = page.locator("[aria-controls]").first();
    await menuButton.click();
    const mobileNav = page.locator(".mobile-menu nav");
    await expect(mobileNav.locator('a[href="#anasayfa"]')).toHaveClass(/is-active/);
    await mobileNav.locator('a[href="#hizmetler"]').click();
    await expect(mobileNav.locator('a[href="#hizmetler"]')).toHaveClass(/is-active/);
    await expect(mobileNav.locator('a[href="#anasayfa"]')).not.toHaveClass(/is-active/);
  } else {
    const desktopNav = page.locator(".desktop-nav");
    await expect(desktopNav.locator('a[href="#anasayfa"]')).toHaveClass(/is-active/);
    await desktopNav.locator('a[href="#hizmetler"]').click();
    await expect(desktopNav.locator('a[href="#hizmetler"]')).toHaveClass(/is-active/);
    await expect(desktopNav.locator('a[href="#anasayfa"]')).not.toHaveClass(/is-active/);
  }
});

test("anasayfa butonuna basildiginda sayfanin en ustune kaydirir", async ({ page, isMobile }) => {
  await page.goto("/index.html");
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForFunction(() => window.scrollY > 500);

  if (isMobile) {
    const menuButton = page.locator("[aria-controls]").first();
    await menuButton.click();
    await page.locator('.mobile-menu nav a[href="#anasayfa"]').click();
  } else {
    await page.locator('.desktop-nav a[href="#anasayfa"]').click();
  }

  await page.waitForFunction(() => window.scrollY < 50);
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeLessThan(50);
});

test("paketini olustur sayfasinda masaustunde sepet acilip kapanir", async ({ page, isMobile }) => {
  if (!isMobile) {
    await page.goto("/paketini-olustur.html");
    const bagButton = page.locator(".builder-bag");
    const closeButton = page.locator(".package-summary__close");

    await bagButton.click();
    await expect(page.locator("body")).toHaveClass(/is-summary-open/);

    await closeButton.click();
    await expect(page.locator("body")).not.toHaveClass(/is-summary-open/);
  }
});

test("paket formu çift, saat ve salon alanlarını backend kataloğuyla hazırlar", async ({
  page
}) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          packages: [
            {
              code: "mini",
              name: "Mini Paket",
              priceCents: 2_000_000,
              imagePath: "assets/images/hero-couple.webp"
            },
            {
              code: "hikaye",
              name: "Hikâye Paketi",
              priceCents: 3_500_000,
              imagePath: "assets/images/hero-couple.webp"
            }
          ],
          services: []
        }
      })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [{ id: "de305d54-75b4-431b-adb2-eb6b9e546014", name: "Cess Wedding" }]
      })
    })
  );
  await page.route("**/api/v1/venues/*/availability?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { date: "2027-08-10", occupiedSlots: [] }
      })
    })
  );
  await page.goto("/paketini-olustur.html");
  await expect(page.locator('input[name="base-package"]')).toHaveCount(2);
  await page.locator(".js-next-step").click();
  await expect(page.locator(".builder-service")).toHaveCount(0);
  await page.locator(".js-details-step").click();
  await expect(page.locator('input[name="brideFirstName"]')).toBeVisible();
  await expect(page.locator('input[name="groomFirstName"]')).toBeVisible();
  await expect(
    page.locator('.js-time-picker[data-time-picker="start"] .js-time-trigger')
  ).toBeVisible();
  await expect(page.locator(".js-venue-select")).toContainText("Cess Wedding");
  await page.locator('select[name="venueId"]').selectOption("de305d54-75b4-431b-adb2-eb6b9e546014");
  await selectWeddingDate(page, "2027-08-10");
  await expect(
    page.locator('.js-time-picker[data-time-picker="start"] .js-time-trigger')
  ).toBeEnabled();
  await selectWeddingTime(page, "start", "20:00");
  await selectWeddingTime(page, "end", "19:00");
  await expect(page.locator('input[name="endTime"]')).toHaveAttribute("aria-invalid", "true");
});

test("admin günlük plan ve düğün ayrıntısı yetkili API verisiyle açılır", async ({ page }) => {
  await page.addInitScript(() => {
    window.__adminWhatsAppUrls = [];
    window.__copiedAdminMessages = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedAdminMessages.push(String(value));
        }
      }
    });
    window.open = () => ({
      opener: null,
      close() {},
      location: {
        set href(value) {
          window.__adminWhatsAppUrls.push(String(value));
        }
      }
    });
  });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "ADMIN", mustChangePassword: false, username: "admin" }
      })
    })
  );
  const wedding = {
    id: "6ae9f9e6-6217-4b6c-91ea-251be3bb6fc1",
    venueId: "de305d54-75b4-431b-adb2-eb6b9e546014",
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "+905551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "+905559876543",
    primaryContact: "GELIN",
    primaryEmail: "ayse@example.com",
    startsAt: "2026-08-10T17:00:00.000Z",
    endsAt: "2026-08-10T23:00:00.000Z",
    note: "",
    venue: { id: "de305d54-75b4-431b-adb2-eb6b9e546014", name: "Cess Wedding" },
    packageSummary: { code: "mini", name: "Mini Paket", totalPriceCents: 2000000, services: [] },
    assignments: [],
    customerUser: {
      id: "40c66ad5-b87a-4f0b-a4fa-1f3562329387",
      username: "yilmaz-demir-4821",
      mustChangePassword: true
    },
    delivery: {
      id: "f82ed2dc-49a8-4c4b-96ef-a23624af6390",
      status: "MONTAJ",
      dueDate: "2026-08-31T00:00:00.000Z",
      hasDriveUrl: false,
      driveUrl: null
    }
  };
  await page.route("**/api/v1/admin/dashboard**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          today: "2026-08-10",
          weekStart: "2026-08-10",
          weekEnd: "2026-08-16",
          metrics: { pendingBookings: 2, pendingMessages: 3, readyDeliveries: 1, todayWeddings: 1 },
          todayWeddings: [wedding],
          tomorrowWeddings: [],
          weekWeddings: [wedding],
          idleStaff: [],
          distribution: {},
          conflicts: [],
          upcomingDeliveries: []
        }
      })
    })
  );
  const secondVenueId = "a430c729-e45a-4ce9-9c98-62a94d2b8581";
  let lastCalendarUrl = "";
  await page.route("**/api/v1/admin/calendar**", (route) => {
    lastCalendarUrl = route.request().url();
    const url = new URL(lastCalendarUrl);
    const selectedVenueId = url.searchParams.get("venueId") || wedding.venueId;
    const month = url.searchParams.get("month") || "2026-08";
    const selectedVenue =
      selectedVenueId === wedding.venueId
        ? { id: wedding.venueId, name: "Cess Wedding", isActive: true }
        : { id: secondVenueId, name: "Bella Garden", isActive: true };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          month,
          today: "2026-08-10",
          venues: [
            { id: wedding.venueId, name: "Cess Wedding", isActive: true },
            { id: secondVenueId, name: "Bella Garden", isActive: true }
          ],
          selectedVenue,
          weddings: selectedVenueId === wedding.venueId && month === "2026-08" ? [wedding] : []
        }
      })
    });
  });
  const midnightApplication = {
    id: "263b221c-327b-4c8e-b015-33c70fc41e55",
    referenceCode: "DA-2026-123456",
    status: "ONAY_BEKLIYOR",
    brideFirstName: "Zeynep",
    brideLastName: "Kaya",
    bridePhone: "+905551234567",
    groomFirstName: "Emre",
    groomLastName: "Arslan",
    groomPhone: "+905559876543",
    primaryContact: "GELIN",
    primaryEmail: "zeynep@example.com",
    weddingStartsAt: "2026-08-09T21:30:00.000Z",
    weddingEndsAt: "2026-08-10T02:00:00.000Z",
    packageNameSnapshot: "Mini Paket",
    totalPriceCents: 2_000_000,
    paymentMethod: "CASH",
    venue: { name: "Cess Wedding" },
    deletedAt: null
  };
  let lastApplicationUrl = "";
  await page.route("**/api/v1/admin/booking-applications?**", (route) => {
    lastApplicationUrl = route.request().url();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [midnightApplication] })
    });
  });
  await page.route("**/api/v1/admin/weddings", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [wedding] })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [{ id: wedding.venueId, name: "Cess Wedding" }]
      })
    })
  );
  await page.route("**/api/v1/admin/message-tasks**", (route) => {
    if (route.request().url().endsWith("/render")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            message: "Geçici parola: yalnız-panoda",
            whatsappUrl: "https://wa.me/905551112233",
            expectedUpdatedAt: "2026-08-10T10:00:00.000Z"
          }
        })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: "f930bd2d-222d-4d22-86dc-7487fcd3f150",
            kind: "PASSWORD_RESET",
            status: "PENDING",
            recipientPhone: "+905551112233",
            dueAt: "2026-08-10T10:00:00.000Z",
            updatedAt: "2026-08-10T10:00:00.000Z",
            wedding: { brideFirstName: "Ayşe", groomFirstName: "Mehmet" },
            sentAt: null
          }
        ]
      })
    });
  });
  await page.route(`**/api/v1/admin/weddings/${wedding.id}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { ...wedding, availableStaff: [], messageTasks: [] }
        })
      });
      return;
    }
    const body = route.request().postDataJSON();
    expect(body.brideLastName).toBe("Kaya");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          ...wedding,
          brideLastName: "Kaya",
          credentialsRegenerated: true,
          username: "kaya-demir-7721"
        }
      })
    });
  });
  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "Günün akışı" })).toBeVisible();
  await clickPanel(page, "weddings");
  await page.getByRole("button", { name: "Ayrıntılar" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Ayşe Yılmaz & Mehmet Demir" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Düğün bilgilerini düzenle" }).click();
  await expect(page.getByRole("heading", { name: "Bilgileri güncelle" })).toBeVisible();
  await page.locator('.js-wedding-form input[name="brideLastName"]').fill("Kaya");
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.locator(".global-message")).toContainText("Yeni kullanıcı adı");
  await page.locator(".js-wedding-detail [data-close-dialog]").click();
  await clickPanel(page, "applications");
  await expect(page.locator(".application-card")).toContainText("10 Ağu 2026");
  await expect(page.locator(".application-card")).toContainText("00:30");
  await page.getByLabel("Başvuru referans kodu").fill("DA-2026-123456");
  await page.getByRole("button", { name: "Bul" }).click();
  await expect.poll(() => lastApplicationUrl).toContain("referenceCode=DA-2026-123456");
  await clickPanel(page, "calendar");
  await expect(page.getByRole("heading", { name: "Ağustos 2026 · Cess Wedding" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ayşe & Mehmet/ }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Bella Garden" }).click();
  await expect.poll(() => lastCalendarUrl).toContain(`venueId=${secondVenueId}`);
  await expect(page.getByRole("heading", { name: "Ağustos 2026 · Bella Garden" })).toBeVisible();
  await page.getByRole("button", { name: "Önceki ay" }).click();
  await expect.poll(() => lastCalendarUrl).toContain("month=2026-07");
  await clickPanel(page, "messages");
  await page.getByRole("button", { name: "WhatsApp" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedAdminMessages[0]))
    .toBe("Geçici parola: yalnız-panoda");
  const openedWhatsAppUrl = await page.evaluate(() => window.__adminWhatsAppUrls[0]);
  expect(new URL(openedWhatsAppUrl).search).toBe("");
  expect(openedWhatsAppUrl).not.toContain("yalnız-panoda");
});

test("müşteri teslimat paneli linki teslim öncesinde göstermiyor", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "MUSTERI", mustChangePassword: false, username: "yilmaz-demir-4821" }
      })
    })
  );
  await page.route("**/api/v1/customer/dashboard", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          couple: { bride: "Ayşe Yılmaz", groom: "Mehmet Demir" },
          venue: "Cess Wedding",
          startsAt: "2026-08-10T17:00:00.000Z",
          delivery: {
            status: "MONTAJ",
            dueDate: "2026-08-31T00:00:00.000Z",
            releasedAt: null,
            history: []
          }
        }
      })
    })
  );
  await page.goto("/musteri-paneli.html");
  await expect(page.getByText("Ayşe Yılmaz")).toBeVisible();
  await expect(page.locator(".delivery-release")).toBeHidden();
  await expect(page.getByText("Montaj Aşamasında").first()).toBeVisible();
});

test("müşteri teslimat penceresini geciken API yanıtından önce güvenli açar", async ({ page }) => {
  await page.addInitScript(() => {
    window.__deliveryUrls = [];
    window.open = () => ({
      opener: null,
      close() {},
      location: {
        set href(value) {
          window.__deliveryUrls.push(String(value));
        }
      }
    });
  });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "MUSTERI", mustChangePassword: false, username: "musteri" }
      })
    })
  );
  await page.route("**/api/v1/customer/dashboard", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          couple: { bride: "Ayşe Yılmaz", groom: "Mehmet Demir" },
          venue: "Cess Wedding",
          startsAt: "2026-08-10T17:00:00.000Z",
          delivery: {
            status: "TESLIM_EDILDI",
            dueDate: "2026-08-31T00:00:00.000Z",
            releasedAt: "2026-08-31T12:00:00.000Z",
            history: []
          }
        }
      })
    })
  );
  await page.route("**/api/v1/customer/delivery", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { driveUrl: "https://drive.google.com/file/d/e2e-test" }
      })
    });
  });

  await page.goto("/musteri-paneli.html");
  await page.locator(".js-open-delivery").click();
  await expect
    .poll(() => page.evaluate(() => window.__deliveryUrls[0]))
    .toBe("https://drive.google.com/file/d/e2e-test");
});

test("referans WhatsApp'tan önce oluşturulur ve yapılandırılmamış alıcıya veri gönderilmez", async ({
  page
}) => {
  await page.addInitScript(() => {
    window.__whatsappUrls = [];
    window.open = () => ({
      opener: null,
      close() {},
      location: {
        set href(value) {
          window.__whatsappUrls.push(String(value));
        }
      }
    });
  });

  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          packages: [
            {
              code: "mini",
              name: "Mini Paket",
              priceCents: 10_500,
              imagePath: "assets/images/hero-couple.webp"
            }
          ],
          services: []
        }
      })
    })
  );
  await page.route("**/api/v1/payment-instructions", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          mode: "test",
          enabled: true,
          bankName: "Test Bankası",
          accountHolder: "Düğünajansım",
          iban: "TR000000000000000000000000",
          whatsappPhone: "",
          notice: "Test ödeme bilgileri — gerçek para göndermeyin."
        }
      })
    })
  );
  await page.route("**/api/v1/venues*", (route) => {
    if (route.request().url().includes("/availability")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { date: "2027-08-10", occupiedSlots: [] }
        })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [{ id: "de305d54-75b4-431b-adb2-eb6b9e546014", name: "Cess Wedding" }]
      })
    });
  });

  let bookingRequest;
  const paymentFlowData = {
    id: "4a68ef8c-65df-4899-a560-e4c79b47b455",
    referenceCode: "DA-2026-654321",
    status: "ONAY_BEKLIYOR",
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "+905551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "+905559876543",
    primaryContact: "GELIN",
    primaryEmail: "ayse@example.com",
    weddingDate: "2027-08-10",
    startTime: "18:00",
    endTime: "23:00",
    endsNextDay: false,
    customVenueName: "Yıldızlar Düğün Salonu",
    venueName: "Yıldızlar Düğün Salonu",
    packageCode: "mini",
    packageName: "Mini Paket",
    packagePriceCents: 10_500,
    serviceCodes: [],
    services: [],
    paymentMethod: "CASH",
    totalPriceCents: 9_451,
    payableNowCents: 9_451,
    note: "",
    privacyConsent: true,
    marketingConsent: false,
    paymentFlowExpiresAt: "2027-08-10T20:00:00.000Z",
    whatsappHandoffAt: null,
    paymentFlowExpiredAt: null
  };
  await page.route("**/api/v1/booking-applications", async (route) => {
    bookingRequest = {
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()["idempotency-key"],
      paymentFlowKey: route.request().headers()["payment-flow-key"]
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: paymentFlowData
      })
    });
  });
  await page.route(
    "**/api/v1/booking-applications/4a68ef8c-65df-4899-a560-e4c79b47b455/payment-flow",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: paymentFlowData })
      })
  );

  await page.goto("/paketini-olustur.html");
  await expect(page.locator('input[name="base-package"]')).toHaveCount(1);
  await page.locator(".js-next-step").click();
  await page.locator(".js-details-step").click();

  const form = page.locator("#checkout-form");
  await form.locator('input[name="brideFirstName"]').fill("Ayşe");
  await form.locator('input[name="brideLastName"]').fill("Yılmaz");
  await form.locator('input[name="bridePhone"]').fill("05551234567");
  await form.locator('input[name="groomFirstName"]').fill("Mehmet");
  await form.locator('input[name="groomLastName"]').fill("Demir");
  await form.locator('input[name="groomPhone"]').fill("05559876543");
  await form.locator('input[name="primaryEmail"]').fill("ayse@example.com");
  await form.locator('select[name="venueId"]').selectOption("__custom_venue__");
  await form.locator('input[name="customVenueName"]').fill("Yıldızlar Düğün Salonu");
  await selectWeddingDate(page, "2027-08-10");
  await selectWeddingTime(page, "start", "18:00");
  await selectWeddingTime(page, "end", "23:00");
  await form.locator('input[name="privacyConsent"]').check();
  await form.getByRole("button", { name: "Ödemeye Geç" }).click();

  await expect(page.locator(".js-cash-total")).toHaveText("94,5 TL");
  await page.locator(".js-summary-step").click();
  await expect(page.locator(".js-transfer-reference")).toContainText("DA-2026-654321");
  await expect(page.locator(".js-order-payable")).toHaveText("94,51 TL");
  await page.reload();
  await expect(page.locator(".js-transfer-reference")).toContainText("DA-2026-654321");
  await expect(page.locator(".js-transfer-layout")).toBeVisible();
  await page.locator(".js-complete-with-whatsapp").click();

  await expect(page.locator(".js-transfer-layout")).toBeVisible();
  await expect(page.locator(".js-order-subtotal")).toHaveText("94,51 TL");
  await expect(
    page.locator(".js-order-subtotal").locator("xpath=preceding-sibling::dt")
  ).toHaveText("Doğrulanmış toplam");
  await expect(page.locator(".js-order-payable")).toHaveText("94,51 TL");
  expect(bookingRequest.body.paymentMethod).toBe("CASH");
  expect(bookingRequest.body.venueId).toBeUndefined();
  expect(bookingRequest.body.customVenueName).toBe("Yıldızlar Düğün Salonu");
  expect(bookingRequest.idempotencyKey).toBeTruthy();
  expect(bookingRequest.paymentFlowKey).toBeTruthy();

  const whatsappUrls = await page.evaluate(() => window.__whatsappUrls);
  expect(whatsappUrls).toEqual([]);
  await expect(page.locator(".js-payment-notification-status")).toContainText(
    "WhatsApp alıcısı henüz yapılandırılmadığı için yönlendirme yapılamıyor"
  );
});

test("geri yüklenen ödeme akışı WhatsApp geçişini kaydeder ve banka ekranını açık tutar", async ({
  page
}) => {
  const applicationId = "4a68ef8c-65df-4899-a560-e4c79b47b455";
  const paymentFlowKey = "payment-flow-key-1234567890-abcdef";
  const paymentFlowData = {
    id: applicationId,
    referenceCode: "DA-2026-777888",
    status: "ONAY_BEKLIYOR",
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "+905551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "+905559876543",
    primaryContact: "GELIN",
    primaryEmail: "ayse@example.com",
    weddingDate: "2027-08-10",
    startTime: "18:00",
    endTime: "23:00",
    endsNextDay: false,
    customVenueName: "Yıldızlar Düğün Salonu",
    venueName: "Yıldızlar Düğün Salonu",
    packageCode: "mini",
    packageName: "Mini Paket",
    packagePriceCents: 10_500,
    serviceCodes: [],
    services: [],
    paymentMethod: "CASH",
    totalPriceCents: 9_451,
    payableNowCents: 9_451,
    note: "",
    privacyConsent: true,
    marketingConsent: false,
    paymentFlowExpiresAt: "2027-08-10T20:00:00.000Z",
    whatsappHandoffAt: null,
    paymentFlowExpiredAt: null
  };
  await page.addInitScript(
    ({ id, key }) => {
      window.sessionStorage.setItem(
        "dugunajansim_payment_flow",
        JSON.stringify({ applicationId: id, paymentFlowKey: key })
      );
      window.__whatsappUrls = [];
      window.open = () => ({
        opener: null,
        close() {},
        location: {
          set href(value) {
            window.__whatsappUrls.push(String(value));
          }
        }
      });
    },
    { id: applicationId, key: paymentFlowKey }
  );
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          packages: [
            {
              code: "mini",
              name: "Mini Paket",
              priceCents: 10_500,
              imagePath: "assets/images/hero-couple.webp"
            }
          ],
          services: []
        }
      })
    })
  );
  await page.route("**/api/v1/venues*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: route.request().url().includes("/availability")
          ? { date: "2027-08-10", occupiedSlots: [] }
          : []
      })
    })
  );
  await page.route("**/api/v1/payment-instructions", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          mode: "live",
          enabled: true,
          bankName: "Test Bankası",
          accountHolder: "Düğünajansım",
          iban: "TR000000000000000000000000",
          whatsappPhone: "905551112233",
          notice: "Test ödeme bilgileri"
        }
      })
    })
  );
  await page.route(`**/api/v1/booking-applications/${applicationId}/payment-flow`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: paymentFlowData })
    })
  );
  await page.route(`**/api/v1/booking-applications/${applicationId}/whatsapp-handoff`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { ...paymentFlowData, whatsappHandoffAt: "2026-08-07T13:00:00.000Z" }
      })
    })
  );

  await page.goto("/paketini-olustur.html");
  await expect(page.locator(".js-transfer-reference")).toContainText("DA-2026-777888");
  await page.locator(".js-complete-with-whatsapp").click();
  await expect
    .poll(() => page.evaluate(() => window.__whatsappUrls[0]))
    .toContain("https://wa.me/905551112233?text=");
  await expect(page.locator(".js-transfer-layout")).toBeVisible();
  await expect(page.locator(".js-edit-package")).toBeDisabled();
  await expect(page.locator(".js-payment-notification-status")).toContainText(
    "WhatsApp aşamasına geçildi"
  );
});

test("zorunlu parola değişim ekranı 15–128 karakter sözleşmesini uygular", async ({ page }) => {
  let passwordChangeRequestCount = 0;
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "ADMIN", mustChangePassword: true, username: "admin" }
      })
    })
  );
  await page.route("**/api/v1/auth/password/change", (route) => {
    passwordChangeRequestCount += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { changed: true } })
    });
  });

  await page.goto("/login.html");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("gecici-parola");
  await page.getByRole("button", { name: "Giriş Yap" }).click();

  const newPassword = page.locator("#new-password");
  const confirmPassword = page.locator("#confirm-password");
  await expect(newPassword).toHaveAttribute("minlength", "15");
  await expect(newPassword).toHaveAttribute("maxlength", "128");
  await expect(confirmPassword).toHaveAttribute("minlength", "15");
  await expect(confirmPassword).toHaveAttribute("maxlength", "128");

  await newPassword.fill("12345678901234");
  await confirmPassword.fill("12345678901234");
  await page.getByRole("button", { name: "Parolayı Kaydet" }).click();
  await expect(page.locator(".password-change-message")).toHaveText(
    "Yeni parolanız 15–128 karakter arasında olmalıdır."
  );
  expect(passwordChangeRequestCount).toBe(0);
});

test("oturum acilmis kullanici anasayfada role uygun paneli ve cikis butonunu gorur", async ({
  page,
  isMobile
}) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "ADMIN", mustChangePassword: false, username: "admin" }
      })
    })
  );

  await page.goto("/index.html");

  if (isMobile) {
    const menuButton = page.locator("[aria-controls]").first();
    await menuButton.click();
    const mobileLogin = page.locator(".mobile-login-button");
    await expect(mobileLogin).toContainText("Admin Paneli");
    await expect(mobileLogin).toHaveAttribute("href", "admin.html");
    const mobileLogout = page.locator(".mobile-logout-button");
    await expect(mobileLogout).toBeVisible();
  } else {
    const loginLink = page.locator(".header-login");
    await expect(loginLink).toContainText("Admin Paneli");
    await expect(loginLink).toHaveAttribute("href", "admin.html");

    const logoutButton = page.locator(".header-logout");
    await expect(logoutButton).toBeVisible();
  }
});

test("salon sorumlusu yalniz kendi salon takvimi ve ekibini yonetir", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const venueId = "de305d54-75b4-431b-adb2-eb6b9e546014";
  const staffId = "2bb5d7fd-232f-4a96-a56a-92d93b669f21";
  const wedding = {
    id: "6ae9f9e6-6217-4b6c-91ea-251be3bb6fc1",
    venueId,
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "+905551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "+905559876543",
    startsAt: "2026-08-10T17:00:00.000Z",
    endsAt: "2026-08-10T23:00:00.000Z",
    note: "Giriş çekimi 18.30",
    venue: { id: venueId, name: "Cess Wedding" },
    packageSummary: { name: "Mini Paket" },
    assignments: []
  };
  const staff = {
    id: staffId,
    venueId,
    firstName: "Cem",
    lastName: "Arslan",
    phone: "+905551110101",
    specialties: ["PHOTOGRAPHY", "DRONE"],
    isActive: true,
    assignments: []
  };
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          role: "SALON_YETKILISI",
          mustChangePassword: false,
          username: "cess-sorumlu",
          venueId
        }
      })
    })
  );
  await page.route("**/api/v1/operations/dashboard**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          venue: { id: venueId, name: "Cess Wedding" },
          today: "2026-08-10",
          weekStart: "2026-08-10",
          weekEnd: "2026-08-16",
          metrics: { todayWeddings: 1, weekWeddings: 1, activeStaff: 1, unassignedWeddings: 1 },
          todayWeddings: [wedding],
          weekWeddings: [wedding],
          idleStaff: [staff],
          conflicts: []
        }
      })
    })
  );
  await page.route("**/api/v1/operations/calendar**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          venue: { id: venueId, name: "Cess Wedding" },
          month: "2026-08",
          today: "2026-08-10",
          weddings: [wedding]
        }
      })
    })
  );
  await page.route("**/api/v1/operations/staff", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [staff] })
    })
  );

  await page.goto("/operasyon-paneli.html");
  await expect(page.locator(".js-venue-name")).toContainText("Cess Wedding");
  await clickPanel(page, "calendar", true);
  await expect(page.locator(".calendar-event")).toContainText("Ayşe & Mehmet");
  await clickPanel(page, "staff", true);
  await expect(page.locator(".js-staff")).toContainText("Cem Arslan");
  await page.locator(".js-add-staff").click();
  await expect(page.locator(".js-staff-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".js-staff-dialog")).toBeHidden();
  expect(pageErrors).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});

test("oturum acilmis kullanici login.html sayfasina gittiginde otomatik panele yonlendirilir", async ({
  page
}) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "MUSTERI", mustChangePassword: false, username: "musteri" }
      })
    })
  );

  await page.goto("/login.html");
  await page.waitForURL("**/musteri-paneli.html");
  expect(page.url()).toContain("musteri-paneli.html");
});

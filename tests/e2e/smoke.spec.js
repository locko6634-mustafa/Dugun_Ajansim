import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

const siteContent = JSON.parse(
  readFileSync(new URL("../../content/site-content.json", import.meta.url), "utf8")
);

const pages = ["/index.html", "/login.html", "/paketini-olustur.html"];
const defaultPaymentPolicy = Object.freeze({
  cashDiscountPercent: 10,
  depositMaximumCents: 500_000
});
const defaultBookingFormConstraints = Object.freeze({
  personName: {
    minLength: 2,
    maxLength: 80,
    pattern: "^[\\p{L}\\p{M}][\\p{L}\\p{M} '’\\-]*$",
    message: "Ad ve soyad yalnızca harf, boşluk, kesme işareti ve kısa çizgi içerebilir."
  },
  phone: {
    minLength: 10,
    maxLength: 24,
    pattern: "^\\+?[\\d\\s\\(\\)\\x2D]+$",
    message: "Telefon yalnızca rakam ve telefon ayraçları içerebilir."
  },
  email: { maxLength: 254 },
  customVenueName: { minLength: 2, maxLength: 140 },
  note: { maxLength: 2_000 }
});
const defaultBookingSchedulePolicy = Object.freeze({
  earliestTime: "00:00",
  latestTime: "23:30",
  stepMinutes: 30,
  allowNextDay: false
});
const defaultAdminCatalogFormConstraints = Object.freeze({
  code: { minLength: 1, maxLength: 80, pattern: "^[a-z0-9-]+$" },
  name: { minLength: 2, maxLength: 80 },
  subtitle: { maxLength: 200 },
  eyebrow: { maxLength: 100 },
  description: { maxLength: 2_000 },
  imagePath: { maxLength: 500 },
  delivery: { maxLength: 200 },
  feature: { maxLength: 500 },
  galleryItem: { maxLength: 500 },
  priceCents: { minimum: 0, maximum: 100_000_000, step: 1 },
  venue: {
    displayName: { minLength: 2, maxLength: 140 },
    displayOrder: { minimum: 0, maximum: 10_000, step: 1 }
  }
});

test("@frontend-smoke yayın manifesti SEO, FAQ ve footer içeriğine yansır", async ({ page }) => {
  const homePage = siteContent.pages["index.html"];

  await page.goto("/index.html");
  await expect(page).toHaveTitle(homePage.title);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    homePage.description
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    homePage.socialDescription
  );
  await expect(page.locator(".faq-item")).toHaveCount(siteContent.home.faq.items.length);
  await expect(page.locator(".faq-question").last()).toContainText(
    siteContent.home.faq.items.at(-1).question
  );
  await expect(page.locator(".site-footer__brand > p")).toHaveText(
    siteContent.brand.footerDescription
  );
  await expect(page.locator('.site-footer__contact a[href^="tel:"]')).toHaveAttribute(
    "href",
    "tel:+905386888306"
  );
  await expect(page.locator('.site-footer__contact a[href^="https://wa.me/"]')).toHaveAttribute(
    "href",
    "https://wa.me/905386888306"
  );
});

async function clickPanel(page, panelName, isOps = false) {
  const toggleSelector = isOps ? ".js-toggle-ops-sidebar" : ".js-toggle-sidebar";
  const toggleBtn = page.locator(toggleSelector);
  if (await toggleBtn.isVisible()) {
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
  }
  await page.locator(`[data-panel="${panelName}"]`).first().click();
}

async function completeAdminStepUp(page) {
  const dialog = page.locator("#app-custom-dialog");
  const passwordInput = dialog.locator(".js-admin-step-up-password");
  const totpInput = dialog.locator(".js-admin-step-up-totp");

  await expect(dialog).toBeVisible();
  await expect(passwordInput).toHaveAttribute("type", "password");
  await expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
  await expect(totpInput).toHaveAttribute("inputmode", "numeric");
  await expect(totpInput).toHaveAttribute("autocomplete", "one-time-code");
  await passwordInput.fill("Guvenli-Admin-Step-Up-2026!");
  await totpInput.fill("123456");
  await dialog.getByRole("button", { name: "Doğrula ve devam et" }).click();
  await expect(dialog).toBeHidden();
  await expect(dialog.locator(".js-admin-step-up-password")).toHaveCount(0);
  await expect(dialog.locator(".js-admin-step-up-totp")).toHaveCount(0);
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
  test(`@frontend-smoke @responsive ${pagePath} temel sayfa kontrolleri`, async ({ page }) => {
    await page.goto(pagePath);
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.locator("h1:visible")).toHaveCount(1);
    await expect(page).toHaveTitle(/.+/);
    if (pagePath === "/login.html") {
      await expect(page.locator("#username")).toHaveAttribute("maxlength", "64");
      await expect(page.locator("#password")).toHaveAttribute("maxlength", "256");
      await expect(page.locator(".forgot-button")).toHaveAttribute("href", /^https:\/\/wa\.me\//);
    }
    if (pagePath === "/index.html") {
      await expect(page.locator(".shoot-card__open").first()).toHaveAccessibleName(
        "Talia akşam düğün çekimini büyüt ve oynat"
      );
      await expect(page.locator(".shoot-card__sound").first()).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    }
  });

  test(`@frontend-smoke @responsive ${pagePath} yatay tasma uretmiyor`, async ({ page }) => {
    await page.goto(pagePath);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test(`@frontend-smoke @responsive ${pagePath} axe kritik ihlal icermiyor`, async ({ page }) => {
    await page.goto(pagePath);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  });
}

test("@frontend-smoke ana sayfa mobil menu acilip kapanir", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");
  const menuButton = page.locator("[aria-controls]").first();
  if (await menuButton.count()) {
    await menuButton.click();
    await page.keyboard.press("Escape");
    await expect(menuButton).toBeVisible();
  }
});

test("@frontend-smoke @responsive mobil paket adimlari baglanti cizgisi gostermez", async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");

  const connectorContent = await page
    .locator(".package-invitation__steps li")
    .first()
    .evaluate((step) => getComputedStyle(step, "::after").content);

  expect(connectorContent).toBe("none");
});

test("@frontend-smoke ana sayfa header navigasyon linkleri aktif durumu gunceller", async ({
  page,
  isMobile
}) => {
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

test("@frontend-smoke ana sayfa kartları ve detayları backend kataloğundan alır", async ({
  page
}) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: defaultPaymentPolicy,
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
          packages: [{ code: "mini", name: "Mini Paket", priceCents: 2_345_600 }],
          services: [
            {
              code: "yeni-hizmet",
              category: "experience",
              name: "API Katalog Hizmeti",
              eyebrow: "API Kaynağı",
              description: "Admin panelinden yönetilen güncel hizmet açıklaması.",
              imagePath: "assets/images/services/360-video.webp",
              gallery: ["assets/images/services/360-video.webp"],
              features: ["API üzerinden gelen özellik"],
              delivery: "7 iş günü",
              priceCents: 765_400
            }
          ]
        }
      })
    })
  );

  await page.goto("/index.html");
  await expect(page.locator(".js-starting-price")).toContainText("23.456");
  await expect(page.locator(".service-card")).toHaveCount(1);
  await expect(page.locator(".service-card h3")).toHaveText("API Katalog Hizmeti");
  await expect(page.locator(".service-card p")).toHaveText(
    "Admin panelinden yönetilen güncel hizmet açıklaması."
  );
  await expect(page.locator(".service-card img")).toHaveAttribute(
    "src",
    "assets/images/services/360-video.webp"
  );
  await expect(page.locator('[data-open-service="yeni-hizmet"]')).toHaveAccessibleName(
    "API Katalog Hizmeti hizmetini incele"
  );
  await expect(page.locator('[data-open-service="fotograf"]')).toHaveCount(0);
  await page.locator('[data-open-service="yeni-hizmet"]').click();
  await expect(page.locator("#home-service-detail .js-detail-title")).toHaveText(
    "API Katalog Hizmeti"
  );
  await expect(page.locator("#home-service-detail .js-detail-price")).toContainText("7.654");
  await expect(page.locator("#home-service-detail .js-detail-delivery")).toHaveText("7 iş günü");
  await expect(page.locator("#home-service-detail .js-detail-features li")).toHaveText([
    "API üzerinden gelen özellik"
  ]);
  await expect(page.locator("#faq-answer-4")).toContainText("en geç 21 takvim günü");
});

test("@frontend-smoke ana sayfa referans mekânlarını public API sırasıyla gösterir", async ({
  page,
  isMobile
}) => {
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: "1",
            slug: "api-bir",
            name: "API Bir Operasyon",
            displayName: "API Bir",
            imagePath: "assets/images/venues/talia.webp",
            displayOrder: 1,
            isFeatured: true
          },
          {
            id: "2",
            slug: "api-iki",
            name: "API İki Operasyon",
            displayName: "API İki",
            imagePath: "assets/images/venues/bella.webp",
            displayOrder: 2,
            isFeatured: true
          },
          {
            id: "3",
            slug: "api-uc",
            name: "API Üç Operasyon",
            displayName: "API Üç",
            imagePath: "assets/images/venues/rena.webp",
            displayOrder: 3,
            isFeatured: true
          },
          {
            id: "4",
            slug: "api-dort",
            name: "API Dört Operasyon",
            displayName: "API Dört",
            imagePath: "assets/images/venues/cess.webp",
            displayOrder: 4,
            isFeatured: true
          },
          {
            id: "5",
            slug: "api-bes",
            name: "API Beş Operasyon",
            displayName: "API Beş",
            imagePath: "assets/images/venues/green-house.webp",
            displayOrder: 5,
            isFeatured: true
          },
          {
            id: "6",
            slug: "gizli-mekan",
            name: "Gizli Mekân",
            displayName: "Gizli Mekân",
            imagePath: "assets/images/venues/yesil-nesil.webp",
            displayOrder: 6,
            isFeatured: false
          }
        ]
      })
    })
  );

  await page.goto("/index.html");
  await expect(page.locator(".venue-card__name")).toHaveText([
    "API Bir",
    "API İki",
    "API Üç",
    "API Dört",
    "API Beş"
  ]);
  await expect(page.locator(".venue-card")).toHaveCount(5);
  await expect(page.locator(".venue-card").first().locator("img")).toHaveAttribute(
    "src",
    "assets/images/venues/talia.webp"
  );
  await expect(page.getByText("Gizli Mekân", { exact: true })).toHaveCount(0);
  await expect(page.locator(".js-venues-toggle span")).toHaveText("Tüm Mekânları Gör (5 Mekân)");

  if (isMobile) {
    await expect(page.locator(".venue-card--extra")).toBeHidden();
    await page.locator(".js-venues-toggle").click();
    await expect(page.locator(".venue-card--extra")).toBeVisible();
    await expect(page.locator(".js-venues-toggle span")).toHaveText("Daha Az Göster");
  }
});

test("@frontend-smoke anasayfa butonuna basildiginda sayfanin en ustune kaydirir", async ({
  page,
  isMobile
}) => {
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

test("@frontend-smoke paketini olustur sayfasinda masaustunde sepet acilip kapanir", async ({
  page,
  isMobile
}) => {
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

test("@frontend-smoke paket formu çift, saat ve salon alanlarını backend kataloğuyla hazırlar", async ({
  page,
  isMobile
}) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: defaultPaymentPolicy,
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
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
        data: { date: "2027-08-10", hasOccupancy: true }
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
  if (isMobile) {
    const dateTrigger = page.locator(".js-date-trigger");
    await dateTrigger.evaluate((trigger) => {
      window.scrollTo(0, trigger.getBoundingClientRect().top + window.scrollY - 170);
    });
    await dateTrigger.click();
    const pickerPosition = await page.locator(".js-date-popover").evaluate((popover) => {
      const trigger = document.querySelector(".js-date-trigger");
      const stickyBottom = [
        ...document.querySelectorAll(".builder-header, .builder-progress")
      ].reduce((bottom, element) => Math.max(bottom, element.getBoundingClientRect().bottom), 0);
      return {
        popover: popover.getBoundingClientRect().toJSON(),
        trigger: trigger.getBoundingClientRect().toJSON(),
        stickyBottom,
        viewportHeight: window.innerHeight
      };
    });
    const triggerDistance = Math.max(
      pickerPosition.popover.top - pickerPosition.trigger.bottom,
      pickerPosition.trigger.top - pickerPosition.popover.bottom,
      0
    );
    expect(triggerDistance).toBeLessThanOrEqual(12);
    expect(pickerPosition.popover.top).toBeGreaterThanOrEqual(pickerPosition.stickyBottom + 7);
    expect(pickerPosition.popover.bottom).toBeLessThanOrEqual(pickerPosition.viewportHeight - 15);
    await page.keyboard.press("Escape");
  }
  await selectWeddingDate(page, "2027-08-10");
  await expect(page.locator(".js-availability-banner")).toContainText(
    "Bu tarihte salon için başka kayıtlar bulunmaktadır."
  );
  await expect(page.locator(".js-availability-banner")).not.toContainText(/\d{2}:\d{2}/);
  await expect(
    page.locator('.js-time-picker[data-time-picker="start"] .js-time-trigger')
  ).toBeEnabled();
  const endTimePicker = page.locator('.js-time-picker[data-time-picker="end"]');
  await endTimePicker.locator(".js-time-trigger").click();
  await expect(endTimePicker.locator('[data-time-value="02:00"]')).toHaveCount(1);
  await expect(endTimePicker.locator("[data-time-value]")).toHaveCount(48);
  await page.keyboard.press("Escape");
  await expect(page.locator('input[name="endsNextDay"]')).toHaveCount(0);
  await selectWeddingTime(page, "start", "20:00");
  await selectWeddingTime(page, "end", "19:00");
  await expect(page.locator('input[name="endTime"]')).toHaveAttribute("aria-invalid", "true");
  await selectWeddingTime(page, "end", "22:00");
  await expect(page.locator('input[name="endTime"]')).not.toHaveAttribute("aria-invalid", "true");
});

test("@frontend-smoke @admin admin günlük plan ve düğün ayrıntısı yetkili API verisiyle açılır", async ({
  page,
  isMobile
}) => {
  await page.addInitScript(() => {
    window.__adminWhatsAppUrls = [];
    window.__adminWindowOpenUrls = [];
    window.__copiedAdminMessages = [];
    window.__weddingPrintCalls = 0;
    window.__weddingPrintTitles = [];
    window.print = () => {
      window.__weddingPrintCalls += 1;
      window.__weddingPrintTitles.push(document.title);
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedAdminMessages.push(String(value));
        }
      }
    });
    window.open = (url) => {
      window.__adminWindowOpenUrls.push(String(url));
      if (url && url !== "about:blank") window.__adminWhatsAppUrls.push(String(url));
      return {
        opener: null,
        close() {},
        location: {
          set href(value) {
            window.__adminWhatsAppUrls.push(String(value));
          }
        }
      };
    };
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
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { status: "healthy", database: "connected" } })
    })
  );
  let adminStepUpActive = false;
  const adminStepUpBodies = [];
  await page.route("**/api/v1/auth/admin-step-up", async (route) => {
    adminStepUpBodies.push(route.request().postDataJSON());
    adminStepUpActive = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { validUntil: "2026-08-10T10:05:00.000Z" }
      })
    });
  });
  const requireAdminStepUp = async (route) => {
    if (adminStepUpActive) return false;
    await route.fulfill({
      status: 428,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        message: "Ek yönetici doğrulaması gerekli.",
        details: { code: "ADMIN_STEP_UP_REQUIRED" }
      })
    });
    return true;
  };
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
    packageSummary: {
      code: "mini",
      name: "Mini Paket",
      totalPriceCents: 2_250_000,
      services: [{ code: "baski", name: "Ek Baskı", priceCents: 250_000 }]
    },
    paymentTotalCents: 2_250_000,
    paymentDepositCents: 300_000,
    paymentReceivedCents: 750_000,
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
  const pastCalendarWedding = {
    ...wedding,
    id: "7be9f9e6-6217-4b6c-91ea-251be3bb6fc2",
    brideFirstName: "Elif",
    groomFirstName: "Can",
    startsAt: "2026-08-04T17:00:00.000Z",
    endsAt: "2026-08-04T20:00:00.000Z"
  };
  const previousMonthWedding = {
    ...wedding,
    id: "8ce9f9e6-6217-4b6c-91ea-251be3bb6fc3",
    venueId: "a430c729-e45a-4ce9-9c98-62a94d2b8581",
    brideFirstName: "Derya",
    groomFirstName: "Bora",
    startsAt: "2026-07-18T17:00:00.000Z",
    endsAt: "2026-07-18T20:00:00.000Z",
    venue: { id: "a430c729-e45a-4ce9-9c98-62a94d2b8581", name: "Bella Garden" }
  };
  const activationTask = {
    id: "a530bd2d-222d-4d22-86dc-7487fcd3f151",
    kind: "ACCOUNT_ACTIVATION",
    status: "PLANNED",
    recipientPhone: "+905551234567",
    dueAt: "2026-08-22T10:00:00.000Z",
    earlyOverrideAt: null,
    updatedAt: "2026-08-10T10:00:00.000Z",
    sentAt: null
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
          metrics: {
            pendingBookings: 2,
            pendingMessages: 3,
            readyDeliveries: 1,
            todayWeddings: 1
          },
          todayWeddings: [wedding],
          tomorrowWeddings: [],
          weekWeddings: [wedding],
          idleStaff: [],
          availabilityDate: "2026-08-10",
          venues: [wedding.venue],
          selectedVenue: null,
          staffAvailability: [],
          distribution: {},
          conflicts: [],
          upcomingDeliveries: [
            {
              id: wedding.delivery.id,
              status: "KONTROL",
              dueDate: "2026-08-12T00:00:00.000Z",
              driveLinkReminderDays: 2,
              wedding: {
                id: wedding.id,
                brideFirstName: wedding.brideFirstName,
                groomFirstName: wedding.groomFirstName
              }
            }
          ]
        }
      })
    })
  );
  await page.route("**/api/v1/admin/catalog-form-constraints", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: defaultAdminCatalogFormConstraints })
    })
  );
  const secondVenueId = "a430c729-e45a-4ce9-9c98-62a94d2b8581";
  let lastCalendarUrl = "";
  await page.route("**/api/v1/admin/calendar**", (route) => {
    lastCalendarUrl = route.request().url();
    const url = new URL(lastCalendarUrl);
    const selectedVenueId = url.searchParams.get("venueId");
    const month = url.searchParams.get("month") || "2026-08";
    const selectedVenue = selectedVenueId
      ? selectedVenueId === wedding.venueId
        ? { id: wedding.venueId, name: "Cess Wedding", isActive: true }
        : { id: secondVenueId, name: "Bella Garden", isActive: true }
      : null;
    const weddings =
      month === "2026-08" && (!selectedVenueId || selectedVenueId === wedding.venueId)
        ? [pastCalendarWedding, wedding]
        : month === "2026-07" && (!selectedVenueId || selectedVenueId === secondVenueId)
          ? [previousMonthWedding]
          : [];
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
          weddings
        }
      })
    });
  });
  const midnightApplication = {
    id: "263b221c-327b-4c8e-b015-33c70fc41e55",
    referenceCode: "DA-2026-123456",
    status: "ONAY_BEKLIYOR",
    source: "PUBLIC_FORM",
    paymentFlowExpiresAt: "2020-08-07T12:00:00.000Z",
    whatsappHandoffAt: "2020-08-07T11:30:00.000Z",
    paymentFlowExpiredAt: null,
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
  const decisionTaskId = "b630bd2d-222d-4d22-86dc-7487fcd3f152";
  const approvableApplication = {
    ...midnightApplication,
    id: "c730bd2d-222d-4d22-86dc-7487fcd3f153",
    referenceCode: "DA-2026-123456",
    paymentFlowExpiresAt: "2026-08-20T12:00:00.000Z",
    whatsappHandoffAt: "2026-08-13T11:30:00.000Z",
    weddingStartsAt: "2026-08-22T17:00:00.000Z",
    weddingEndsAt: "2026-08-22T23:00:00.000Z"
  };
  const applicationDetail = {
    ...midnightApplication,
    createdAt: "2026-08-07T10:00:00.000Z",
    packagePriceCents: 1_750_000,
    payableNowCents: 400_000,
    services: [
      {
        codeSnapshot: "drone",
        nameSnapshot: "Drone Çekimi",
        priceCents: 250_000
      }
    ],
    note: ""
  };
  let lastApplicationUrl = "";
  await page.route("**/api/v1/admin/booking-applications?**", (route) => {
    lastApplicationUrl = route.request().url();
    const isReferenceSearch = new URL(lastApplicationUrl).searchParams.has("referenceCode");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [isReferenceSearch ? approvableApplication : midnightApplication]
      })
    });
  });
  await page.route(`**/api/v1/admin/booking-applications/${midnightApplication.id}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: applicationDetail })
    })
  );
  await page.route(
    `**/api/v1/admin/booking-applications/${approvableApplication.id}/approve`,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            applicationId: approvableApplication.id,
            weddingId: wedding.id,
            username: wedding.customerUser.username,
            activeAt: activationTask.dueAt,
            decisionTaskId,
            activationTaskId: activationTask.id
          }
        })
      })
  );
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
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: defaultPaymentPolicy,
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
          packages: [
            { code: "mini", name: "Mini Paket", priceCents: 2_000_000, isActive: true },
            { code: "hikaye", name: "Hikâye Paketi", priceCents: 3_500_000, isActive: true }
          ],
          services: [
            { code: "baski", name: "Ek Baskı", priceCents: 250_000, isActive: true },
            { code: "drone", name: "Drone Çekimi", priceCents: 500_000, isActive: true }
          ]
        }
      })
    })
  );
  await page.route("**/api/v1/admin/packages", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: "d71c54c4-58df-4c2d-b153-72222dcb0b90",
            code: "mini",
            name: "Mini Paket",
            description: "Katalog görseli hata toleransı",
            imagePath: "assets/images/missing-catalog-image.webp",
            priceCents: 2_000_000,
            isActive: true
          }
        ]
      })
    })
  );
  let packageDeleteAttempts = 0;
  const packageDeleteBodies = [];
  await page.route("**/api/v1/admin/packages/*", async (route) => {
    packageDeleteAttempts += 1;
    packageDeleteBodies.push(route.request().postDataJSON());
    if (await requireAdminStepUp(route)) return;
    adminStepUpActive = false;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { id: "d71c54c4-58df-4c2d-b153-72222dcb0b90", deleted: true }
      })
    });
  });
  await page.route("**/api/v1/admin/services", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    })
  );
  await page.route("**/api/v1/admin/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    })
  );
  let messageRenderAttempts = 0;
  let messageStatus = "PLANNED";
  let messageUpdatedAt = "2026-08-10T10:00:00.000Z";
  await page.route("**/api/v1/admin/message-tasks**", async (route) => {
    const isActivationTask = route.request().url().includes(activationTask.id);
    const isDecisionTask = route.request().url().includes(decisionTaskId);
    if (route.request().url().endsWith("/render")) {
      messageRenderAttempts += 1;
      if (!isDecisionTask && (await requireAdminStepUp(route))) return;
      if (!isActivationTask) adminStepUpActive = false;
      messageStatus = "PREPARED";
      messageUpdatedAt = "2026-08-10T10:01:00.000Z";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            status: messageStatus,
            expectedUpdatedAt: messageUpdatedAt
          }
        })
      });
      return;
    }
    if (route.request().url().endsWith("/override-due")) {
      if (await requireAdminStepUp(route)) return;
      expect(route.request().postDataJSON().reason).toContain("erken aktifleştirildi");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { ...activationTask, earlyOverrideAt: "2026-08-13T10:00:00.000Z" }
        })
      });
      return;
    }
    if (route.request().url().endsWith("/verify")) {
      if (!isDecisionTask && (await requireAdminStepUp(route))) return;
      adminStepUpActive = false;
      messageStatus = "READY_TO_SEND";
      messageUpdatedAt = "2026-08-10T10:02:00.000Z";
      const message = isActivationTask
        ? "Müşteri hesabınız aktifleştirilmiştir.\nKullanıcı adı: yilmaz-demir-4821\nTek kullanımlık parola belirleme bağlantısı: https://example.test/login.html#setup=aktivasyon&purpose=ACCOUNT_ACTIVATION"
        : isDecisionTask
          ? "DA-2026-123456 referanslı başvurunuz onaylandı."
          : "Tek kullanımlık parola bağlantısı: https://example.test/login.html#setup=yalniz-panoda&purpose=PASSWORD_RESET";
      if (isActivationTask) {
        expect(route.request().postDataJSON()).toEqual({ activateCustomerNow: true });
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            status: messageStatus,
            message,
            whatsappUrl: `https://wa.me/905551112233?text=${encodeURIComponent(message)}`,
            customerActivatedEarly: isActivationTask,
            expectedUpdatedAt: messageUpdatedAt
          }
        })
      });
      return;
    }
    if (route.request().url().endsWith("/mark-sent")) {
      messageStatus = "SENT";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { status: messageStatus } })
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: "f930bd2d-222d-4d22-86dc-7487fcd3f150",
            kind: "PASSWORD_RESET",
            status: messageStatus,
            recipientPhone: "+905551112233",
            dueAt: "2026-08-10T10:00:00.000Z",
            updatedAt: messageUpdatedAt,
            wedding: { brideFirstName: "Ayşe", groomFirstName: "Mehmet" },
            sentAt: null
          }
        ]
      })
    });
  });
  let weddingUpdateAttempts = 0;
  await page.route(`**/api/v1/admin/weddings/${wedding.id}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { ...wedding, availableStaff: [], messageTasks: [activationTask] }
        })
      });
      return;
    }
    weddingUpdateAttempts += 1;
    if (await requireAdminStepUp(route)) return;
    adminStepUpActive = false;
    const body = route.request().postDataJSON();
    expect(body.brideLastName).toBe("Kaya");
    expect(body.packageCode).toBe("hikaye");
    expect(body.serviceCodes).toEqual(["drone"]);
    expect(body.paymentTotalCents).toBe(2_400_000);
    expect(body.paymentDepositCents).toBe(300_000);
    expect(body.paymentReceivedCents).toBe(900_000);
    expect(body.note).toContain("Paket değiştirildi: Mini Paket → Hikâye Paketi.");
    expect(body.note).toContain("Ek hizmet çıkarıldı: Ek Baskı.");
    expect(body.note).toContain("Ek hizmet eklendi: Drone Çekimi.");
    expect(body.note).not.toContain("[Paket / hizmet değişikliği]");
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
  await expect(page.locator('.admin-nav [data-panel="overview"]')).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(page.locator('[data-metric="todayWeddings"]')).toHaveText("1");
  await expect(page.locator('[data-panel="weddings"]')).toHaveCount(0);
  await expect(page.locator(".js-connection-text")).toHaveText("Sistem bağlı");
  await expect(page.locator(".js-last-data-time")).toContainText("Son veri");
  await expect(page.getByRole("heading", { name: "Yaklaşan teslimatlar" })).toHaveCount(0);
  await expect(page.locator('.js-staff-form input[name="firstName"]')).toHaveAttribute(
    "maxlength",
    "80"
  );
  await expect(page.locator('.js-manual-form input[name="bridePhone"]')).toHaveAttribute(
    "maxlength",
    "24"
  );
  await expect(page.locator('.js-manual-form textarea[name="note"]')).toHaveAttribute(
    "maxlength",
    "2000"
  );
  await clickPanel(page, "calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Salon takvimi" })).toBeVisible();
  await expect(page.locator('.admin-nav [data-panel="calendar"]')).toHaveAttribute(
    "aria-current",
    "page"
  );
  await page.locator(`[data-open-wedding="${wedding.id}"]`).first().click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Ayşe Yılmaz & Mehmet Demir" })
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toContainText(
    "Aktif düğün arşivlenmeden önce iptal edilmelidir."
  );
  const detailSectionHeadings = await page
    .locator(".js-wedding-detail .detail-grid > .detail-block > h3")
    .allTextContents();
  expect(detailSectionHeadings.indexOf("Personel dağılımı")).toBeLessThan(
    detailSectionHeadings.indexOf("Teslimat")
  );
  if (isMobile) {
    const weddingDialog = page.locator(".js-wedding-detail");
    const weddingSheet = weddingDialog.locator(".sheet-shell");
    const weddingHeading = weddingDialog.locator(".sheet-heading");
    const compactActionButtons = weddingDialog.getByRole("button", {
      name: /Düğün bilgilerini düzenle|Müşteri parolasını sıfırla|Düğünü iptal et/
    });

    expect(await weddingSheet.evaluate((sheet) => sheet.scrollWidth <= sheet.clientWidth)).toBe(
      true
    );
    await expect(weddingDialog.locator(".detail-hero__meta")).toBeHidden();
    expect(
      await compactActionButtons.evaluateAll((buttons) =>
        buttons.every((button) => button.getBoundingClientRect().height <= 52)
      )
    ).toBe(true);
    await weddingSheet.evaluate((sheet) => sheet.scrollTo({ top: 500 }));
    await expect
      .poll(async () => {
        const dialogBox = await weddingDialog.boundingBox();
        const headingBox = await weddingHeading.boundingBox();
        return Math.abs((headingBox?.y ?? 0) - (dialogBox?.y ?? 0));
      })
      .toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "PDF oluştur" }).click();
  await expect(page.locator(".js-wedding-print-report")).toContainText("Düğün operasyon föyü");
  await expect(page.locator(".js-wedding-print-report")).toContainText("Mini Paket");
  await expect(page.locator(".js-wedding-print-report")).toContainText("Cess Wedding");
  await expect(page.locator(".js-wedding-print-report")).toContainText("₺22.500,00");
  await expect(page.locator(".js-wedding-print-report")).toContainText("₺7.500,00");
  await expect(page.locator(".js-wedding-print-report")).toContainText("₺15.000,00");
  expect(await page.evaluate(() => window.__weddingPrintCalls)).toBe(1);
  expect(await page.evaluate(() => window.__weddingPrintTitles)).toEqual([
    "10 ağustos 2026 pazartesi akşam"
  ]);
  const daytimePdfName = await page.evaluate(async () => {
    const { weddingPdfFileName } = await import("/js/shared/wedding-print-report.js");
    return weddingPdfFileName("2026-08-10T14:59:00.000Z");
  });
  expect(daytimePdfName).toBe("10 ağustos 2026 pazartesi gündüz");
  expect(adminStepUpBodies).toHaveLength(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".js-wedding-print-report")).toBeVisible();
  await expect(page.locator(".admin-shell")).toBeHidden();
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByRole("button", { name: "Müşteri MFA'sını sıfırla" })).toHaveCount(0);
  await page.getByRole("button", { name: "Müşteri hesabını aktifleştir" }).click();
  await expect(page.getByRole("heading", { name: "Yönetici doğrulaması" })).toBeVisible();
  expect(await page.evaluate(() => window.__adminWindowOpenUrls)).toEqual([]);
  await completeAdminStepUp(page);
  await expect
    .poll(() => page.evaluate(() => window.__copiedAdminMessages[0]))
    .toContain("Kullanıcı adı: yilmaz-demir-4821");
  await expect
    .poll(() => page.evaluate(() => window.__adminWhatsAppUrls[0]))
    .toContain("purpose%3DACCOUNT_ACTIVATION");
  expect(await page.evaluate(() => window.__adminWindowOpenUrls[0])).toMatch(/^https:\/\/wa\.me\//);
  await expect(page.locator(".global-message")).toContainText("Müşteri hesabı aktifleştirildi");
  await page.getByRole("button", { name: "Düğün bilgilerini düzenle" }).click();
  await expect(page.getByRole("heading", { name: "Bilgileri güncelle" })).toBeVisible();
  if (isMobile) {
    const weddingEditDialog = page.locator(".js-wedding-dialog");
    const weddingEditForm = weddingEditDialog.locator(".js-wedding-form");
    const weddingEditHeading = weddingEditDialog.locator(".sheet-heading");
    const serviceLabels = weddingEditDialog.locator(".js-wedding-services label");
    const paymentFields = weddingEditDialog.locator(".wedding-payment-fields");
    const paymentLabels = paymentFields.locator("label");

    await expect(serviceLabels).toHaveCount(2);
    expect(
      await serviceLabels.evaluateAll((labels) =>
        labels.every((label) => label.scrollWidth <= label.clientWidth)
      )
    ).toBe(true);
    expect(
      await serviceLabels.evaluateAll(
        (labels) =>
          Math.abs(labels[0].getBoundingClientRect().top - labels[1].getBoundingClientRect().top) <=
          1
      )
    ).toBe(true);
    expect(await paymentFields.evaluate((field) => field.scrollWidth <= field.clientWidth)).toBe(
      true
    );
    await expect(paymentLabels).toHaveCount(4);
    expect(
      await paymentLabels.evaluateAll((labels) =>
        labels.every((label) => {
          const input = label.querySelector("input");
          return (
            getComputedStyle(label).display === "grid" &&
            input.getBoundingClientRect().width >= label.getBoundingClientRect().width - 1
          );
        })
      )
    ).toBe(true);
    expect(
      await paymentLabels.evaluateAll(
        (labels) =>
          Math.abs(labels[0].getBoundingClientRect().top - labels[1].getBoundingClientRect().top) <=
            1 &&
          Math.abs(labels[2].getBoundingClientRect().top - labels[3].getBoundingClientRect().top) <=
            1
      )
    ).toBe(true);
    await weddingEditForm.evaluate((form) => form.scrollTo({ top: 500 }));
    await expect
      .poll(async () => {
        const dialogBox = await weddingEditDialog.boundingBox();
        const headingBox = await weddingEditHeading.boundingBox();
        return Math.abs((headingBox?.y ?? 0) - (dialogBox?.y ?? 0));
      })
      .toBeLessThanOrEqual(1);
  }
  await page.locator('.js-wedding-form input[name="brideLastName"]').fill("Kaya");
  await page.locator('.js-wedding-form select[name="packageCode"]').selectOption("hikaye");
  await page.locator('.js-wedding-form input[value="baski"]').uncheck();
  await page.locator('.js-wedding-form input[value="drone"]').check();
  await page.locator('.js-wedding-form input[name="paymentTotal"]').fill("24000");
  await page.locator('.js-wedding-form input[name="paymentReceived"]').fill("9000");
  await expect(page.locator('.js-wedding-form input[name="paymentRemaining"]')).toHaveValue(
    "15000.00"
  );
  await expect(page.locator('.js-wedding-form textarea[name="note"]')).toHaveValue(
    /Ek hizmet eklendi: Drone Çekimi\./
  );
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await completeAdminStepUp(page);
  await expect(page.locator(".global-message")).toContainText("Yeni kullanıcı adı");
  expect(weddingUpdateAttempts).toBe(2);
  await page.locator(".js-wedding-detail [data-close-dialog]").click();
  await clickPanel(page, "applications");
  await expect(page.locator(".application-card")).toContainText("10 Ağu 2026");
  await expect(page.locator(".application-card")).toContainText("00:30");
  await expect(page.locator(".application-card")).toContainText("Bildirim süresi doldu");
  await expect(
    page.locator(".application-card").getByRole("button", { name: "Onayla" })
  ).toHaveCount(0);
  await page.locator(".application-card").getByRole("button", { name: "Detaylar" }).click();
  await expect(page.locator(".js-application-detail-dialog")).toContainText("Drone Çekimi");
  await expect(page.locator(".js-application-detail-dialog")).toContainText("₺2.500");
  await page.locator(".js-application-detail-dialog [data-close-dialog]").click();
  await page.getByLabel("Başvuru referans kodu").fill("DA-2026-123456");
  await page.getByRole("button", { name: "Bul" }).click();
  await expect.poll(() => lastApplicationUrl).toContain("referenceCode=DA-2026-123456");
  await page.locator(".application-card").getByRole("button", { name: "Onayla" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedAdminMessages.at(-1)))
    .toBe("DA-2026-123456 referanslı başvurunuz onaylandı.");
  await expect(page.locator(".global-message")).toContainText("onay mesajı WhatsApp'ta hazırlandı");
  messageStatus = "PLANNED";
  messageUpdatedAt = "2026-08-10T10:00:00.000Z";
  await clickPanel(page, "calendar");
  await expect(page.getByRole("heading", { name: "Ağustos 2026 · Tüm Salonlar" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tüm Salonlar" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.locator(".js-calendar-venues [role=tab]").first()).toHaveText("Tüm Salonlar");
  await expect(page.getByRole("button", { name: /Ayşe & Mehmet/ }).first()).toBeVisible();
  const pastCalendarEvent = page.getByRole("button", { name: /Elif & Can/ });
  const historyToggle = page.getByRole("checkbox", { name: "Geçmiş düğünleri göster" });
  if (isMobile) {
    await expect(pastCalendarEvent).toHaveCount(0);
    await expect(historyToggle).toBeVisible();
    await expect(historyToggle).not.toBeChecked();
    await historyToggle.check();
    await expect(pastCalendarEvent).toBeVisible();
    await historyToggle.uncheck();
    await expect(pastCalendarEvent).toHaveCount(0);
  } else {
    await expect(pastCalendarEvent).toBeVisible();
    await expect(historyToggle).toBeHidden();
  }
  await page.getByRole("button", { name: "Haftalık" }).click();
  await expect(
    page.getByRole("heading", { name: "10–16 Ağustos 2026 · Tüm Salonlar" })
  ).toBeVisible();
  await expect(page.locator(".calendar-day:visible")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "Önceki hafta" })).toBeVisible();
  await page.getByRole("button", { name: "Aylık" }).click();
  await page.getByRole("tab", { name: "Bella Garden" }).click();
  await expect.poll(() => lastCalendarUrl).toContain(`venueId=${secondVenueId}`);
  await expect(page.getByRole("heading", { name: "Ağustos 2026 · Bella Garden" })).toBeVisible();
  await page.getByRole("button", { name: "Önceki ay" }).click();
  await expect.poll(() => lastCalendarUrl).toContain("month=2026-07");
  await expect(page.getByRole("button", { name: /Derya & Bora/ })).toBeVisible();
  await expect(historyToggle).toBeHidden();
  await clickPanel(page, "messages");
  await page.getByRole("button", { name: "Hazırla" }).click();
  await completeAdminStepUp(page);
  await expect(page.getByRole("button", { name: "Linki doğrula" })).toBeVisible();
  await page.getByRole("button", { name: "Linki doğrula" }).click();
  await completeAdminStepUp(page);
  const markSentButton = page.getByRole("button", { name: "Gönderildi işaretle" });
  await expect(markSentButton).toBeDisabled();
  await page.getByRole("button", { name: "WhatsApp'ta gönder" }).click();
  await completeAdminStepUp(page);
  await expect
    .poll(() => page.evaluate(() => window.__copiedAdminMessages.at(-1)))
    .toBe(
      "Tek kullanımlık parola bağlantısı: https://example.test/login.html#setup=yalniz-panoda&purpose=PASSWORD_RESET"
    );
  await expect(markSentButton).toBeEnabled();
  const openedWhatsAppUrl = await page.evaluate(() => window.__adminWhatsAppUrls.at(-1));
  const openedWhatsApp = new URL(openedWhatsAppUrl);
  expect(openedWhatsApp.searchParams.get("text")).toBe(
    "Tek kullanımlık parola bağlantısı: https://example.test/login.html#setup=yalniz-panoda&purpose=PASSWORD_RESET"
  );
  await clickPanel(page, "catalog");
  const catalogImage = page.locator(".js-packages .js-catalog-image");
  await expect(catalogImage).toHaveCount(1);
  expect(await catalogImage.getAttribute("onerror")).toBeNull();
  await expect(catalogImage).toHaveAttribute("src", "assets/images/hero-couple.webp");
  const packageRow = page
    .locator('[data-catalog-type="packages"]')
    .filter({ hasText: "Mini Paket" });
  await packageRow.getByRole("button", { name: "Sil" }).click();
  await page.locator(".js-danger-confirm").fill("Mini Paket");
  await page.locator(".js-danger-reason").fill("Artık sunulmayan katalog paketi kaldırılıyor.");
  await page.locator(".js-danger-submit").click();
  await completeAdminStepUp(page);
  await expect(page.locator(".js-catalog-message")).toContainText("Temel paketi silindi");
  expect(packageDeleteAttempts).toBe(2);
  expect(packageDeleteBodies).toEqual([
    {
      confirmText: "Mini Paket",
      reason: "Artık sunulmayan katalog paketi kaldırılıyor."
    },
    {
      confirmText: "Mini Paket",
      reason: "Artık sunulmayan katalog paketi kaldırılıyor."
    }
  ]);
  expect(messageRenderAttempts).toBe(5);
  expect(adminStepUpBodies).toHaveLength(6);
  expect(adminStepUpBodies).toEqual(
    Array.from({ length: 6 }, () => ({
      currentPassword: "Guvenli-Admin-Step-Up-2026!",
      totpCode: "123456"
    }))
  );
});

test("@frontend-smoke müşteri teslimat paneli linki teslim öncesinde göstermiyor", async ({
  page
}) => {
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

test.describe("İstanbul takvim sözleşmesi", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("@frontend-smoke tarayıcı saat diliminden bağımsız bugün ve gecikme gösterir", async ({
    page
  }) => {
    await page.clock.setFixedTime(new Date("2026-08-12T21:30:00.000Z"));
    await page.goto("/paketini-olustur.html");
    await expect(page.locator(".js-wedding-date")).toHaveAttribute("min", "2026-08-13");

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
            couple: { bride: "Ayşe", groom: "Mehmet" },
            venue: "Cess Wedding",
            startsAt: "2026-08-10T17:00:00.000Z",
            delivery: {
              status: "MONTAJ",
              dueDate: "2026-08-12T00:00:00.000Z",
              releasedAt: null,
              available: false,
              history: []
            }
          }
        })
      })
    );
    await page.goto("/musteri-paneli.html");
    await expect(page.locator(".js-days")).toHaveText("1");
    await expect(page.locator(".js-days-label")).toHaveText("gün gecikti");
  });
});

test("@frontend-smoke müşteri paneli MFA yönetimi göstermez", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          role: "MUSTERI",
          mustChangePassword: false,
          mfaEnabled: false,
          username: "musteri"
        }
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
  await expect(page.locator(".security-section")).toHaveCount(0);
  await expect(page.getByText("İki adımlı doğrulama")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Güvenilen cihazlar" })).toHaveCount(0);
});

test("@frontend-smoke müşteri teslimat penceresini geciken API yanıtından önce güvenli açar", async ({
  page
}) => {
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
  let customerSessionActive = true;
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: customerSessionActive ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(
        customerSessionActive
          ? {
              success: true,
              data: { role: "MUSTERI", mustChangePassword: false, username: "musteri" }
            }
          : { success: false, message: "Oturum geçersiz." }
      )
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
            available: true,
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
  customerSessionActive = false;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page).toHaveURL(/login\.html$/);
});

async function preparePublicBookingForm(page, bookingHandler) {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: { cashDiscountPercent: 20, depositMaximumCents: 3_000 },
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
          packages: [
            {
              code: "mini",
              name: "Mini Paket",
              priceCents: 10_500,
              imagePath: "assets/images/hero-couple.webp"
            }
          ],
          services: [],
          botProtection: { enabled: false, provider: "turnstile", siteKey: null }
        }
      })
    })
  );
  await page.route("**/api/v1/payment-instructions", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { enabled: false, mode: "test" } })
    })
  );
  await page.route("**/api/v1/venues*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        route.request().url().includes("/availability")
          ? { success: true, data: { date: "2027-08-10", hasOccupancy: false } }
          : {
              success: true,
              data: [{ id: "de305d54-75b4-431b-adb2-eb6b9e546014", name: "Cess Wedding" }]
            }
      )
    })
  );
  await page.route("**/api/v1/booking-applications", bookingHandler);
  await page.goto("/paketini-olustur.html");
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
  await form.locator('select[name="venueId"]').selectOption("de305d54-75b4-431b-adb2-eb6b9e546014");
  await selectWeddingDate(page, "2027-08-10");
  await selectWeddingTime(page, "start", "18:00");
  await selectWeddingTime(page, "end", "23:00");
  await form.locator('input[name="privacyConsent"]').check();
  await form.getByRole("button", { name: "Ödemeye Geç" }).click();
}

test("@frontend-smoke public 500 hatası aktif adımda görünür, veriyi korur ve aynı anahtarla tekrar dener", async ({
  page
}) => {
  const requests = [];
  await preparePublicBookingForm(page, async (route) => {
    requests.push({
      idempotencyKey: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON()
    });
    if (requests.length === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          code: "INTERNAL_ERROR",
          message: "Bir hata oluştu.",
          requestId: "request_public_500"
        })
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          id: "4a68ef8c-65df-4899-a560-e4c79b47b455",
          referenceCode: "DA-2026-500001",
          totalPriceCents: 8_400,
          payableNowCents: 8_400,
          paymentFlowExpiresAt: "2027-08-10T20:00:00.000Z",
          whatsappHandoffAt: null
        }
      })
    });
  });

  await page.locator(".js-summary-step").click();
  const status = page.locator(".js-builder-request-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Bilgileriniz korundu");
  await expect(page.locator('input[name="payment-method"][value="cash"]')).toBeChecked();
  await status.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.locator(".js-transfer-reference")).toContainText("DA-2026-500001");
  expect(requests).toHaveLength(2);
  expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey);
  expect(requests[1].body).toEqual(requests[0].body);
});

test("@frontend-smoke public 422 alan hatasını ilgili input yanında gösterir", async ({ page }) => {
  await preparePublicBookingForm(page, (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Girdi doğrulama hatası",
        requestId: "request_public_422",
        fieldErrors: [{ field: "brideFirstName", message: "Ad biçimi geçersiz." }]
      })
    })
  );

  await page.locator(".js-summary-step").click();
  const brideName = page.locator('input[name="brideFirstName"]');
  await expect(brideName).toBeFocused();
  await expect(brideName).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#bride-first-name-error")).toHaveText("Ad biçimi geçersiz.");
});

test("@frontend-smoke hızlı çift gönderim yalnız tek public POST üretir", async ({ page }) => {
  let requestCount = 0;
  await preparePublicBookingForm(page, async (route) => {
    requestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          id: "4a68ef8c-65df-4899-a560-e4c79b47b455",
          referenceCode: "DA-2026-500002",
          packageCodeSnapshot: "mini",
          packageNameSnapshot: "Mini Paket",
          packagePriceCents: 10_500,
          services: [],
          totalPriceCents: 8_400,
          payableNowCents: 8_400,
          paymentFlowExpiresAt: "2027-08-10T20:00:00.000Z",
          whatsappHandoffAt: null
        }
      })
    });
  });

  await page.locator(".js-summary-step").evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.locator('.builder-step[data-step="5"]')).toBeVisible();
  await expect(page.locator('.builder-step[data-step="4"]')).toBeHidden();
  await expect(page.locator(".js-builder-request-status")).toBeHidden();
  await expect(page.locator(".js-payment-notification-status")).toHaveText(
    "Başvurunuz güvenli şekilde hazırlandı."
  );
  await expect(page.locator(".js-transfer-reference")).toContainText("DA-2026-500002");
  expect(requestCount).toBe(1);
});

test("@frontend-smoke katalog fiyatı değişince sunucu snapshot'ını gösterir ve açık onay ister", async ({
  page
}) => {
  await preparePublicBookingForm(page, (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          id: "4a68ef8c-65df-4899-a560-e4c79b47b499",
          referenceCode: "DA-2026-PRICE1",
          packageCodeSnapshot: "mini",
          packageNameSnapshot: "Mini Paket Güncel",
          packagePriceCents: 15_000,
          services: [],
          totalPriceCents: 12_000,
          payableNowCents: 12_000,
          paymentFlowExpiresAt: "2027-08-10T20:00:00.000Z",
          whatsappHandoffAt: null
        }
      })
    })
  );

  await page.locator(".js-summary-step").click();
  const status = page.locator(".js-builder-request-status");
  await expect(status).toContainText("Paket fiyatı siz formu doldururken güncellendi");
  await expect(page.locator(".js-transfer-payable").first()).toContainText("120 TL");
  await status.getByRole("button", { name: "Güncel fiyatı onayla" }).click();
  await expect(status).toBeHidden();
});

for (const scenario of [
  {
    name: "400",
    status: 400,
    headers: {},
    body: { code: "BAD_REQUEST", message: "Başvuru doğrulanamadı." },
    expected: "Başvuru doğrulanamadı"
  },
  {
    name: "409",
    status: 409,
    headers: {},
    body: { code: "VENUE_SCHEDULE_CONFLICT", message: "Salon dolu." },
    expected: "başka bir işlemle çakıştı"
  },
  {
    name: "429",
    status: 429,
    headers: { "Retry-After": "60" },
    body: { code: "RATE_LIMITED", message: "Çok fazla deneme.", retryAfterSeconds: 60 },
    expected: "60 saniye sonra"
  }
]) {
  test(`@frontend-smoke public ${scenario.name} güvenli ve tekrar denenebilir mesaj gösterir`, async ({
    page
  }) => {
    await preparePublicBookingForm(page, (route) =>
      route.fulfill({
        status: scenario.status,
        headers: scenario.headers,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          requestId: `request_${scenario.name}`,
          ...scenario.body
        })
      })
    );
    await page.locator(".js-summary-step").click();
    const status = page.locator(".js-builder-request-status");
    await expect(status).toContainText(scenario.expected);
    await expect(status.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
  });
}

test("@frontend-smoke offline public başvuruda form verisi ve tekrar deneme korunur", async ({
  page
}) => {
  await preparePublicBookingForm(page, (route) => route.abort("internetdisconnected"));
  await page.locator(".js-summary-step").click();
  await expect(page.locator(".js-builder-request-status")).toContainText("Bilgileriniz korundu");
  await expect(page.locator(".js-builder-request-retry")).toBeVisible();
  await expect(page.locator('.builder-step[data-step="5"]')).toBeVisible();
  await page.locator('.builder-step[data-step="5"] .js-edit-details').click();
  await expect(page.locator('input[name="primaryEmail"]')).toHaveValue("ayse@example.com");
});

test("@frontend-smoke Turnstile error ve expired durumları güvenli yeniden hazırlama sunar", async ({
  page
}) => {
  await page.addInitScript(() => {
    window.__turnstileRenderCount = 0;
    window.turnstile = {
      render(_container, options) {
        window.__turnstileOptions = options;
        window.__turnstileRenderCount += 1;
        return window.__turnstileRenderCount;
      },
      remove() {},
      reset() {}
    };
  });
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: defaultPaymentPolicy,
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
          packages: [{ code: "mini", name: "Mini", priceCents: 10_000 }],
          services: [],
          botProtection: {
            enabled: true,
            provider: "turnstile",
            siteKey: "test-site-key",
            action: "booking_application"
          }
        }
      })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"success":true,"data":[]}' })
  );
  await page.goto("/paketini-olustur.html");
  await expect.poll(() => page.evaluate(() => window.__turnstileRenderCount)).toBe(1);
  await page.evaluate(() => window.__turnstileOptions["error-callback"]());
  await expect(page.locator(".js-builder-request-status")).toContainText(
    "Bot doğrulaması tamamlanamadı"
  );
  await page.locator(".js-builder-request-retry").click();
  await expect.poll(() => page.evaluate(() => window.__turnstileRenderCount)).toBe(2);
  await page.evaluate(() => window.__turnstileOptions["expired-callback"]());
  await expect(page.locator(".js-builder-request-status")).toContainText("süresi doldu");
});

test("@frontend-smoke Turnstile script yükleme hatası görünür retry eylemi sunar", async ({
  page
}) => {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort("failed"));
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: defaultPaymentPolicy,
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
          packages: [{ code: "mini", name: "Mini", priceCents: 10_000 }],
          services: [],
          botProtection: {
            enabled: true,
            provider: "turnstile",
            siteKey: "test-site-key",
            action: "booking_application"
          }
        }
      })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"success":true,"data":[]}' })
  );
  await page.goto("/paketini-olustur.html");
  const status = page.locator(".js-builder-request-status");
  await expect(status).toContainText("doğrulama bilgileri alınamadı");
  await expect(status.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
});

test("@frontend-smoke yavaş eski uygunluk yanıtı yeni salon seçimini ezmez", async ({ page }) => {
  let oldResponseCompleted = false;
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: defaultPaymentPolicy,
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
          packages: [{ code: "mini", name: "Mini", priceCents: 10_000 }],
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
        data: [
          { id: "de305d54-75b4-431b-adb2-eb6b9e546014", name: "Yavaş Salon" },
          { id: "de305d54-75b4-431b-adb2-eb6b9e546015", name: "Yeni Salon" }
        ]
      })
    })
  );
  await page.route("**/api/v1/venues/*/availability?*", async (route) => {
    const isOldVenue = route.request().url().includes("de305d54-75b4-431b-adb2-eb6b9e546014");
    if (isOldVenue) await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { date: "2027-08-10", hasOccupancy: isOldVenue }
      })
    });
    if (isOldVenue) oldResponseCompleted = true;
  });
  await page.goto("/paketini-olustur.html");
  await page.locator(".js-next-step").click();
  await page.locator(".js-details-step").click();
  const venue = page.locator('select[name="venueId"]');
  await venue.selectOption("de305d54-75b4-431b-adb2-eb6b9e546014");
  await selectWeddingDate(page, "2027-08-10");
  await venue.selectOption("de305d54-75b4-431b-adb2-eb6b9e546015");
  await expect(page.locator(".js-availability-banner")).toContainText(
    "Seçilen tarihte bu salon için henüz bir düğün/başvuru kaydı bulunmamaktadır."
  );
  await expect.poll(() => oldResponseCompleted).toBe(true);
  await expect(page.locator(".js-availability-banner")).not.toContainText("başka kayıtlar");
});

test("@frontend-smoke referans WhatsApp'tan önce oluşturulur ve yapılandırılmamış alıcıya veri gönderilmez", async ({
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
          paymentPolicy: {
            cashDiscountPercent: 20,
            depositMaximumCents: 3_000
          },
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
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
          data: { date: "2027-08-10", hasOccupancy: false }
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
  await expect(form.locator('input[name="brideFirstName"]')).toHaveAttribute("maxlength", "80");
  await expect(form.locator('input[name="bridePhone"]')).toHaveAttribute("maxlength", "24");
  await expect(form.locator('input[name="primaryEmail"]')).toHaveAttribute("maxlength", "254");
  await expect(form.locator('textarea[name="note"]')).toHaveAttribute("maxlength", "2000");
  await form.locator('input[name="bridePhone"]').fill("+44 (20) 7946-0958");
  await expect(form.locator('input[name="bridePhone"]')).toHaveJSProperty("validationMessage", "");
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

  await expect(page.locator(".js-cash-total")).toHaveText("84 TL");
  await expect(page.locator(".js-cash-discount-copy")).toHaveText("%20 erken ödeme indirimi");
  await page.locator('label.payment-option:has(input[value="deposit"])').click();
  await expect(page.locator(".js-deposit-total")).toHaveText("30 TL");
  await expect(page.locator(".js-payment-assurance-title")).toHaveText("30 TL kapora ödemesi");
  await page.locator('label.payment-option:has(input[value="cash"])').click();
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
  expect(bookingRequest.paymentFlowKey).toBeUndefined();

  const whatsappUrls = await page.evaluate(() => window.__whatsappUrls);
  expect(whatsappUrls).toEqual([]);
  await expect(page.locator(".js-payment-notification-status")).toContainText(
    "WhatsApp alıcısı henüz yapılandırılmadığı için yönlendirme yapılamıyor"
  );
});

test("@frontend-smoke geri yüklenen ödeme akışı WhatsApp geçişini kaydeder ve tamamlanma ekranını açar", async ({
  page
}) => {
  const applicationId = "4a68ef8c-65df-4899-a560-e4c79b47b455";
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
    ({ id }) => {
      window.sessionStorage.setItem("dugunajansim_payment_flow", id);
      window.__whatsappUrls = [];
      window.__copiedPaymentReferences = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            window.__copiedPaymentReferences.push(String(value));
          }
        }
      });
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
    { id: applicationId }
  );
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: defaultPaymentPolicy,
          bookingFormConstraints: defaultBookingFormConstraints,
          bookingSchedulePolicy: defaultBookingSchedulePolicy,
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
          ? { date: "2027-08-10", hasOccupancy: false }
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
  await expect(page.locator(".privacy-note")).toContainText(
    "WhatsApp yönlendirme adresine kişisel bilgileriniz eklenmez"
  );
  await expect(page.locator(".js-transfer-reference")).toContainText("DA-2026-777888");
  await page.locator(".js-complete-with-whatsapp").click();
  await expect
    .poll(() => page.evaluate(() => window.__whatsappUrls[0]))
    .toBe("https://wa.me/905551112233");
  expect(await page.evaluate(() => window.__copiedPaymentReferences)).toEqual(["DA-2026-777888"]);
  expect(
    await page.evaluate(() => window.sessionStorage.getItem("dugunajansim_payment_flow"))
  ).toBeNull();
  await expect(page.locator(".js-booking-completion")).toBeVisible();
  await expect(page.locator(".js-booking-reference")).toHaveText("DA-2026-777888");
  await expect(page.locator(".js-completion-status")).toContainText("yönetici onayına iletildi");
});

test("@frontend-smoke ortak istemci askıda isteği keser ve güvenli anahtar üretir", async ({
  page
}) => {
  await page.goto("/gizlilik-politikasi.html");

  const result = await page.evaluate(async () => {
    const { apiRequest, createIdempotencyKey } = await import(
      `/js/shared/api-client.js?security-regression=${Date.now()}`
    );
    const deterministicKey = createIdempotencyKey({
      getRandomValues(target) {
        target.forEach((_, index) => {
          target[index] = index;
        });
        return target;
      }
    });
    let failedClosed = false;
    try {
      createIdempotencyKey({});
    } catch {
      failedClosed = true;
    }

    const originalFetch = window.fetch;
    let fetchCalls = 0;
    let requestMethod = "";
    window.fetch = (_url, options = {}) => {
      fetchCalls += 1;
      requestMethod = options.method;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("İstek iptal edildi.", "AbortError")),
          { once: true }
        );
      });
    };

    const timeoutResult = await Promise.race([
      apiRequest("/askida-mutation", {
        method: "POST",
        body: { probe: true },
        timeoutMs: 25
      }).then(
        () => ({ outcome: "resolved" }),
        (error) => ({ outcome: "rejected", code: error.code, message: error.message })
      ),
      new Promise((resolve) => window.setTimeout(() => resolve({ outcome: "not-aborted" }), 250))
    ]);
    window.fetch = originalFetch;

    return { deterministicKey, failedClosed, fetchCalls, requestMethod, timeoutResult };
  });

  expect(result.deterministicKey).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  expect(result.failedClosed).toBe(true);
  expect(result.fetchCalls).toBe(1);
  expect(result.requestMethod).toBe("POST");
  expect(result.timeoutResult).toEqual({
    outcome: "rejected",
    code: "REQUEST_TIMEOUT",
    message: "Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin."
  });
});

test("@frontend-smoke @responsive ortak dialog güvenli içerik, erişilebilir ad ve odak dönüşü sağlar", async ({
  page
}) => {
  await page.goto("/gizlilik-politikasi.html");
  await page.evaluate(async () => {
    const { showCustomConfirm } = await import("/js/shared/custom-dialogs.js");
    const opener = document.createElement("button");
    opener.id = "phase05-dialog-opener";
    opener.textContent = "Onayı aç";
    document.body.appendChild(opener);
    opener.focus();
    void showCustomConfirm({
      badge: '<img src="/missing-dialog-badge.png" alt="unsafe">',
      title: "Güvenlik doğrulaması"
    });
  });

  const badge = page.locator(".custom-dialog-badge");
  const dialog = page.locator("#app-custom-dialog");
  await expect(badge).toHaveText('<img src="/missing-dialog-badge.png" alt="unsafe">');
  await expect(badge.locator("img")).toHaveCount(0);
  await expect(dialog).toHaveAccessibleName("Güvenlik doğrulaması");
  await expect(dialog.locator(".js-dialog-submit")).toBeFocused();
  await page.locator(".js-dialog-cancel").first().click();
  await expect(page.locator("#phase05-dialog-opener")).toBeFocused();
});

test("@frontend-smoke zorunlu parola değişim ekranı 15–128 karakter sözleşmesini uygular", async ({
  page
}) => {
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

test("@frontend-smoke tek kullanımlık parola bağlantısı fragmenti temizlenir ve bir kez gönderilir", async ({
  page
}) => {
  const setupToken = "a".repeat(43);
  let submittedBody;
  await page.route("**/api/v1/auth/password/setup", async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { username: "m-guvenlihesap" } })
    });
  });

  await page.goto(`/login.html#setup=${setupToken}&purpose=ACCOUNT_ACTIVATION`);
  await expect(page).toHaveURL(/\/login\.html$/);
  await expect(page.getByLabel("Geçici / mevcut parola")).toBeHidden();
  await page.getByLabel("Yeni parola (15–128 karakter)").fill("Kurulum-Icin-Guvenli-Parola-2026!");
  await page
    .getByLabel("Yeni parola tekrar (15–128 karakter)")
    .fill("Kurulum-Icin-Guvenli-Parola-2026!");
  await page.getByRole("button", { name: "Parolayı Kaydet" }).click();

  await expect
    .poll(() => submittedBody)
    .toEqual({
      token: setupToken,
      purpose: "ACCOUNT_ACTIVATION",
      newPassword: "Kurulum-Icin-Guvenli-Parola-2026!"
    });
  await expect(page.getByLabel("Kullanıcı adı")).toHaveValue("m-guvenlihesap");
  await expect(page.getByText("Parolanız belirlendi. Şimdi giriş yapabilirsiniz.")).toBeVisible();
});

test("@frontend-smoke ayrıcalıklı giriş MFA kodunu yalnız challenge sonrasında gönderir", async ({
  page
}) => {
  const loginBodies = [];
  await page.route("**/api/v1/auth/login", async (route) => {
    const body = route.request().postDataJSON();
    loginBodies.push(body);
    if (!body.totpCode) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "İki adımlı doğrulama kodu gerekli.",
          errors: { code: "MFA_REQUIRED" }
        })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          role: "ADMIN",
          mustChangePassword: false,
          mfaEnabled: true,
          mfaVerified: true,
          mustEnrollMfa: false
        }
      })
    });
  });

  await page.goto("/login.html?mfa-login=1");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("guvenli-admin-parolasi");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page.locator(".mfa-login-field")).toBeVisible();
  await expect(page.locator(".login-form .form-message")).toContainText("doğrulama kodu");

  await page.getByLabel("Bu cihaza 30 gün güven").check();
  await page.locator("#totp-code").fill("123456");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL(/admin\.html$/);
  expect(loginBodies).toHaveLength(2);
  expect(loginBodies[0]).toMatchObject({ trustDevice: false });
  expect(loginBodies[0]).not.toHaveProperty("totpCode");
  expect(loginBodies[1]).toMatchObject({ totpCode: "123456", trustDevice: true });
});

test("@frontend-smoke production enrollment sırrını yalnız kurulum adımında gösterir", async ({
  page
}) => {
  const enrollmentBodies = [];
  const confirmationBodies = [];
  let enrollmentConfirmed = false;
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          role: "ADMIN",
          username: "admin",
          mustChangePassword: false,
          mfaEnabled: enrollmentConfirmed,
          mfaVerified: enrollmentConfirmed,
          mustEnrollMfa: !enrollmentConfirmed
        }
      })
    })
  );
  await page.route("**/api/v1/auth/mfa/enroll", async (route) => {
    enrollmentBodies.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
          otpauthUri:
            "otpauth://totp/D%C3%BC%C4%9F%C3%BCn%20Ajans%C4%B1m%3Aadmin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
        }
      })
    });
  });
  await page.route("**/api/v1/auth/mfa/confirm", async (route) => {
    confirmationBodies.push(route.request().postDataJSON());
    enrollmentConfirmed = true;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { mfaEnabled: true } })
    });
  });

  await page.goto("/login.html?mfa-enrollment=1");
  await expect(page.locator(".mfa-enrollment-form")).toBeVisible();
  await expect(page.locator("#mfa-secret")).toHaveValue("");
  await page.locator("#mfa-current-password").fill("guvenli-admin-parolasi");
  await page.getByRole("button", { name: "Kurulumu Başlat" }).click();
  await expect(page.locator("#mfa-secret")).toHaveValue("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
  await expect(page.locator(".mfa-otpauth-link")).toHaveAttribute("href", /^otpauth:\/\/totp\//);

  await page.locator("#mfa-confirm-code").fill("654321");
  await page.getByRole("button", { name: "Kurulumu Doğrula" }).click();
  await expect(page).toHaveURL(/admin\.html$/);
  expect(enrollmentBodies).toEqual([{ currentPassword: "guvenli-admin-parolasi" }]);
  expect(confirmationBodies).toEqual([
    { currentPassword: "guvenli-admin-parolasi", totpCode: "654321" }
  ]);
});

test("@frontend-smoke oturum acilmis kullanici anasayfada role uygun paneli ve cikis butonunu gorur", async ({
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

test("@frontend-smoke cikis istegi basarisizsa oturum sayfasinda kalir ve uyari gosterir", async ({
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
  await page.route("**/api/v1/auth/logout", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message: "Servis kullanılamıyor." })
    })
  );

  await page.goto("/index.html?logout-test=1");
  if (isMobile) {
    await page.locator("[aria-controls]").first().click();
    await page.locator(".mobile-logout-button").click();
  } else {
    await page.locator(".header-logout").click();
  }

  await expect(page).toHaveURL(/index\.html\?logout-test=1$/);
  await expect(page.getByRole("alert")).toContainText(
    "Çıkış tamamlanamadı. Oturumunuz hâlâ aktif olabilir. Lütfen tekrar deneyin."
  );
});

test("@frontend-smoke basarili cikis giris durumunu sonlandirip ana sayfaya yonlendirir", async ({
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
  await page.route("**/api/v1/auth/logout", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: null })
    })
  );

  await page.goto("/index.html?logout-test=success");
  if (isMobile) {
    await page.locator("[aria-controls]").first().click();
    await page.locator(".mobile-logout-button").click();
  } else {
    await page.locator(".header-logout").click();
  }

  await expect(page).toHaveURL(/\/index\.html$/);
});

test("@frontend-smoke salon sorumlusu coklu salon takvimini ve ortak ekibi tek panelde yonetir", async ({
  page
}) => {
  await page.addInitScript(() => {
    window.__weddingPrintCalls = 0;
    window.print = () => {
      window.__weddingPrintCalls += 1;
    };
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const venueId = "de305d54-75b4-431b-adb2-eb6b9e546014";
  const secondVenueId = "de305d54-75b4-431b-adb2-eb6b9e546015";
  const venues = [
    { id: venueId, name: "Cess Wedding Park" },
    { id: secondVenueId, name: "Cess Wedding Orman" }
  ];
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
    primaryEmail: "ayse.mehmet@example.com",
    startsAt: "2026-08-10T17:00:00.000Z",
    endsAt: "2026-08-10T23:00:00.000Z",
    note: "Giriş çekimi 18.30",
    venue: venues[0],
    packageSummary: { name: "Mini Paket", services: [{ name: "Drone çekimi" }] },
    paymentTotalCents: 2_250_000,
    paymentDepositCents: 300_000,
    paymentReceivedCents: 750_000,
    assignments: []
  };
  const secondWedding = {
    ...wedding,
    id: "6ae9f9e6-6217-4b6c-91ea-251be3bb6fc2",
    brideFirstName: "Zeynep",
    groomFirstName: "Emre",
    venue: venues[1]
  };
  const staff = {
    id: staffId,
    venueId,
    venues,
    firstName: "Cem",
    lastName: "Arslan",
    phone: "+905551110101",
    specialties: ["PHOTOGRAPHY", "DRONE"],
    isActive: true,
    assignments: []
  };
  let assignmentCalls = 0;
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          role: "SALON_YETKILISI",
          mustChangePassword: false,
          username: "cess-sorumlu",
          venueId,
          venueIds: [venueId, secondVenueId]
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
          venue: venues[0],
          venues,
          today: "2026-08-10",
          weekStart: "2026-08-10",
          weekEnd: "2026-08-16",
          metrics: { todayWeddings: 2, weekWeddings: 2, activeStaff: 1, unassignedWeddings: 2 },
          todayWeddings: [wedding, secondWedding],
          weekWeddings: [wedding, secondWedding],
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
          venue: venues[0],
          venues,
          month: "2026-08",
          today: "2026-08-10",
          weddings: [wedding, secondWedding]
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
  await page.route(`**/api/v1/operations/weddings/${wedding.id}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { ...wedding, availableStaff: [staff] }
      })
    })
  );
  await page.route(`**/api/v1/operations/weddings/${wedding.id}/assignments`, (route) => {
    assignmentCalls += 1;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { id: "new-assignment" } })
    });
  });

  await page.goto("/operasyon-paneli.html");
  await expect(page.locator(".js-venue-name").first()).toContainText("Cess Wedding Park");
  await expect(page.locator(".js-venue-name").first()).toContainText("Cess Wedding Orman");
  await expect(page.getByRole("button", { name: /Düğün Planı/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Görüntüle ve personel ata" }).first().click();
  const weddingDialog = page.getByRole("dialog");
  await expect(weddingDialog.getByRole("heading", { name: "Ayşe & Mehmet" })).toBeVisible();
  await expect(weddingDialog).toContainText("Ayşe Yılmaz");
  await expect(weddingDialog).toContainText("Mehmet Demir");
  await expect(weddingDialog).toContainText("ayse.mehmet@example.com");
  await expect(weddingDialog).toContainText("Mini Paket");
  await expect(weddingDialog).toContainText("Drone çekimi");
  await expect(weddingDialog).toContainText("Ödeme detayları");
  await expect(weddingDialog).toContainText("Giriş çekimi 18.30");
  await expect(weddingDialog.locator(".js-schedule-form")).toHaveCount(0);
  await weddingDialog.getByRole("button", { name: "PDF oluştur" }).click();
  await expect(page.locator(".js-wedding-print-report")).toContainText("Ayşe Yılmaz");
  await expect(page.locator(".js-wedding-print-report")).toContainText("Mehmet Demir");
  await expect(page.locator(".js-wedding-print-report")).toContainText("Drone çekimi");
  expect(await page.evaluate(() => window.__weddingPrintCalls)).toBe(1);
  await weddingDialog.locator('[name="staffId"]').selectOption(staffId);
  await weddingDialog.locator('[name="specialty"]').selectOption("PHOTOGRAPHY");
  await weddingDialog.getByRole("button", { name: "Ata" }).click();
  await expect.poll(() => assignmentCalls).toBe(1);
  await page.locator(".js-wedding-dialog [data-close-dialog]").click();
  await clickPanel(page, "calendar", true);
  await expect(page.locator(".calendar-event").first()).toContainText("Ayşe & Mehmet");
  await expect(page.locator(".js-calendar")).toContainText("Cess Wedding Park");
  await expect(page.locator(".js-calendar")).toContainText("Cess Wedding Orman");
  await clickPanel(page, "staff", true);
  await expect(page.locator(".js-staff")).toContainText("Cem Arslan");
  await expect(page.locator(".js-add-staff, [data-edit-staff], [data-toggle-staff]")).toHaveCount(
    0
  );
  expect(pageErrors).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});

test("@frontend-smoke oturum acilmis kullanici login.html sayfasina gittiginde otomatik panele yonlendirilir", async ({
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

test("@frontend-smoke @responsive montajcı durumu yönetip WeTransfer bağlantısını doğrulayarak teslim eder", async ({
  page
}) => {
  const weddingId = "00000000-0000-4000-8000-000000000071";
  const deliveryId = "00000000-0000-4000-8000-000000000072";
  const venueId = "00000000-0000-4000-8000-000000000073";
  let delivered = false;
  let prepareBody = null;
  let deliveryBody = null;
  const wedding = {
    id: weddingId,
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "+90 555 123 45 67",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "+90 555 987 65 43",
    primaryContact: "GELIN",
    primaryEmail: "ayse.mehmet@example.com",
    startsAt: "2026-08-18T17:00:00.000Z",
    endsAt: "2026-08-18T20:00:00.000Z",
    venue: { id: venueId, name: "Cess Wedding" },
    packageSummary: {
      code: "gold",
      name: "Gold Paket",
      services: [{ code: "drone", name: "Drone Çekimi", priceCents: 150000 }]
    },
    paymentTotalCents: 2000000,
    paymentDepositCents: 500000,
    paymentReceivedCents: 750000,
    paymentRemainingCents: 1250000,
    note: "Giriş klibi siyah-beyaz başlayacak.",
    assignments: [
      {
        id: "00000000-0000-4000-8000-000000000074",
        specialty: "VIDEO",
        createdAt: "2026-08-10T09:00:00.000Z",
        staff: {
          id: "00000000-0000-4000-8000-000000000075",
          firstName: "Deniz",
          lastName: "Kamera",
          phone: "+90 555 111 22 33",
          specialties: ["VIDEO"]
        }
      }
    ],
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z"
  };
  const delivery = () => ({
    id: deliveryId,
    status: delivered ? "TESLIM_EDILDI" : "KONTROL",
    dueDate: "2026-09-08T00:00:00.000Z",
    releasedAt: delivered ? "2026-08-14T09:30:00.000Z" : null,
    accessExpiresAt: delivered ? "2026-09-13T09:30:00.000Z" : null,
    updatedAt: "2026-08-14T09:30:00.000Z",
    hasDriveUrl: delivered,
    driveUrl: delivered ? "https://we.tl/t-teslim" : null
  });

  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "MONTAJCI", mustChangePassword: false, username: "montaj-ekibi" }
      })
    })
  );
  await page.route("**/api/v1/montage/calendar**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          month: "2026-08",
          today: "2026-08-14",
          venues: [wedding.venue],
          selectedVenue: null,
          weddings: [{ ...wedding, delivery: delivery() }]
        }
      })
    })
  );
  await page.route(`**/api/v1/montage/weddings/${weddingId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { ...wedding, delivery: delivery() } })
    })
  );
  await page.route(`**/api/v1/montage/deliveries/${deliveryId}`, async (route) => {
    prepareBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { ...delivery(), status: "TESLIME_HAZIR" } })
    });
  });
  await page.route(`**/api/v1/montage/deliveries/${deliveryId}/deliver`, async (route) => {
    deliveryBody = route.request().postDataJSON();
    delivered = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: delivery() })
    });
  });

  await page.goto("/montajci-paneli.html");
  await expect(page.getByRole("heading", { name: /Düğünü bul/i })).toBeVisible();
  const introBox = await page.locator(".montage-intro").boundingBox();
  const calendarBox = await page.locator(".calendar-stage").boundingBox();
  const isMobileViewport = (page.viewportSize()?.width ?? 0) <= 640;
  expect(introBox?.height).toBeLessThan(isMobileViewport ? 230 : 190);
  expect(calendarBox?.y).toBeLessThan(isMobileViewport ? 390 : 400);
  await expect(page.locator(".calendar-event")).toContainText("Ayşe & Mehmet");
  await expect(page.locator(".calendar-event")).toContainText("Kontrol Ediliyor");
  await page.locator(".calendar-event").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Ayşe & Mehmet" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Teslimat yönetimi" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Tüm iş bilgileri" })).toBeVisible();
  await expect(dialog).toContainText("+90 555 123 45 67");
  await expect(dialog).toContainText("Gold Paket");
  await expect(dialog).toContainText("Ödeme");
  await expect(dialog).toContainText("Deniz Kamera");
  await expect(dialog).toContainText("Giriş klibi siyah-beyaz başlayacak.");
  await expect(dialog.locator('input:not([type="checkbox"])')).toHaveCount(1);
  await dialog.getByRole("combobox", { name: "Teslimat durumu" }).selectOption("TESLIME_HAZIR");
  const deliveryPosition = await dialog.locator(".delivery-workbench").boundingBox();
  const informationPosition = await dialog.locator(".wedding-information").boundingBox();
  expect(deliveryPosition?.y).toBeLessThan(informationPosition?.y ?? 0);
  await dialog
    .getByRole("textbox", { name: "Google Drive veya WeTransfer bağlantısı" })
    .fill("https://we.tl/t-teslim");
  await dialog.getByRole("checkbox").check();
  const deliverButton = dialog.getByRole("button", {
    name: "Bağlantıyı doğrula ve teslim et"
  });
  await expect(deliverButton).toBeEnabled();
  await deliverButton.click();
  await expect
    .poll(() => prepareBody)
    .toEqual({
      status: "TESLIME_HAZIR",
      driveUrl: "https://we.tl/t-teslim"
    });
  await expect
    .poll(() => deliveryBody)
    .toEqual({
      sharingConfirmed: true,
      sharingConfirmation: "ERİŞİMİ DOĞRULADIM"
    });
  await expect(dialog).toContainText("Teslim tamamlandı");
  await expect(page.locator(".calendar-event")).toContainText("Teslim Edildi");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator(".calendar-event")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});

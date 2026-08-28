import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const criticalPages = ["/index.html", "/galeri.html", "/login.html", "/paketini-olustur.html"];

for (const pagePath of criticalPages) {
  test(`@frontend-smoke @responsive ${pagePath} temel sözleşmesi`, async ({ page }) => {
    await page.goto(pagePath);

    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.locator("h1:visible")).toHaveCount(1);
    await expect(page).toHaveTitle(/.+/);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(({ impact }) => impact === "critical")).toEqual([]);
  });
}

test("@frontend-smoke @responsive galeri önizlemesi tam galeri sayfasına açılır", async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html#galeri");

  const galleryLink = page.locator("[data-gallery-page-link]");
  const previewItems = page.locator("[data-gallery-preview-item]");
  const mainPreview = page.locator("[data-gallery-preview-main]");
  await expect(previewItems).toHaveCount(8);

  const initialImage = await mainPreview.getAttribute("src");
  await page.getByRole("button", { name: "Sonraki fotoğraf" }).click();
  await expect(mainPreview).not.toHaveAttribute("src", initialImage);

  const imageAfterArrow = await mainPreview.getAttribute("src");
  await page.locator(".gallery-preview__stage").dispatchEvent("pointerdown", {
    pointerId: 1,
    clientX: 300,
    clientY: 300
  });
  await page.locator(".gallery-preview__stage").dispatchEvent("pointerup", {
    pointerId: 1,
    clientX: 100,
    clientY: 305
  });
  await expect(mainPreview).not.toHaveAttribute("src", imageAfterArrow);

  await expect(galleryLink).toHaveAttribute("href", "galeri.html");
  await galleryLink.click();

  await expect(page).toHaveURL(/\/galeri\.html$/);
  await expect(page.getByRole("heading", { level: 1, name: "Düğün Fotoğrafları" })).toBeVisible();
  await expect(page.locator(".gallery-card")).toHaveCount(8);
  await expect(page.locator("[data-gallery-reveal]")).toHaveCount(0);
  await expect(page.locator("[data-gallery-viewport]")).not.toHaveClass(/is-collapsible/);

  await page.getByRole("button", { name: "Kına", exact: true }).click();
  await expect(page.locator(".gallery-card:visible")).toHaveCount(4);
  await page.getByRole("button", { name: "Tümü", exact: true }).click();
  await expect(page.locator(".gallery-card:visible")).toHaveCount(8);
});

test("@frontend-smoke @responsive ana sayfa dinamik kartları kompakt gridde tutar", async ({
  page
}) => {
  const services = Array.from({ length: 8 }, (_, index) => ({
    code: `service-${index + 1}`,
    category: "photo",
    name: `Hizmet ${index + 1}`,
    description: "Düğün gününe özel profesyonel çekim hizmeti.",
    priceCents: 100_000 + index,
    imagePath: "assets/images/services/fotograf-cekimi.webp"
  }));
  const venues = Array.from({ length: 6 }, (_, index) => ({
    slug: index === 5 ? "yesil-nesil-garden" : `mekan-${index + 1}`,
    name: `Mekân ${index + 1}`,
    displayName: index === 5 ? "Yeşil Nesil Garden" : `Mekân ${index + 1}`,
    isFeatured: true,
    imagePath: "assets/images/venues/cess.webp"
  }));

  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { packages: [], services } })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: venues })
    })
  );

  await page.goto("/index.html");
  const serviceCards = page.locator(".service-card");
  await expect(serviceCards).toHaveCount(8);

  const viewportWidth = page.viewportSize()?.width || 1440;
  const expectedColumns = viewportWidth <= 1060 ? 2 : 4;
  const serviceTops = await serviceCards.evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().top))
  );
  expect(new Set(serviceTops.slice(0, expectedColumns)).size).toBe(1);
  expect(serviceTops[expectedColumns]).toBeGreaterThan(serviceTops[0]);

  const venueCards = page.locator(".venue-card");
  await expect(venueCards).toHaveCount(6);
  await expect(venueCards).toHaveText([
    /Mekân 1/,
    /Mekân 2/,
    /Mekân 3/,
    /Mekân 4/,
    /Mekân 5/,
    /Yeşil Nesil Garden/
  ]);
  await expect(venueCards.first().locator(".venue-card__info")).not.toContainText("Mekân 1");
  const venueColumns = viewportWidth <= 780 ? 2 : 3;
  const venuesToggle = page.locator(".js-venues-toggle");
  if (viewportWidth <= 780) {
    await expect(venueCards.nth(3)).toBeVisible();
    await expect(venueCards.nth(4)).toBeHidden();
    await expect(venuesToggle).toBeVisible();
    await venuesToggle.click();
    await expect(venueCards.nth(4)).toBeVisible();
    await expect(venueCards.nth(5)).toBeVisible();

    const firstImage = await venueCards.first().locator(".venue-card__image").boundingBox();
    const firstVenue = await venueCards.first().boundingBox();
    const wideVenue = await venueCards.nth(5).boundingBox();
    expect(firstImage?.height || 0).toBeLessThanOrEqual(220);
    expect(wideVenue?.width || 0).toBeGreaterThan((firstVenue?.width || 0) * 1.8);
  } else {
    await expect(page.locator(".venues-toggle-wrapper")).toBeHidden();
  }

  const venueTops = await venueCards.evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().top))
  );
  expect(new Set(venueTops.slice(0, venueColumns)).size).toBe(1);
  expect(venueTops[venueColumns]).toBeGreaterThan(venueTops[0]);
});

test("@frontend-smoke @responsive paket oluşturucu sunucu ayrıntısını gizler", async ({ page }) => {
  const backendFailure = {
    success: false,
    message: "Invalid prisma.venue.findMany() invocation in C:\\app\\src\\routes\\public.routes.ts"
  };

  for (const endpoint of ["catalog", "venues"]) {
    await page.route(`**/api/v1/${endpoint}`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify(backendFailure)
      })
    );
  }

  await page.goto("/paketini-olustur.html");
  const status = page.locator(".js-builder-request-status");
  await expect(status).toBeVisible();
  await expect(status).not.toContainText(/prisma|public\.routes/i);
});

test("@frontend-smoke @responsive mobil menü açılıp klavyeyle kapanır", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");

  const menuButton = page.locator("[aria-controls]").first();
  await menuButton.click();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
});

test("@frontend-smoke ortak istemci askıda isteği keser ve güvenli anahtar üretir", async ({
  page
}) => {
  await page.goto("/gizlilik-politikasi.html");

  const result = await page.evaluate(async () => {
    const { apiRequest, createIdempotencyKey } = await import("/js/shared/api-client.js");
    const deterministicKey = createIdempotencyKey({
      getRandomValues(target) {
        target.forEach((_, index) => {
          target[index] = index;
        });
        return target;
      }
    });

    const originalFetch = window.fetch;
    window.fetch = (_url, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("İstek iptal edildi.", "AbortError")),
          { once: true }
        );
      });

    try {
      const timeoutResult = await apiRequest("/askida-mutation", {
        method: "POST",
        body: { probe: true },
        timeoutMs: 25
      }).then(
        () => ({ outcome: "resolved" }),
        (error) => ({ outcome: "rejected", code: error.code })
      );
      return { deterministicKey, timeoutResult };
    } finally {
      window.fetch = originalFetch;
    }
  });

  expect(result).toEqual({
    deterministicKey: "00010203-0405-4607-8809-0a0b0c0d0e0f",
    timeoutResult: { outcome: "rejected", code: "REQUEST_TIMEOUT" }
  });
});

test("@frontend-smoke @responsive ortak dialog metni güvenli işler ve odağı geri verir", async ({
  page
}) => {
  await page.goto("/gizlilik-politikasi.html");
  await page.evaluate(async () => {
    const { showCustomConfirm } = await import("/js/shared/custom-dialogs.js");
    const opener = document.createElement("button");
    opener.id = "dialog-opener";
    opener.textContent = "Onayı aç";
    document.body.appendChild(opener);
    opener.focus();
    void showCustomConfirm({
      badge: '<img src="/unsafe.png" alt="unsafe">',
      title: "Güvenlik doğrulaması"
    });
  });

  const dialog = page.locator("#app-custom-dialog");
  await expect(dialog).toHaveAccessibleName("Güvenlik doğrulaması");
  await expect(dialog.locator(".custom-dialog-badge img")).toHaveCount(0);
  await page.locator(".js-dialog-cancel").first().click();
  await expect(page.locator("#dialog-opener")).toBeFocused();
});

test("@frontend-smoke aktif oturum login sayfasından doğru panele yönlenir", async ({ page }) => {
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
  await expect(page).toHaveURL(/musteri-paneli\.html$/);
});

import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const criticalPages = ["/index.html", "/login.html", "/paketini-olustur.html"];

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

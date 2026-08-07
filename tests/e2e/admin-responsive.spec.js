import { expect, test } from "@playwright/test";

const dashboard = {
  today: "2026-08-10",
  weekStart: "2026-08-10",
  weekEnd: "2026-08-16",
  availabilityDate: "2026-08-10",
  metrics: { pendingBookings: 0, pendingMessages: 0, readyDeliveries: 0, todayWeddings: 0 },
  todayWeddings: [],
  tomorrowWeddings: [],
  weekWeddings: [],
  idleStaff: [],
  venues: [],
  staffAvailability: [],
  distribution: {},
  conflicts: [],
  upcomingDeliveries: []
};

async function expectNoPageOverflow(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    )
    .toBe(true);
}

async function expectMinimumHeight(locator, minimum = 44) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(minimum - 0.01);
}

test("admin paneli 320px ekranda taşmadan ve dokunma hedeflerini koruyarak çalışır", async ({
  page
}) => {
  let venueCreateBody = null;
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "ADMIN", mustChangePassword: false, username: "admin" }
      })
    })
  );
  await page.route("**/api/v1/admin/dashboard**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: dashboard })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    })
  );
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { packages: [], services: [] } })
    })
  );
  await page.route(/\/api\/v1\/admin\/(packages|services|venues)$/, async (route) => {
    if (route.request().method() === "POST") {
      venueCreateBody = route.request().postDataJSON();
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    });
  });

  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "Günün akışı" })).toBeVisible();
  await expectNoPageOverflow(page);
  await expectMinimumHeight(page.getByRole("button", { name: "Yeni düğün" }), 48);
  await expectMinimumHeight(page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }));

  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await expectMinimumHeight(page.getByRole("button", { name: /Menüyü Kapat/i }));
  await expectMinimumHeight(page.locator('.admin-nav [data-panel="overview"]'));
  await page.getByRole("button", { name: /Menüyü Kapat/i }).click();

  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await page.locator('[data-panel="plan"]').click();
  await expect(page.locator('[data-panel-content="plan"]')).toBeVisible();
  await expectNoPageOverflow(page);
  for (const button of await page.locator(".plan-heading .plan-controls button").all()) {
    await expectMinimumHeight(button);
  }

  await page.getByRole("button", { name: "Yeni düğün" }).click();
  const dialog = page.locator(".js-manual-dialog");
  await expect(dialog).toBeVisible();
  await expectMinimumHeight(dialog.getByRole("button", { name: "Kapat" }));
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  expect(
    await dialog
      .locator(".form-grid")
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true);
  for (const button of await dialog.locator(".dialog-actions button").all()) {
    await expectMinimumHeight(button);
  }

  await dialog.getByRole("button", { name: "Kapat" }).click();
  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await page.locator('[data-panel="catalog"]').click();
  await expect(page.locator('[data-panel-content="catalog"]')).toBeVisible();
  await page.locator('[data-add-catalog="packages"]').click();
  const catalogDialog = page.locator(".custom-modal-dialog");
  await expect(catalogDialog).toBeVisible();
  await expectMinimumHeight(catalogDialog.getByRole("button", { name: "Kapat" }));
  expect(
    await catalogDialog.locator(".custom-catalog-grid").evaluate((element) => ({
      fits: element.scrollWidth <= element.clientWidth,
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length
    }))
  ).toEqual({ fits: true, columns: 1 });
  await catalogDialog.getByRole("button", { name: "Kapat" }).click();
  await page.locator('[data-add-catalog="venues"]').click();
  await expect(catalogDialog.getByRole("heading", { name: "Yeni Mekân Oluştur" })).toBeVisible();
  await expect(catalogDialog.locator(".js-venue-display-name")).toBeVisible();
  await expect(catalogDialog.locator(".js-venue-image")).toBeVisible();
  await expect(catalogDialog.locator(".js-venue-display-order")).toBeVisible();
  await catalogDialog.locator(".js-venue-slug").fill("responsive-garden");
  await catalogDialog.locator(".js-venue-name").fill("Responsive Garden");
  await catalogDialog.locator(".js-venue-display-name").fill("Responsive");
  await catalogDialog.locator(".js-venue-image").fill("assets/images/venues/rena.webp");
  await catalogDialog.locator(".js-venue-display-order").fill("8");
  await catalogDialog.locator(".js-venue-featured").check();
  await catalogDialog.getByRole("button", { name: "Mekân Oluştur" }).click();
  await expect
    .poll(() => venueCreateBody)
    .toEqual({
      slug: "responsive-garden",
      name: "Responsive Garden",
      displayName: "Responsive",
      imagePath: "assets/images/venues/rena.webp",
      displayOrder: 8,
      isFeatured: true,
      isPartner: true,
      isActive: true
    });

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    await expectNoPageOverflow(page);
    await expectMinimumHeight(page.getByRole("button", { name: "Yeni düğün" }));
  }
});

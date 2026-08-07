import { expect, test } from "@playwright/test";

const expectedSectionOrder = [
  "#anasayfa",
  "#hakkimizda",
  "#konseptler",
  "#galeri",
  "#cekimler",
  "#hizmetler",
  "#paket-olustur",
  "#mekanlar",
  "#sss",
  "#iletisim"
];

test("@responsive mobil navigasyon sayfa bolumlerini dogru sirada listeler", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");
  await page.locator(".menu-toggle").click();

  const mobileSectionOrder = await page
    .locator(".mobile-menu nav a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));

  expect(mobileSectionOrder).toEqual(expectedSectionOrder);
});

test("@responsive masaustu ve mobil navigasyon ayni bolumleri ayni sirada kullanir", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");

  const [desktopSectionOrder, mobileSectionOrder] = await Promise.all([
    page
      .locator(".desktop-nav a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
    page
      .locator(".mobile-menu nav a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")))
  ]);

  expect(desktopSectionOrder).toEqual(expectedSectionOrder);
  expect(mobileSectionOrder).toEqual(expectedSectionOrder);
});

test("@responsive masaustu header klasik tam genislikte ve tek satirda kalir", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"success":false}' })
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");

  const headerBox = await page.locator(".site-header").boundingBox();
  const brandBox = await page.locator(".brand").boundingBox();
  const navigationBox = await page.locator(".desktop-nav").boundingBox();
  const actionsBox = await page.locator(".header-actions").boundingBox();

  expect(headerBox).not.toBeNull();
  expect(brandBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(headerBox.x).toBe(0);
  expect(headerBox.width).toBe(1440);
  expect(brandBox.y + brandBox.height / 2).toBeCloseTo(
    navigationBox.y + navigationBox.height / 2,
    0
  );
  expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(navigationBox.x);
  expect(navigationBox.x + navigationBox.width).toBeLessThanOrEqual(actionsBox.x + 2);
});

test("@responsive masaustu navigasyon tiklamasi tek bir kaydirma baslatir", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");
  await page.evaluate(() => {
    const originalScrollTo = window.scrollTo.bind(window);
    window.__navigationScrollCalls = [];
    window.scrollTo = (...args) => {
      window.__navigationScrollCalls.push(args);
      originalScrollTo(...args);
    };
  });

  await page.locator('.desktop-nav a[href="#hizmetler"]').click();
  await page.waitForTimeout(1500);

  expect(await page.evaluate(() => window.__navigationScrollCalls)).toHaveLength(1);
});

test("@responsive scroll konumu masaustu navigasyonunun ust basligini gunceller", async ({
  page
}) => {
  await page.goto("/index.html");

  await page.locator("#cekimler").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document.querySelector('.desktop-nav a[href="#cekimler"]')?.matches(".is-active")
  );
  await expect(page.locator('.desktop-nav a[href="#cekimler"]')).toHaveAttribute(
    "aria-current",
    "location"
  );

  await page.locator("#mekanlar").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document.querySelector('.desktop-nav a[href="#mekanlar"]')?.matches(".is-active")
  );
  await expect(page.locator('.desktop-nav a[href="#mekanlar"]')).toHaveAttribute(
    "aria-current",
    "location"
  );
});

test("@responsive pazarlama metinleri doğrulanmamış iddialar içermez ve copyright yılı günceldir", async ({
  page
}) => {
  await page.goto("/index.html");

  await expect(page).toHaveTitle("Düğünajansım | Düğün Fotoğrafı ve Video Prodüksiyonu");
  await expect(page.locator(".proof-pill")).toContainText("Fotoğraf");
  await expect(page.locator(".proof-pill")).toContainText("Sinematik Film");
  await expect(page.locator(".site-footer__bottom [data-current-year]")).toHaveText(
    String(new Date().getFullYear())
  );
  await expect(page.locator("body")).not.toContainText(/70\+|1500\+|2018’den beri|2027 itibarıyla/);

  await page.goto("/paketini-olustur.html");
  await expect(page.locator(".showcase-footer [data-current-year]")).toHaveText(
    String(new Date().getFullYear())
  );
});

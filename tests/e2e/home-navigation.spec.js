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

test("mobil navigasyon sayfa bolumlerini dogru sirada listeler", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");
  await page.locator(".menu-toggle").click();

  const mobileSectionOrder = await page
    .locator(".mobile-menu nav a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));

  expect(mobileSectionOrder).toEqual(expectedSectionOrder);
});

test("masaustu ve mobil navigasyon ayni bolumleri ayni sirada kullanir", async ({ page }) => {
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

test("masaustu header sayfadan ayrisan navigasyon seridi kullanir", async ({ page }) => {
  await page.setViewportSize({ width: 1220, height: 800 });
  await page.goto("/index.html");

  const headerBox = await page.locator(".site-header").boundingBox();
  expect(headerBox?.x).toBeGreaterThan(0);
  expect(headerBox?.y).toBeGreaterThan(0);
  expect(headerBox?.width).toBeLessThan(1220);

  const activeLink = page.locator('.desktop-nav a[href="#anasayfa"]');
  await expect(activeLink).toBeVisible();
  await expect(activeLink).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(activeLink).toHaveAttribute("aria-current", "location");
  await expect(page.locator(".header-cta")).toHaveCSS("white-space", "nowrap");
});

test("scroll konumu masaustu navigasyonunun ust basligini gunceller", async ({ page }) => {
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

test("pazarlama metinleri doğrulanmamış iddialar içermez ve copyright yılı günceldir", async ({
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

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
    document.querySelector('.desktop-nav a[href="#galeri"]')?.matches(".is-active")
  );
  await expect(page.locator('.desktop-nav a[href="#galeri"]')).toHaveAttribute(
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

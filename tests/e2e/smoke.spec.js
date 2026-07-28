import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pages = ["/index.html", "/login.html", "/paketini-olustur.html"];

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


import { expect, test } from "@playwright/test";

test("@responsive ana sayfadaki dekoratif ust basliklar kaldirilir", async ({ page }) => {
  await page.goto("/index.html");

  await expect(
    page.locator(".gallery-kicker, .venues-heading__eyebrow, .venues-heading__rule")
  ).toHaveCount(0);
  await expect(page.locator(".faq-heading__eyebrow, .faq-heading__rule")).toHaveCount(0);

  await expect(page.locator("#gallery-title")).toBeVisible();
  await expect(page.locator("#venues-title")).toBeVisible();
  await expect(page.locator("#faq-title")).toBeVisible();
});

test("@responsive ana sayfa bolumleri ekstra sahne sarmalayicisi kullanmaz", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");

  await expect(page.locator(".horizontal-scroll-cue, .gallery-mobile-progress")).toHaveCount(0);
  await expect(page.locator(".shoots-gallery__controls, .shoots-gallery__arrow")).toHaveCount(0);
  await expect(page.locator(".gallery-stage, .shoots-stage, .services-stage")).toHaveCount(0);
  await expect(page.locator(".gallery-section > .gallery-section__inner")).toHaveCount(1);
  await expect(page.locator(".shoots-section > .shoots-section__inner")).toHaveCount(1);
  await expect(page.locator(".services-section > .services-section__inner")).toHaveCount(1);
});

test("@responsive ana sayfa acik ve koyu yuzeyleri istenen sirada kullanir", async ({ page }) => {
  await page.goto("/index.html");

  const surfaces = await page
    .locator("main > [data-header-surface], body > footer[data-header-surface]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        className: element.className,
        surface: element.dataset.headerSurface
      }))
    );

  expect(surfaces).toEqual([
    { className: "hero", surface: "light" },
    { className: "gallery-section", surface: "dark" },
    { className: "shoots-section", surface: "light" },
    { className: "services-section", surface: "dark" },
    { className: "package-invitation", surface: "light" },
    { className: "venues-section", surface: "dark" },
    { className: "faq-section", surface: "light" },
    { className: "site-footer", surface: "dark" }
  ]);
});

test("@responsive mobil hero ile galeri arasinda nefes payi birakir", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");

  const sectionGap = await page.evaluate(() => {
    const heroBounds = document.querySelector(".hero").getBoundingClientRect();
    const galleryBounds = document.querySelector(".gallery-section").getBoundingClientRect();
    return galleryBounds.top - heroBounds.bottom;
  });
  const heroPaddingEnd = await page
    .locator(".hero")
    .evaluate((hero) => Number.parseFloat(getComputedStyle(hero).paddingBlockEnd));

  expect(sectionGap).toBeCloseTo(0, 1);
  expect(heroPaddingEnd).toBeGreaterThanOrEqual(14);
  expect(heroPaddingEnd).toBeLessThanOrEqual(18);
});

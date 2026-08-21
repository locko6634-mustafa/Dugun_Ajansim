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

test("@responsive fotoğraf ve film alanları yatay kaydırma yönlendirmesi kullanmaz", async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");

  await expect(page.locator(".horizontal-scroll-cue, .gallery-mobile-progress")).toHaveCount(0);
  await expect(page.locator(".shoots-gallery__controls, .shoots-gallery__arrow")).toHaveCount(0);
  await expect(page.locator(".gallery-stage--dark, .services-stage--dark")).toHaveCount(2);
  await expect(page.locator(".shoots-stage--light")).toHaveCount(1);
});

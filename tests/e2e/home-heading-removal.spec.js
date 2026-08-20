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

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

test("@responsive yatay galeriler mobilde devam yonlendirmesini gosterir", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");

  const cues = page.locator(".horizontal-scroll-cue");

  await expect(cues).toHaveCount(2);
  await expect(cues).toHaveText(["Yana kaydır", "Yana kaydır"]);
  await expect(cues.first().locator("svg")).toBeVisible();
  await expect(cues.last().locator("svg")).toBeVisible();
});

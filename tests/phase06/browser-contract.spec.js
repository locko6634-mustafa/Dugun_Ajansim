import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./browser-gate.js";

test.use({
  browserGateAllowedHttp: ["401 GET /api/v1/auth/session"],
  browserGateAllowedErrors: ["Failed to load resource:.*status of 401"],
  browserGateAllowedPendingHosts: ["challenges.cloudflare.com"]
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("@phase06 browser sözleşmesi ve moderate+ erişilebilirlik kapısı", async ({ page }) => {
  for (const path of ["/index.html", "/login.html", "/paketini-olustur.html"]) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((violation) =>
        ["critical", "serious", "moderate"].includes(violation.impact || "")
      );
      expect.soft(blocking, `${path} axe moderate+ ihlalleri`).toEqual([]);
      expect
        .soft(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
          ),
          `${path} yatay taşma`
        )
        .toBe(true);
    });
  }
});

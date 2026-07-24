import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const TARGET_URL = "http://localhost:8000/index.html";

test("E2E Duman Testi (Smoke Test): Sayfa yüklenmesi ve temel etkileşimler", async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    t.skip("Playwright tarayıcısı başlatılamadı: " + err.message);
    return;
  }

  const page = await browser.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 5000 });
  } catch (err) {
    await browser.close();
    t.skip(`http://localhost:8000 adresine erişilemedi. Lütfen sunucuyu run_server.bat ile başlatın. Hata: ${err.message}`);
    return;
  }

  await t.test("Sayfa başlığı ve ana öğeler yüklenir", async () => {
    const title = await page.title();
    assert.match(title, /DüğünAjansım/);

    const headerVisible = await page.isVisible("#site-header");
    assert.strictEqual(headerVisible, true, "Site başlık alanı (#site-header) görünür olmalıdır.");

    const mainVisible = await page.isVisible("#main-content");
    assert.strictEqual(mainVisible, true, "Ana içerik alanı (#main-content) görünür olmalıdır.");
  });

  await t.test("Mobil menü açma/kapatma tetikleyicisi çalışır", async () => {
    await page.setViewportSize({ width: 375, height: 812 });

    const menuToggle = page.locator("#menu-toggle");
    if (await menuToggle.isVisible()) {
      const initialExpanded = await menuToggle.getAttribute("aria-expanded");
      assert.strictEqual(initialExpanded, "false");

      await menuToggle.click();
      const newExpanded = await menuToggle.getAttribute("aria-expanded");
      assert.strictEqual(newExpanded, "true");
    }
  });

  await t.test("WhatsApp CTA butonuna tıklamak demo toast bildirimini açar", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const ctaButton = page.locator("[data-whatsapp]").first();
    if (await ctaButton.isVisible()) {
      await ctaButton.click();

      const toast = page.locator("#demo-toast");
      const isHidden = await toast.getAttribute("hidden");
      assert.strictEqual(isHidden, null, "Toast bildirimi hidden özniteliğini kaldırmalıdır.");
    }
  });

  await browser.close();
});

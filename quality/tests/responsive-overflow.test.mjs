import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VIEWPORTS = [280, 320, 360, 375, 390, 640, 768, 960, 1024, 1120, 1280, 1440, 1920];
const TARGET_URL = "http://localhost:8000/index.html";
const SCREENSHOT_DIR = "quality/tests/screenshots";
const REPORT_PATH = "quality/tests/overflow-report.json";

test("Duyarlı tasarım yatay taşma ve ekran görüntüsü doğrulama testi", async (t) => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    t.skip("Playwright tarayıcısı başlatılamadı (Sunucu kapalı veya Playwright eksik olabilir): " + err.message);
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const overflowResults = [];

  // Sunucunun erişilebilir olup olmadığını basitçe sına
  try {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 5000 });
  } catch (err) {
    await browser.close();
    t.skip(`http://localhost:8000 adresine erişilemedi. Lütfen sunucuyu run_server.bat ile başlatın. Hata: ${err.message}`);
    return;
  }

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 10000 });

    const overflow = await page.evaluate(() => {
      const documentWidth = document.documentElement.scrollWidth;
      const viewportWidth = window.innerWidth;
      return {
        hasOverflow: documentWidth > viewportWidth,
        scrollWidth: documentWidth,
        clientWidth: viewportWidth
      };
    });

    const filename = `index_${width}.png`;
    const localPath = join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: localPath });

    if (overflow.hasOverflow) {
      overflowResults.push({
        page: "index",
        viewport: width,
        scrollWidth: overflow.scrollWidth,
        clientWidth: overflow.clientWidth,
        diff: overflow.scrollWidth - overflow.clientWidth
      });
    }

    assert.strictEqual(
      overflow.hasOverflow,
      false,
      `${width}px genişliğinde yatay taşma (overflow) tespit edildi! (Scroll: ${overflow.scrollWidth}px, Viewport: ${overflow.clientWidth}px)`
    );
  }

  await browser.close();
  await writeFile(REPORT_PATH, JSON.stringify(overflowResults, null, 2), "utf8");
});

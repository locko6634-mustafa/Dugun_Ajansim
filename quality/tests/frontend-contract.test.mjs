import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("index.html semantik ve SEO üst veri sözleşmesini karşılar", async () => {
  const html = await read("index.html");

  assert.match(html, /<html\s+lang=["']tr["']>/, "Sayfa dili tr olmalıdır.");
  assert.match(html, /<title>[^<]*DüğünAjansım[^<]*<\/title>/, "Sayfa başlığında DüğünAjansım bulunmalıdır.");
  assert.match(html, /name=["']description["']/, "Meta description bulunmalıdır.");
  assert.match(html, /property=["']og:title["']/, "Open Graph başlığı bulunmalıdır.");
  assert.match(html, /name=["']twitter:card["']/, "Twitter kartı bulunmalıdır.");
  assert.match(html, /fonts\.googleapis\.com/, "Google Fonts bağlantısı bulunmalıdır.");
  assert.match(html, /vendor\/gsap\.min\.js/, "GSAP kütüphanesi yerel yüklenmelidir.");
  assert.match(html, /vendor\/ScrollTrigger\.min\.js/, "ScrollTrigger kütüphanesi yerel yüklenmelidir.");
  assert.match(html, /js\/app\.js/, "app.js script bağlantısı bulunmalıdır.");
});

test("index.html kritik DOM bileşen ID sözleşmesini korur", async () => {
  const html = await read("index.html");
  const requiredIds = [
    "site-header",
    "menu-toggle",
    "site-nav",
    "scroll-progress-bar",
    "main-content",
    "hero-title",
    "hikayeler",
    "hizmetler",
    "surec",
    "paketler",
    "sss",
    "mobile-cta",
    "lightbox-dialog",
    "demo-toast"
  ];

  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `index.html içinde #${id} bileşeni bulunmalıdır.`);
  }
});

test("css/styles.css tasarım sistemi ve erişilebilirlik kurallarını barındırır", async () => {
  const css = await read("css/styles.css");

  assert.match(css, /--ivory:/, "CSS custom properties (renk değişkenleri) tanımlı olmalıdır.");
  assert.match(css, /--blush:/, "Blush renk değişkeni bulunmalıdır.");
  assert.match(css, /--wine:/, "Wine renk değişkeni bulunmalıdır.");
  assert.match(css, /hsl\(/, "HSL renk formatı kullanılmalıdır.");
  assert.match(css, /Gloock/i, "Gloock font ailesi CSS içinde tanımlı olmalıdır.");
  assert.match(css, /Instrument Sans/i, "Instrument Sans font ailesi CSS içinde tanımlı olmalıdır.");
  assert.match(css, /prefers-reduced-motion:\s*reduce/i, "Erişilebilirlik için reduced motion medya sorgusu bulunmalıdır.");
  assert.match(css, /@media/i, "Duyarlı tasarım için medya sorguları bulunmalıdır.");
});

test("Görsel öğeler modern formatlar (AVIF/WebP) ve performans özniteliklerini kullanır", async () => {
  const html = await read("index.html");

  assert.match(html, /\.avif["']/, "AVIF görsel kaynakları desteklenmelidir.");
  assert.match(html, /\.webp["']/, "WebP görsel kaynakları desteklenmelidir.");
  assert.match(html, /loading=["']lazy["']|fetchpriority=["']high["']/, "Performans odaklı görsel yükleme stratejileri bulunmalıdır.");
});

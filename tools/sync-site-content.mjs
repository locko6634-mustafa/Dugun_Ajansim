import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { format, resolveConfig } from "prettier";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = JSON.parse(
  await readFile(path.join(rootDirectory, "content", "site-content.json"), "utf8")
);
const checkOnly = process.argv.includes("--check");
const failures = [];
const prettierConfig = (await resolveConfig(path.join(rootDirectory, "index.html"))) ?? {};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`${label} alanı bulunamadı`);
  }
  return source.replace(pattern, replacement);
}

function replaceGeneratedBlock(source, key, body) {
  const start = `<!-- site-content:${key}:start -->`;
  const end = `<!-- site-content:${key}:end -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, "u");
  return replaceRequired(source, pattern, `${start}\n${body}\n${end}`, key);
}

function renderSeo(page) {
  const organization = page.organizationDescription
    ? `\n    <script type="application/ld+json">\n      ${JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: content.brand.name,
          description: page.organizationDescription,
          logo: page.logoUrl,
          url: page.canonicalUrl
        },
        null,
        2
      ).replaceAll("\n", "\n      ")}\n    </script>`
    : "";

  return `    <meta name="description" content="${escapeHtml(page.description)}" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="theme-color" content="#f7f3ed" />
    <link rel="canonical" href="${escapeHtml(page.canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="${escapeHtml(content.brand.name)}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.socialDescription)}" />
    <meta property="og:url" content="${escapeHtml(page.canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(page.imageUrl)}" />
    <meta property="og:image:alt" content="${escapeHtml(page.imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.socialDescription)}" />
    <meta name="twitter:image" content="${escapeHtml(page.imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(page.imageAlt)}" />${organization}`;
}

const iconPaths = {
  location:
    '<path d="M16 29S6 20 6 12a10 10 0 0 1 20 0c0 8-10 17-10 17Z" /><circle cx="16" cy="12" r="3" />',
  dress: '<path d="M12 3c1 3 2 4 4 5 2-1 3-2 4-5l2 7-3 3 4 15H9l4-15-3-3 2-7Z" />',
  venue:
    '<path d="M3 24h26M6 24V11m20 13V11M4 11h24M8 11l2-5h12l2 5M9 14v7m14-7v7M13 14v7m6-7v7" />',
  delivery:
    '<path d="M5 27V12l6-6 5 5 5-6 6 7v15H5Z" /><path d="M10 27v-7h5v7M9 14h2m5 0h2m5 0h1m-8 5h2m5 0h1" />',
  calendar:
    '<path d="M8 3v5M24 3v5M4 12h24M6 6h20a2 2 0 0 1 2 2v19H4V8a2 2 0 0 1 2-2Z" /><path d="M9 17h3M15 17h3M21 17h3M9 22h3M15 22h3" />',
  clock: '<circle cx="16" cy="16" r="12" /><path d="M16 8v9l6 4" />',
  camera: '<path d="M4 10h6l2-4h8l2 4h6v17H4V10Z" /><circle cx="16" cy="18" r="5" />'
};

function renderFaqHeading() {
  const faq = content.home.faq;
  return `          <header class="faq-heading">
            <h2 id="faq-title">${escapeHtml(faq.title)}<br /><em>${escapeHtml(faq.titleEmphasis)}</em></h2>
            <p>${escapeHtml(faq.description)}</p>
          </header>`;
}

function renderServicesPlaceholder() {
  return `          <div class="services-grid" aria-live="polite">
            <p class="services-empty">Hizmet kataloğu yükleniyor…</p>
          </div>`;
}

function renderFaqItems() {
  return content.home.faq.items
    .map((item, index) => {
      const number = index + 1;
      const decoration =
        item.decoration === "branch"
          ? `\n                <svg class="faq-answer__branch" viewBox="0 0 150 95" aria-hidden="true">\n                  <path d="M5 91C43 72 78 44 111 5M62 55c-2-17 5-30 20-38 3 17-4 30-20 38ZM84 37c5-14 16-23 31-25-2 15-12 23-31 25ZM43 70c-15-2-27 4-35 17 15 3 27-3 35-17ZM86 55c15-4 28 1 37 13-15 5-28 1-37-13Z" />\n                </svg>`
          : "";
      const icon = iconPaths[item.icon];
      if (!icon) throw new Error(`Bilinmeyen FAQ ikonu: ${item.icon}`);

      return `            <article class="faq-item">
              <h3>
                <button class="faq-question" type="button" aria-expanded="false" aria-controls="faq-answer-${number}">
                  <span class="faq-item__icon" aria-hidden="true"><svg viewBox="0 0 32 32">${icon}</svg></span>
                  <span>${number}. ${escapeHtml(item.question)}</span>
                  <span class="faq-toggle" aria-hidden="true"></span>
                </button>
              </h3>
              <div class="faq-answer" id="faq-answer-${number}" hidden>
                <p>${escapeHtml(item.answer)}</p>${decoration}
              </div>
            </article>`;
    })
    .join("\n\n");
}

function renderFooterTop() {
  const footer = content.home.footer;
  const navigation = footer.navigation
    .map(
      (group) => `            <div class="footer-links">
              <p class="footer-links__title">${escapeHtml(group.title)}</p>
${group.links.map((link) => `              <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("\n")}
            </div>`
    )
    .join("\n");

  return `          <div class="site-footer__brand">
            <a class="footer-brand" href="#anasayfa" aria-label="${escapeHtml(content.brand.name)} ana sayfa">
              <svg class="footer-brand__mark" viewBox="0 0 64 64" aria-hidden="true">
                <path d="M11 7h19c16 0 27 10 27 25S46 57 30 57H11V7Z" />
                <path d="M19 28 31 16l12 12a7 7 0 0 1 0 10L31 50 19 38a7 7 0 0 1 0-10Z" />
                <path d="m25 30 6-6 7 7a3 3 0 0 1 0 4l-7 7-6-6a4 4 0 0 1 0-6Z" />
              </svg>
              <span><strong>${escapeHtml(content.brand.name)}</strong><small>${escapeHtml(content.brand.footerTagline)}</small></span>
            </a>
            <p>${escapeHtml(content.brand.footerDescription)}</p>
          </div>

          <div class="site-footer__nav">
${navigation}
          </div>

          <div class="site-footer__cta">
            <span class="site-footer__eyebrow">${escapeHtml(footer.ctaEyebrow)}</span>
            <p>${escapeHtml(footer.ctaText)}</p>
            <a class="site-footer__action" href="${escapeHtml(footer.ctaHref)}">
              <span>${escapeHtml(footer.ctaLabel)}</span><span aria-hidden="true">↗</span>
            </a>
          </div>`;
}

for (const [file, page] of Object.entries(content.pages)) {
  const filePath = path.join(rootDirectory, file);
  const original = await readFile(filePath, "utf8");
  let generated = replaceRequired(
    original,
    /<title>[\s\S]*?<\/title>/u,
    `<title>${escapeHtml(page.title)}</title>`,
    `${file} title`
  );

  if (page.description) {
    generated = replaceGeneratedBlock(generated, "seo", renderSeo(page));
  }

  if (file === "index.html") {
    generated = replaceGeneratedBlock(generated, "services-catalog", renderServicesPlaceholder());
    generated = replaceGeneratedBlock(generated, "faq-heading", renderFaqHeading());
    generated = replaceGeneratedBlock(generated, "faq-items", renderFaqItems());
    generated = replaceGeneratedBlock(generated, "footer-top", renderFooterTop());
  }

  if (!page.description && generated === original) continue;
  generated = await format(generated, { ...prettierConfig, parser: "html" });

  if (generated === original) continue;
  if (checkOnly) {
    failures.push(`${file}: content/site-content.json ile senkron değil`);
  } else {
    await writeFile(filePath, generated, "utf8");
    console.log(`${file} güncellendi.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else if (checkOnly) {
  console.log("Yayın içeriği manifest ile senkron.");
}

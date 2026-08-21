import { expect, test } from "@playwright/test";

const expectedSectionOrder = [
  "#anasayfa",
  "#galeri",
  "#cekimler",
  "#hizmetler",
  "#paket-olustur",
  "#mekanlar",
  "#sss",
  "#iletisim"
];

test("@responsive mobil navigasyon sayfa bolumlerini dogru sirada listeler", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");
  await page.locator(".menu-toggle").click();

  const mobileSectionOrder = await page
    .locator(".mobile-menu nav a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));

  expect(mobileSectionOrder).toEqual(expectedSectionOrder);
});

test("@responsive kaldirilan tanitim bolumleri sayfada ve navigasyonda yer almaz", async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");

  await expect(page.locator("#hakkimizda, #konseptler")).toHaveCount(0);
  await expect(page.locator('a[href="#hakkimizda"], a[href="#konseptler"]')).toHaveCount(0);
});

test("@responsive mobil fotoğraf ve film alanları yatay taşmadan bento vurgusu kullanır", async ({
  page
}) => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 600, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/index.html");

    const layout = await page.evaluate(() => {
      const galleryTrack = document.querySelector(".gallery-track");
      const shootsGrid = document.querySelector(".shoots-grid");
      const galleryCards = [...document.querySelectorAll(".gallery-card")];
      const shootCards = [...document.querySelectorAll(".shoot-card")];

      return {
        galleryOverflow: galleryTrack.scrollWidth - galleryTrack.clientWidth,
        shootsOverflow: shootsGrid.scrollWidth - shootsGrid.clientWidth,
        galleryFeaturedWidth: galleryCards[0].getBoundingClientRect().width,
        gallerySupportWidth: galleryCards[1].getBoundingClientRect().width,
        shootsFeaturedWidth: shootCards[0].getBoundingClientRect().width,
        shootsSupportWidth: shootCards[1].getBoundingClientRect().width
      };
    });

    expect(layout.galleryOverflow).toBeLessThanOrEqual(1);
    expect(layout.shootsOverflow).toBeLessThanOrEqual(1);
    expect(layout.galleryFeaturedWidth).toBeGreaterThan(layout.gallerySupportWidth * 1.85);
    expect(layout.shootsFeaturedWidth).toBeGreaterThan(layout.shootsSupportWidth * 1.85);
  }
});

test("@responsive fotoğraf vitrini seçkiden tüm galeriye akıcı biçimde açılır", async ({
  page
}) => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/index.html");

    const galleryViewport = page.locator("[data-gallery-viewport]");
    const galleryTrack = page.locator(".gallery-track");
    const reveal = page.locator("[data-gallery-reveal]");

    await expect(reveal).toBeVisible();
    await expect(reveal).toHaveAttribute("aria-expanded", "false");
    await expect(reveal).toContainText("Tümünü Gör");

    const collapsed = await page.evaluate(() => {
      const frame = document.querySelector("[data-gallery-viewport]");
      const track = document.querySelector(".gallery-track");
      const fifthCard = document.querySelector('.gallery-card[data-gallery-index="4"]');
      const frameRect = frame.getBoundingClientRect();
      const fifthRect = fifthCard.getBoundingClientRect();

      return {
        frameHeight: frameRect.height,
        trackHeight: track.getBoundingClientRect().height,
        partialCardPixels: frameRect.bottom - fifthRect.top,
        fifthCardInert: fifthCard.inert
      };
    });

    expect(collapsed.frameHeight).toBeLessThan(collapsed.trackHeight - 40);
    expect(collapsed.partialCardPixels).toBeGreaterThan(32);
    expect(collapsed.partialCardPixels).toBeLessThan(collapsed.frameHeight);
    expect(collapsed.fifthCardInert).toBe(true);

    await reveal.click();
    await expect(reveal).toHaveAttribute("aria-expanded", "true");
    await expect(reveal).toContainText("Daha Az Göster");
    await expect
      .poll(async () => {
        const [frameBox, trackBox] = await Promise.all([
          galleryViewport.boundingBox(),
          galleryTrack.boundingBox()
        ]);
        return Math.abs(frameBox.height - trackBox.height);
      })
      .toBeLessThanOrEqual(1);
    await expect(page.locator('.gallery-card[data-gallery-index="4"]')).not.toHaveAttribute(
      "inert",
      ""
    );

    await reveal.click();
    await expect(reveal).toHaveAttribute("aria-expanded", "false");
    await expect(reveal).toContainText("Tümünü Gör");
  }
});

test("@responsive mobil hizmet kartları koyu sahnede kompakt kalır", async ({ page }) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          packages: [],
          services: [
            {
              code: "mobil-hizmet",
              name: "Mobil Hizmet",
              description: "Düğün gününe özel planlanan profesyonel görsel prodüksiyon hizmeti.",
              priceCents: 100_000,
              imagePath: "assets/images/hero-couple.webp"
            }
          ]
        }
      })
    })
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");
  await expect(page.locator(".service-card")).toHaveCount(1);

  const dimensions = await page.evaluate(() => {
    const card = document.querySelector(".service-card").getBoundingClientRect();
    const media = document.querySelector(".service-card__media").getBoundingClientRect();
    const action = document.querySelector(".service-card__link").getBoundingClientRect();
    return {
      cardHeight: card.height,
      cardWidth: card.width,
      mediaHeight: media.height,
      actionHeight: action.height
    };
  });

  await expect(page.locator(".services-stage--dark")).toBeVisible();
  expect(dimensions.cardWidth).toBeLessThan(180);
  expect(dimensions.cardHeight).toBeLessThan(290);
  expect(dimensions.mediaHeight).toBeLessThanOrEqual(130);
  expect(dimensions.actionHeight).toBeGreaterThanOrEqual(44);
});

test("@responsive tum mobil section gecisleri kompakt dikey ritmi korur", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/index.html");

  const galleryStage = page.locator(".gallery-stage");
  const shootsStage = page.locator(".shoots-stage");
  const [galleryStageBox, shootsStageBox] = await Promise.all([
    galleryStage.boundingBox(),
    shootsStage.boundingBox()
  ]);

  await expect(page.locator(".gallery-cta")).toHaveCount(0);
  expect(galleryStageBox).not.toBeNull();
  expect(shootsStageBox).not.toBeNull();
  expect(shootsStageBox.y - (galleryStageBox.y + galleryStageBox.height)).toBeLessThanOrEqual(60);

  const spacing = await page.evaluate(() => {
    const pixels = (value) => Number.parseFloat(value) || 0;
    const padding = (selector) => {
      const styles = getComputedStyle(document.querySelector(selector));
      return {
        start: pixels(styles.paddingBlockStart),
        end: pixels(styles.paddingBlockEnd)
      };
    };

    const sections = [
      ".gallery-section",
      ".shoots-section",
      ".services-section",
      ".venues-section",
      ".faq-section"
    ].map(padding);
    const packageCopy = padding(".package-invitation__copy");
    const footerInner = padding(".site-footer__inner");
    const footerTopStyles = getComputedStyle(document.querySelector(".site-footer__top"));
    const footerCtaStyles = getComputedStyle(document.querySelector(".site-footer__cta"));

    return {
      sections,
      servicesToPackage: sections[2].end + packageCopy.start,
      faqToFooter: sections[4].end + footerInner.start,
      footerGridGap: pixels(footerTopStyles.rowGap),
      footerCtaPaddingTop: pixels(footerCtaStyles.paddingTop)
    };
  });

  for (const section of spacing.sections) {
    expect(section.start).toBeLessThanOrEqual(32);
    expect(section.end).toBeLessThanOrEqual(24);
  }
  expect(spacing.servicesToPackage).toBeLessThanOrEqual(56);
  expect(spacing.faqToFooter).toBeLessThanOrEqual(56);
  expect(spacing.footerGridGap).toBeLessThanOrEqual(28);
  expect(spacing.footerCtaPaddingTop).toBeLessThanOrEqual(24);
});

test("@responsive masaustu ve mobil navigasyon ayni bolumleri ayni sirada kullanir", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");

  const [desktopSectionOrder, mobileSectionOrder] = await Promise.all([
    page
      .locator(".desktop-nav a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
    page
      .locator(".mobile-menu nav a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")))
  ]);

  expect(desktopSectionOrder).toEqual(expectedSectionOrder);
  expect(mobileSectionOrder).toEqual(expectedSectionOrder);
});

test("@responsive masaustu header klasik tam genislikte ve tek satirda kalir", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"success":false}' })
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");

  const headerBox = await page.locator(".site-header").boundingBox();
  const brandBox = await page.locator(".brand").boundingBox();
  const navigationBox = await page.locator(".desktop-nav").boundingBox();
  const actionsBox = await page.locator(".header-actions").boundingBox();

  expect(headerBox).not.toBeNull();
  expect(brandBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(headerBox.x).toBe(0);
  expect(headerBox.width).toBe(1440);
  expect(brandBox.y + brandBox.height / 2).toBeCloseTo(
    navigationBox.y + navigationBox.height / 2,
    0
  );
  expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(navigationBox.x);
  expect(navigationBox.x + navigationBox.width).toBeLessThanOrEqual(actionsBox.x + 2);
});

test("@responsive masaustu navigasyon tiklamasi tek bir kaydirma baslatir", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");
  await page.evaluate(() => {
    const originalScrollTo = window.scrollTo.bind(window);
    window.__navigationScrollCalls = [];
    window.scrollTo = (...args) => {
      window.__navigationScrollCalls.push(args);
      originalScrollTo(...args);
    };
  });

  await page.locator('.desktop-nav a[href="#hizmetler"]').click();
  await expect.poll(() => page.evaluate(() => window.__navigationScrollCalls.length)).toBe(1);

  expect(await page.evaluate(() => window.__navigationScrollCalls)).toHaveLength(1);
});

test("@responsive gec yuklenen katalog paket olustur hedefini kaydirmaz", async ({ page }) => {
  await page.route("**/api/v1/catalog", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          packages: [],
          services: Array.from({ length: 8 }, (_, index) => ({
            code: `hizmet-${index + 1}`,
            name: `Hizmet ${index + 1}`,
            priceCents: 100_000,
            imagePath: "assets/images/hero-couple.webp"
          }))
        }
      })
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");

  await page.locator('.header-cta[href="#paket-olustur"]').click();
  await expect(page.locator(".service-card")).toHaveCount(8);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const headerBottom = document.querySelector(".site-header").getBoundingClientRect().bottom;
        const targetTop = document.getElementById("paket-olustur").getBoundingClientRect().top;
        return Math.abs(targetTop - headerBottom - 16);
      })
    )
    .toBeLessThan(3);
});

test("@responsive scroll konumu masaustu navigasyonunun ust basligini gunceller", async ({
  page
}) => {
  await page.goto("/index.html");

  await page.locator("#cekimler").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document.querySelector('.desktop-nav a[href="#cekimler"]')?.matches(".is-active")
  );
  await expect(page.locator('.desktop-nav a[href="#cekimler"]')).toHaveAttribute(
    "aria-current",
    "location"
  );

  await page.locator("#mekanlar").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document.querySelector('.desktop-nav a[href="#mekanlar"]')?.matches(".is-active")
  );
  await expect(page.locator('.desktop-nav a[href="#mekanlar"]')).toHaveAttribute(
    "aria-current",
    "location"
  );
});

test("@responsive pazarlama metinleri doğrulanmamış iddialar içermez ve copyright yılı günceldir", async ({
  page
}) => {
  await page.goto("/index.html");

  await expect(page).toHaveTitle("Düğünajansım | Düğün Fotoğrafı ve Video Prodüksiyonu");
  await expect(page.locator(".proof-pill")).toContainText("Fotoğraf");
  await expect(page.locator(".proof-pill")).toContainText("Sinematik Film");
  await expect(page.locator(".site-footer__bottom [data-current-year]")).toHaveText(
    String(new Date().getFullYear())
  );
  await expect(page.locator("body")).not.toContainText(/70\+|1500\+|2018’den beri|2027 itibarıyla/);

  await page.goto("/paketini-olustur.html");
  await expect(page.locator(".showcase-footer [data-current-year]")).toHaveText(
    String(new Date().getFullYear())
  );
});

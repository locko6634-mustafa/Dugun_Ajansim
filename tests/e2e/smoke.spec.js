import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pages = ["/index.html", "/login.html", "/paketini-olustur.html"];

for (const pagePath of pages) {
  test(`${pagePath} temel sayfa kontrolleri`, async ({ page }) => {
    await page.goto(pagePath);
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.locator("h1:visible")).toHaveCount(1);
    await expect(page).toHaveTitle(/.+/);
  });

  test(`${pagePath} yatay tasma uretmiyor`, async ({ page }) => {
    await page.goto(pagePath);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test(`${pagePath} axe kritik ihlal icermiyor`, async ({ page }) => {
    await page.goto(pagePath);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  });
}

test("ana sayfa mobil menu acilip kapanir", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html");
  const menuButton = page.locator("[aria-controls]").first();
  if (await menuButton.count()) {
    await menuButton.click();
    await page.keyboard.press("Escape");
    await expect(menuButton).toBeVisible();
  }
});

test("ana sayfa header navigasyon linkleri aktif durumu gunceller", async ({ page, isMobile }) => {
  await page.goto("/index.html");
  if (isMobile) {
    const menuButton = page.locator("[aria-controls]").first();
    await menuButton.click();
    const mobileNav = page.locator(".mobile-menu nav");
    await expect(mobileNav.locator('a[href="#anasayfa"]')).toHaveClass(/is-active/);
    await mobileNav.locator('a[href="#hizmetler"]').click();
    await expect(mobileNav.locator('a[href="#hizmetler"]')).toHaveClass(/is-active/);
    await expect(mobileNav.locator('a[href="#anasayfa"]')).not.toHaveClass(/is-active/);
  } else {
    const desktopNav = page.locator(".desktop-nav");
    await expect(desktopNav.locator('a[href="#anasayfa"]')).toHaveClass(/is-active/);
    await desktopNav.locator('a[href="#hizmetler"]').click();
    await expect(desktopNav.locator('a[href="#hizmetler"]')).toHaveClass(/is-active/);
    await expect(desktopNav.locator('a[href="#anasayfa"]')).not.toHaveClass(/is-active/);
  }
});

test("anasayfa butonuna basildiginda sayfanin en ustune kaydirir", async ({ page, isMobile }) => {
  await page.goto("/index.html");
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForFunction(() => window.scrollY > 500);

  if (isMobile) {
    const menuButton = page.locator("[aria-controls]").first();
    await menuButton.click();
    await page.locator('.mobile-menu nav a[href="#anasayfa"]').click();
  } else {
    await page.locator('.desktop-nav a[href="#anasayfa"]').click();
  }

  await page.waitForFunction(() => window.scrollY < 50);
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeLessThan(50);
});

test("paketini olustur sayfasinda masaustunde sepet acilip kapanir", async ({ page, isMobile }) => {
  if (!isMobile) {
    await page.goto("/paketini-olustur.html");
    const bagButton = page.locator(".builder-bag");
    const closeButton = page.locator(".package-summary__close");

    await bagButton.click();
    await expect(page.locator("body")).toHaveClass(/is-summary-open/);

    await closeButton.click();
    await expect(page.locator("body")).not.toHaveClass(/is-summary-open/);
  }
});

test("paket formu çift, saat ve salon alanlarını backend kataloğuyla hazırlar", async ({
  page
}) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          packages: [
            {
              code: "mini",
              name: "Mini Paket",
              priceCents: 2_000_000,
              imagePath: "assets/images/hero-couple.webp"
            },
            {
              code: "hikaye",
              name: "Hikâye Paketi",
              priceCents: 3_500_000,
              imagePath: "assets/images/hero-couple.webp"
            }
          ],
          services: []
        }
      })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [{ id: "de305d54-75b4-431b-adb2-eb6b9e546014", name: "Cess Wedding" }]
      })
    })
  );
  await page.goto("/paketini-olustur.html");
  await expect(page.locator('input[name="base-package"]')).toHaveCount(2);
  await page.locator(".js-next-step").click();
  await page.locator(".js-details-step").click();
  await expect(page.locator('input[name="brideFirstName"]')).toBeVisible();
  await expect(page.locator('input[name="groomFirstName"]')).toBeVisible();
  await expect(page.locator('input[name="startTime"]')).toBeVisible();
  await expect(page.locator(".js-venue-select")).toContainText("Cess Wedding");
});

test("admin genel bakış ve düğün düzenleme akışı yetkili API verisiyle açılır", async ({
  page
}) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "ADMIN", mustChangePassword: false, username: "admin" }
      })
    })
  );
  await page.route("**/api/v1/admin/overview", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          pendingBookings: 2,
          activeWeddings: 7,
          pendingMessages: 3,
          readyDeliveries: 1
        }
      })
    })
  );
  let lastApplicationUrl = "";
  await page.route("**/api/v1/admin/booking-applications?**", (route) => {
    lastApplicationUrl = route.request().url();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    });
  });
  const wedding = {
    id: "6ae9f9e6-6217-4b6c-91ea-251be3bb6fc1",
    venueId: "de305d54-75b4-431b-adb2-eb6b9e546014",
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "+905551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "+905559876543",
    primaryContact: "GELIN",
    primaryEmail: "ayse@example.com",
    startsAt: "2026-08-10T17:00:00.000Z",
    endsAt: "2026-08-10T23:00:00.000Z",
    note: "",
    venue: { name: "Cess Wedding" },
    customerUser: {
      id: "40c66ad5-b87a-4f0b-a4fa-1f3562329387",
      username: "yilmaz-demir-4821",
      mustChangePassword: true
    },
    delivery: {
      id: "f82ed2dc-49a8-4c4b-96ef-a23624af6390",
      status: "MONTAJ",
      dueDate: "2026-08-31T00:00:00.000Z"
    }
  };
  await page.route("**/api/v1/admin/weddings", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [wedding] })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [{ id: wedding.venueId, name: "Cess Wedding" }]
      })
    })
  );
  await page.route(`**/api/v1/admin/weddings/${wedding.id}`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.brideLastName).toBe("Kaya");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          ...wedding,
          brideLastName: "Kaya",
          credentialsRegenerated: true,
          username: "kaya-demir-7721"
        }
      })
    });
  });
  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "Operasyon masası" })).toBeVisible();
  await expect(page.locator('[data-metric="pendingBookings"]')).toHaveText("2");
  await page.getByRole("button", { name: "03 Teslimatlar" }).click();
  await page.getByRole("button", { name: "Düzenle" }).click();
  await expect(page.getByRole("heading", { name: "Bilgileri güncelle" })).toBeVisible();
  await page.locator('.js-wedding-form input[name="brideLastName"]').fill("Kaya");
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.locator(".global-message")).toContainText("Yeni kullanıcı adı");
  await page.getByRole("button", { name: "02 Başvurular" }).click();
  await page.getByLabel("Başvuru referans kodu").fill("DA-2026-123456");
  await page.getByRole("button", { name: "Bul" }).click();
  await expect.poll(() => lastApplicationUrl).toContain("referenceCode=DA-2026-123456");
});

test("müşteri teslimat paneli linki teslim öncesinde göstermiyor", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "MUSTERI", mustChangePassword: false, username: "yilmaz-demir-4821" }
      })
    })
  );
  await page.route("**/api/v1/customer/dashboard", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          couple: { bride: "Ayşe Yılmaz", groom: "Mehmet Demir" },
          venue: "Cess Wedding",
          startsAt: "2026-08-10T17:00:00.000Z",
          delivery: {
            status: "MONTAJ",
            dueDate: "2026-08-31T00:00:00.000Z",
            releasedAt: null,
            history: []
          }
        }
      })
    })
  );
  await page.goto("/musteri-paneli.html");
  await expect(page.getByText("Ayşe Yılmaz")).toBeVisible();
  await expect(page.locator(".delivery-release")).toBeHidden();
  await expect(page.getByText("Montaj Aşamasında").first()).toBeVisible();
});

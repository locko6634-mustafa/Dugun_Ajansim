import { expect, test } from "@playwright/test";

test("@frontend-smoke ana sayfa API hatasında eski hizmet kataloğunu göstermez", async ({
  page
}) => {
  await page.route("**/api/v1/catalog", (route) => route.abort("failed"));

  await page.goto("/index.html");

  await expect(page.locator(".service-card")).toHaveCount(0);
  await expect(page.locator(".services-empty")).toContainText(
    "Hizmet kataloğu şu anda yüklenemiyor."
  );
});

test("@frontend-smoke ana sayfa hazır paketleri yalnız backend kataloğundan gösterir", async ({
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
              name: "API Mini Paket",
              subtitle: "API mini etiketi",
              description: "API mini açıklaması",
              imagePath: "assets/images/why-digital-delivery.webp",
              priceCents: 2_000_000,
              features: ["API mini kapsamı"]
            },
            {
              code: "classic",
              name: "API Classic Paket",
              subtitle: "API kapsam etiketi",
              description: "API paket açıklaması",
              imagePath: "assets/images/hero-couple.webp",
              priceCents: 4_500_000,
              deliveryText: "API teslim notu",
              features: ["API kamera kapsamı", "API drone kapsamı"]
            }
          ],
          services: []
        }
      })
    })
  );

  await page.goto("/index.html");

  await expect(page.locator(".package-card").first()).toHaveAttribute("data-package-code", "mini");
  const packageCard = page.locator('[data-package-code="classic"]');
  await expect(packageCard).toContainText("API Classic Paket");
  await expect(packageCard).toContainText("₺45.000");
  await expect(packageCard).toContainText("API kamera kapsamı");
  await expect(page.getByText("Mini Paket", { exact: true })).toHaveCount(0);
});

test("@frontend-smoke paket oluşturucu eksik API alanlarını yerel katalogdan tamamlamaz", async ({
  page
}) => {
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          paymentPolicy: { cashDiscountPercent: 10, depositMaximumCents: 5_000_000 },
          bookingFormConstraints: {
            personName: {
              minLength: 2,
              maxLength: 80,
              pattern: "^[\\p{L}\\p{M}][\\p{L}\\p{M} '’\\-]*$",
              message: "Ad ve soyad biçimi geçersiz."
            },
            phone: {
              minLength: 10,
              maxLength: 24,
              pattern: "^\\+?[\\d\\s\\(\\)\\x2D]+$",
              message: "Telefon biçimi geçersiz."
            },
            email: { maxLength: 254 },
            customVenueName: { minLength: 2, maxLength: 140 },
            note: { maxLength: 2000 }
          },
          bookingSchedulePolicy: {
            earliestTime: "00:00",
            latestTime: "23:30",
            stepMinutes: 30,
            allowNextDay: false
          },
          packages: [
            {
              code: "mini",
              name: "API Mini Paket",
              priceCents: 2_000_000,
              imagePath: "assets/images/hero-couple.webp",
              features: ["API paket kapsamı"]
            },
            {
              code: "classic",
              name: "API Classic Paket",
              priceCents: 4_500_000,
              imagePath: "assets/images/hero-couple.webp",
              features: ["API classic kapsamı"]
            }
          ],
          services: [
            {
              code: "fotograf",
              category: "photo",
              name: "API Fotoğraf Hizmeti",
              priceCents: 500_000
            }
          ]
        }
      })
    })
  );
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    })
  );

  await page.goto("/paketini-olustur.html");
  await expect(page.locator(".base-package").first()).toContainText("API Mini Paket");
  await expect(page.locator(".base-package").nth(1)).toContainText("API Classic Paket");
  await expect(page.locator(".base-package").first()).toContainText("API paket kapsamı");
  await page
    .locator('[data-service="fotograf"] .builder-service__open')
    .evaluate((button) => button.click());

  await expect(page.locator(".js-detail-description")).toHaveText(
    "Düğününüze özel olarak planlanan ek hizmet."
  );
  await expect(page.locator(".js-detail-description")).not.toContainText(
    "Hazırlık telaşından son dansa kadar"
  );
});

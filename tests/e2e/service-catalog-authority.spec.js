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
            allowNextDay: true
          },
          packages: [
            {
              code: "mini",
              name: "API Mini Paket",
              priceCents: 2_000_000,
              imagePath: "assets/images/hero-couple.webp"
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

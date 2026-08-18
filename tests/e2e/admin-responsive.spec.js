import { expect, test } from "@playwright/test";

const dashboard = {
  today: "2026-08-10",
  weekStart: "2026-08-10",
  weekEnd: "2026-08-16",
  availabilityDate: "2026-08-10",
  metrics: { pendingBookings: 0, pendingMessages: 0, readyDeliveries: 0, todayWeddings: 0 },
  todayWeddings: [],
  tomorrowWeddings: [],
  weekWeddings: [],
  idleStaff: [],
  venues: [],
  staffAvailability: [],
  distribution: {},
  conflicts: [],
  upcomingDeliveries: []
};

const catalogFormConstraints = {
  code: { minLength: 1, maxLength: 80, pattern: "^[a-z0-9-]+$" },
  name: { minLength: 2, maxLength: 80 },
  subtitle: { maxLength: 200 },
  eyebrow: { maxLength: 100 },
  description: { maxLength: 2000 },
  imagePath: { maxLength: 500 },
  delivery: { maxLength: 200 },
  feature: { maxLength: 500 },
  galleryItem: { maxLength: 500 },
  priceCents: { minimum: 0, maximum: 100000000, step: 1 },
  venue: {
    displayName: { minLength: 2, maxLength: 140 },
    displayOrder: { minimum: 0, maximum: 10000, step: 1 }
  }
};

async function expectNoPageOverflow(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    )
    .toBe(true);
}

async function expectMinimumHeight(locator, minimum = 44) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(minimum - 0.01);
}

test("@admin @responsive admin paneli 320px ekranda taşmadan ve dokunma hedeflerini koruyarak çalışır", async ({
  page
}) => {
  let venueCreateBody = null;
  let montageCreateBody = null;
  let managerCreateBody = null;
  let managerUpdateBody = null;
  let storedManager = null;
  let storedStaff = null;
  let staffPhotoUpload = null;
  const accountVenue = {
    id: "00000000-0000-4000-8000-000000000091",
    name: "Cess Wedding Park"
  };
  const secondAccountVenue = {
    id: "00000000-0000-4000-8000-000000000092",
    name: "Cess Wedding Orman"
  };
  const greenVenues = ["Hayal", "Masal", "Kale", "Rüya"].map((garden, index) => ({
    id: `00000000-0000-4000-8000-00000000010${index}`,
    slug: `yesil-nesil-garden-${garden.toLocaleLowerCase("tr-TR")}-bahce`,
    name: `Yeşil Nesil Garden ${garden} Bahçe`
  }));
  const existingStaff = [
    {
      id: "00000000-0000-4000-8000-000000000081",
      firstName: "Cem",
      lastName: "Cess",
      phone: "05550000001",
      isActive: true,
      specialties: ["PHOTOGRAPHY"],
      venues: [accountVenue],
      assignments: [],
      photoUrl: null
    },
    ...greenVenues.slice(0, 2).map((venue, index) => ({
      id: `00000000-0000-4000-8000-00000000008${index + 2}`,
      firstName: `Yeşil${index + 1}`,
      lastName: "Personel",
      phone: `0555000000${index + 2}`,
      isActive: true,
      specialties: ["PHOTOGRAPHY"],
      venues: [venue],
      assignments: [],
      photoUrl: null
    })),
    {
      id: "00000000-0000-4000-8000-000000000084",
      firstName: "Ece",
      lastName: "Extra",
      phone: "05550000004",
      isActive: true,
      isExtra: true,
      specialties: ["PHOTOGRAPHY"],
      venueId: null,
      venue: null,
      venues: [],
      assignments: [],
      photoUrl: null
    }
  ];
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { role: "ADMIN", mustChangePassword: false, username: "admin" }
      })
    })
  );
  await page.route("**/api/v1/admin/dashboard**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: dashboard })
    })
  );
  await page.route("**/api/v1/admin/calendar**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          month: "2026-08",
          today: "2026-08-10",
          venues: [],
          selectedVenue: null,
          weddings: []
        }
      })
    })
  );
  await page.route("**/api/v1/admin/catalog-form-constraints", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: catalogFormConstraints })
    })
  );
  await page.route("**/api/v1/admin/montage-users**", async (route) => {
    if (route.request().method() === "POST") {
      montageCreateBody = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: "00000000-0000-4000-8000-000000000099",
            username: montageCreateBody.username,
            status: montageCreateBody.status,
            mustChangePassword: true,
            lastLoginAt: null
          }
        })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    });
  });
  await page.route("**/api/v1/admin/venue-managers**", async (route) => {
    if (route.request().method() === "POST") {
      managerCreateBody = route.request().postDataJSON();
      storedManager = {
        id: "00000000-0000-4000-8000-000000000098",
        username: managerCreateBody.username,
        status: managerCreateBody.status,
        mustChangePassword: true,
        venue: secondAccountVenue,
        venues: [secondAccountVenue]
      };
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: storedManager })
      });
    }
    if (route.request().method() === "PATCH") {
      managerUpdateBody = route.request().postDataJSON();
      storedManager = {
        ...storedManager,
        username: managerUpdateBody.username,
        status: managerUpdateBody.status,
        venue: accountVenue,
        venues: [accountVenue, secondAccountVenue]
      };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: storedManager })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: storedManager ? [storedManager] : [] })
    });
  });
  await page.route("**/api/v1/venues", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          { ...accountVenue, slug: "cess-wedding-park" },
          { ...secondAccountVenue, slug: "cess-wedding-orman" },
          ...greenVenues
        ]
      })
    })
  );
  await page.route("**/api/v1/admin/staff", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      storedStaff = {
        id: "00000000-0000-4000-8000-000000000097",
        ...body,
        venueId: body.venueIds[0],
        venue: secondAccountVenue,
        venues: [secondAccountVenue],
        assignments: [],
        photoUrl: null
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: storedStaff })
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [...existingStaff, ...(storedStaff ? [storedStaff] : [])]
      })
    });
  });
  await page.route(/\/api\/v1\/admin\/staff\/[^/]+\/photo(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PUT") {
      staffPhotoUpload = {
        contentType: await route.request().headerValue("content-type"),
        bytes: route.request().postDataBuffer()?.length || 0
      };
      storedStaff.photoUrl = `/api/v1/admin/staff/${storedStaff.id}/photo?v=2026-08-17T12%3A00%3A00.000Z`;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { photoUrl: storedStaff.photoUrl } })
      });
      return;
    }
    await route.fulfill({
      contentType: "image/webp",
      body: Buffer.from(
        "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==",
        "base64"
      )
    });
  });
  await page.route("**/api/v1/catalog", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          packages: [],
          services: [],
          bookingFormConstraints: {
            personName: {
              minLength: 2,
              maxLength: 80,
              pattern: "^[\\p{L}\\p{M}][\\p{L}\\p{M} '’\\-]*$",
              message: "Geçerli bir ad girin."
            },
            phone: {
              minLength: 10,
              maxLength: 24,
              pattern: "^\\+?[\\d\\s\\(\\)\\x2D]+$",
              message: "Geçerli bir telefon girin."
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
          }
        }
      })
    })
  );
  await page.route(/\/api\/v1\/admin\/(packages|services|venues)$/, async (route) => {
    if (route.request().method() === "POST") {
      venueCreateBody = route.request().postDataJSON();
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] })
    });
  });

  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "Günün akışı" })).toBeVisible();
  await expectNoPageOverflow(page);
  await expect(page.getByRole("button", { name: "Yeni düğün" })).toBeHidden();
  await expectMinimumHeight(page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }));

  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await expectMinimumHeight(page.getByRole("button", { name: /Menüyü Kapat/i }));
  await expectMinimumHeight(page.locator('.admin-nav [data-panel="overview"]'));
  await page.getByRole("button", { name: /Menüyü Kapat/i }).click();

  await expect(page.locator('[data-panel="plan"]')).toHaveCount(0);
  await expect(page.locator('[data-panel-content="plan"]')).toHaveCount(0);

  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await page.locator('[data-panel="catalog"]').click();
  await expect(page.locator('[data-panel-content="catalog"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni düğün" })).toBeHidden();
  await page.locator('[data-add-catalog="packages"]').click();
  const catalogDialog = page.locator(".custom-modal-dialog");
  await expect(catalogDialog).toBeVisible();
  await expect(catalogDialog.locator(".js-catalog-code")).toHaveAttribute("maxlength", "80");
  await expect(catalogDialog.locator(".js-catalog-name")).toHaveAttribute("minlength", "2");
  await expect(catalogDialog.locator(".js-catalog-price")).toHaveAttribute("step", "0.01");
  await expect(catalogDialog.locator(".js-catalog-price")).toHaveAttribute("max", "1000000");
  await expect(catalogDialog.locator(".js-catalog-description")).toHaveAttribute(
    "maxlength",
    "2000"
  );
  await expectMinimumHeight(catalogDialog.getByRole("button", { name: "Kapat" }));
  expect(
    await catalogDialog.locator(".custom-catalog-grid").evaluate((element) => ({
      fits: element.scrollWidth <= element.clientWidth,
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length
    }))
  ).toEqual({ fits: true, columns: 1 });
  await catalogDialog.getByRole("button", { name: "Kapat" }).click();
  await page.locator('[data-add-catalog="venues"]').click();
  await expect(catalogDialog.getByRole("heading", { name: "Yeni Mekân Oluştur" })).toBeVisible();
  await expect(catalogDialog.locator(".js-venue-slug")).toHaveAttribute(
    "pattern",
    catalogFormConstraints.code.pattern
  );
  await expect(catalogDialog.locator(".js-venue-display-name")).toBeVisible();
  await expect(catalogDialog.locator(".js-venue-display-name")).toHaveAttribute("maxlength", "140");
  await expect(catalogDialog.locator(".js-venue-image")).toBeVisible();
  await expect(catalogDialog.locator(".js-venue-display-order")).toBeVisible();
  await expect(catalogDialog.locator(".js-venue-display-order")).toHaveAttribute("max", "10000");
  await catalogDialog.locator(".js-venue-slug").fill("responsive-garden");
  await catalogDialog.locator(".js-venue-name").fill("Responsive Garden");
  await catalogDialog.locator(".js-venue-display-name").fill("Responsive");
  await catalogDialog.locator(".js-venue-image").fill("assets/images/venues/rena.webp");
  await catalogDialog.locator(".js-venue-display-order").fill("8");
  await catalogDialog.locator(".js-venue-featured").check();
  await catalogDialog.getByRole("button", { name: "Mekân Oluştur" }).click();
  await expect
    .poll(() => venueCreateBody)
    .toEqual({
      slug: "responsive-garden",
      name: "Responsive Garden",
      displayName: "Responsive",
      imagePath: "assets/images/venues/rena.webp",
      displayOrder: 8,
      isFeatured: true,
      isPartner: true,
      isActive: true
    });

  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await page.locator('[data-panel="staff"]').click();
  await expect(page.locator('[data-panel-content="staff"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni düğün" })).toBeHidden();
  const staffVenueFilter = page.locator(".js-staff-venue-filter");
  await expect(staffVenueFilter.locator("option")).toHaveText([
    "Tüm salonlar",
    "Extra",
    "Cess Wedding",
    "Yeşil Nesil Garden"
  ]);
  await staffVenueFilter.selectOption({ label: "Yeşil Nesil Garden" });
  await expect(page.locator(".js-staff")).toContainText("Yeşil1 Personel");
  await expect(page.locator(".js-staff")).toContainText("Yeşil2 Personel");
  await expect(page.locator(".js-staff")).not.toContainText("Cem Cess");
  await staffVenueFilter.selectOption({ label: "Cess Wedding" });
  await expect(page.locator(".js-staff")).toContainText("Cem Cess");
  await expect(page.locator(".js-staff")).not.toContainText("Yeşil1 Personel");
  await staffVenueFilter.selectOption("extra");
  await expect(page.locator(".js-staff")).toContainText("Ece Extra");
  await expect(page.locator(".js-staff")).toContainText("Extra · Sabit salon yok");
  await expect(page.locator(".js-staff")).not.toContainText("Cem Cess");
  await staffVenueFilter.selectOption("");
  await page.getByRole("button", { name: "+ Personel ekle" }).click();
  const staffDialog = page.locator(".js-staff-dialog");
  const staffVenuePicker = staffDialog.locator(".js-staff-venue");
  await expect(staffDialog).toBeVisible();
  await expect(staffVenuePicker.locator(".js-staff-venue-count")).toHaveText("1 salon seçili");
  await staffDialog.locator('[name="isExtra"]').check();
  await expect(staffVenuePicker).toBeHidden();
  await staffDialog.locator('[name="isExtra"]').uncheck();
  await expect(staffVenuePicker).toBeVisible();
  await expect(staffVenuePicker.locator(".js-staff-venue-count")).toHaveText("1 salon seçili");
  await expectMinimumHeight(staffVenuePicker.locator(".js-staff-venue-search"));
  const staffParkChoice = staffVenuePicker.locator(".venue-picker__choice").filter({
    hasText: accountVenue.name
  });
  const staffForestChoice = staffVenuePicker.locator(".venue-picker__choice").filter({
    hasText: secondAccountVenue.name
  });
  await staffVenuePicker.locator(".js-staff-venue-search").fill("Orman");
  await expect(staffParkChoice).toBeHidden();
  await expect(staffForestChoice).toBeVisible();
  await staffVenuePicker.locator(".js-staff-venue-search").clear();
  await staffForestChoice.locator('input[name="venueIds"]').check();
  await expect(staffVenuePicker.locator(".js-staff-venue-count")).toHaveText("2 salon seçili");
  await staffVenuePicker
    .getByRole("button", { name: `${accountVenue.name} salonunu çıkar` })
    .click();
  await expect(staffParkChoice.locator('input[name="venueIds"]')).not.toBeChecked();
  await expect(staffVenuePicker.locator(".js-staff-venue-count")).toHaveText("1 salon seçili");
  await staffDialog.locator('[name="firstName"]').fill("Deniz");
  await staffDialog.locator('[name="lastName"]').fill("Kamera");
  await staffDialog.locator('[name="phone"]').fill("05551112233");
  await staffDialog.locator('[name="specialties"][value="PHOTOGRAPHY"]').check();
  await staffDialog.locator('[name="photo"]').setInputFiles({
    name: "deniz.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS0AAAAASUVORK5CYII=",
      "base64"
    )
  });
  await expect(staffDialog.locator(".js-staff-photo-preview-image")).toBeVisible();
  await staffDialog.getByRole("button", { name: "Kaydet" }).click();
  await expect(staffDialog).toBeHidden();
  await expect.poll(() => staffPhotoUpload).toEqual({ contentType: "image/png", bytes: 68 });
  await expect(page.locator(".js-staff img.avatar")).toHaveAttribute(
    "src",
    /\/api\/v1\/admin\/staff\/.+\/photo\?v=/
  );

  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await page.locator('[data-panel="accounts"]').click();
  await expect(page.locator('[data-panel-content="accounts"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni düğün" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Salon sorumluları" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Montajcılar" })).toBeVisible();
  await page.getByRole("button", { name: "+ Kullanıcı hesabı" }).click();
  const accountDialog = page.locator(".js-managed-user-dialog");
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog.locator('[name="password"]')).toHaveAttribute("minlength", "8");
  await expect(accountDialog.locator(".js-managed-user-password-note")).toHaveText(
    "En az 8 karakter"
  );
  await expectMinimumHeight(accountDialog.getByRole("button", { name: "Kapat" }));
  await accountDialog.locator('[name="role"]').selectOption("MONTAJCI");
  await expect(accountDialog.locator(".js-managed-user-venue")).toBeHidden();
  await accountDialog.locator('[name="username"]').fill("montaj-ekibi");
  await accountDialog.locator('[name="password"]').fill("Guvenli-Montaj-Parolasi-2026!");
  await accountDialog.getByRole("button", { name: "Kaydet" }).click();
  await expect
    .poll(() => montageCreateBody)
    .toEqual({
      username: "montaj-ekibi",
      password: "Guvenli-Montaj-Parolasi-2026!",
      status: "ACTIVE"
    });
  await expect(accountDialog).toBeHidden();

  await page.getByRole("button", { name: "+ Kullanıcı hesabı" }).click();
  await expect(accountDialog.locator('[name="role"]')).toHaveValue("SALON_YETKILISI");
  const venuePicker = accountDialog.locator(".js-managed-user-venue");
  await expect(venuePicker).toBeVisible();
  await expect(venuePicker.locator(".js-managed-user-venue-count")).toHaveText("1 salon seçili");
  await expectMinimumHeight(venuePicker.locator(".js-managed-user-venue-search"));
  const parkChoice = venuePicker.locator(".venue-picker__choice").filter({
    hasText: accountVenue.name
  });
  const forestChoice = venuePicker.locator(".venue-picker__choice").filter({
    hasText: secondAccountVenue.name
  });
  await expectMinimumHeight(parkChoice);
  await expectMinimumHeight(forestChoice);
  await expect(parkChoice.locator('input[name="venueIds"]')).toBeChecked();
  await forestChoice.locator('input[name="venueIds"]').check();
  await expect(venuePicker.locator(".js-managed-user-venue-count")).toHaveText("2 salon seçili");
  await venuePicker.getByRole("button", { name: `${accountVenue.name} salonunu çıkar` }).click();
  await expect(parkChoice.locator('input[name="venueIds"]')).not.toBeChecked();
  await expect(venuePicker.locator(".js-managed-user-venue-count")).toHaveText("1 salon seçili");
  await accountDialog.locator('[name="username"]').fill("cess-sorumlu");
  await accountDialog.locator('[name="password"]').fill("Guvenli-Salon-Parolasi-2026!");
  await accountDialog.getByRole("button", { name: "Kaydet" }).click();
  await expect
    .poll(() => managerCreateBody)
    .toEqual({
      username: "cess-sorumlu",
      password: "Guvenli-Salon-Parolasi-2026!",
      venueIds: [secondAccountVenue.id],
      status: "ACTIVE"
    });
  await expect(accountDialog).toBeHidden();
  await page.locator(".js-managers").getByRole("button", { name: "Düzenle" }).click();
  await expect(
    accountDialog.getByRole("heading", { name: "Salon sorumlusu hesabını düzenle" })
  ).toBeVisible();
  await expect(forestChoice.locator('input[name="venueIds"]')).toBeChecked();
  await expect(parkChoice.locator('input[name="venueIds"]')).not.toBeChecked();
  await parkChoice.locator('input[name="venueIds"]').check();
  await accountDialog.getByRole("button", { name: "Kaydet" }).click();
  await expect
    .poll(() => managerUpdateBody)
    .toEqual({
      username: "cess-sorumlu",
      venueIds: [accountVenue.id, secondAccountVenue.id],
      status: "ACTIVE"
    });
  await expect(accountDialog).toBeHidden();

  await expect(page.locator('[data-panel="weddings"]')).toHaveCount(0);
  await expect(page.locator('[data-panel-content="weddings"]')).toHaveCount(0);

  await page.getByRole("button", { name: /Menüyü Aç\/Kapat/i }).click();
  await page.locator('[data-panel="calendar"]').click();
  await expect(page.locator('[data-panel-content="calendar"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni düğün" })).toBeVisible();

  await page.getByRole("button", { name: "Yeni düğün" }).click();
  const dialog = page.locator(".js-manual-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Manuel etkinlik başvurusu" })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Düğün" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Kına" }).check();
  await expect(dialog.getByRole("radio", { name: "Kına" })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Düğün" })).not.toBeChecked();
  await expectMinimumHeight(dialog.getByRole("button", { name: "Kapat" }));
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  expect(
    await dialog
      .locator(".form-grid")
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true);
  const formShell = dialog.locator(".form-shell");
  const formHeading = dialog.locator(".sheet-heading");
  await formShell.evaluate((element) => element.scrollTo({ top: 500 }));
  await expect
    .poll(async () => {
      const dialogBox = await dialog.boundingBox();
      const headingBox = await formHeading.boundingBox();
      return Math.abs((headingBox?.y ?? 0) - (dialogBox?.y ?? 0));
    })
    .toBeLessThanOrEqual(1);
  for (const button of await dialog.locator(".dialog-actions button").all()) {
    await expectMinimumHeight(button);
  }
  await dialog.getByRole("button", { name: "Kapat" }).click();

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    await expectNoPageOverflow(page);
    await expectMinimumHeight(page.getByRole("button", { name: "Yeni düğün" }));
    await expectMinimumHeight(
      page.locator('.js-calendar-type-filter [data-calendar-event-type="WEDDING"]')
    );
    const controls = page.locator(".calendar-heading .plan-controls");
    expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
  }
});

import { expect, test } from "@playwright/test";

test("@phase01-container gerçek Nginx sayfası katalog API'sini hatasız yükler", async ({
  page
}) => {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`
    );
  });

  await page.goto("/paketini-olustur.html");
  await expect(page.locator(".base-package").first()).toBeVisible();
  expect({ consoleErrors, pageErrors, failedRequests }).toEqual({
    consoleErrors: [],
    pageErrors: [],
    failedRequests: []
  });
  await expect(page.locator(".js-next-step")).toBeEnabled();
  await expect(page.locator(".js-builder-request-status")).toBeHidden();
});

for (const [paymentMethod, weddingDate] of [
  ["cash", "2027-08-11"],
  ["deposit", "2027-08-12"]
]) {
  test(`@phase01-container gerçek Nginx formu ${paymentMethod} başvurusunu tamamlar`, async ({
    page
  }) => {
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const failedHttpResponses = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`
      );
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedHttpResponses.push(
          `${response.status()} ${response.request().method()} ${response.url()}`
        );
      }
    });

    await page.goto("/paketini-olustur.html");
    await expect(page.locator(".js-next-step")).toBeEnabled();
    await page.locator(".js-next-step").click();
    await page.locator(".js-details-step").click();
    const form = page.locator("#checkout-form");
    await form.locator('input[name="brideFirstName"]').fill("Sentetik");
    await form.locator('input[name="brideLastName"]').fill("Nginx");
    await form.locator('input[name="bridePhone"]').fill("05553000111");
    await form.locator('input[name="groomFirstName"]').fill("Kabul");
    await form.locator('input[name="groomLastName"]').fill("Akışı");
    await form.locator('input[name="groomPhone"]').fill("05553000222");
    await form
      .locator('input[name="primaryEmail"]')
      .fill(`phase01-ui-${paymentMethod}@example.invalid`);
    await form.locator('select[name="venueId"]').selectOption({ index: 1 });
    for (const [name, value] of [
      ["weddingDate", weddingDate],
      ["startTime", "19:00"],
      ["endTime", "23:00"]
    ]) {
      await form.locator(`input[name="${name}"]`).evaluate((input, nextValue) => {
        input.value = nextValue;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    }
    await form.locator('input[name="privacyConsent"]').check();
    await form.getByRole("button", { name: "Ödemeye Geç" }).click();
    if (paymentMethod === "deposit") {
      await page.locator('label.payment-option:has(input[value="deposit"])').click();
    }

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/booking-applications")
    );
    await page.locator(".js-summary-step").click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    await expect(page.locator(".js-transfer-reference").first()).toContainText("DA-");
    expect({ consoleErrors, pageErrors, failedRequests, failedHttpResponses }).toEqual({
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      failedHttpResponses: []
    });
  });
}

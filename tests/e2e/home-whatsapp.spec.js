import { expect, test } from "@playwright/test";

test("@frontend-smoke ana sayfa WhatsApp iletisim baglantisini sunar", async ({ page }) => {
  await page.goto("/index.html");

  const whatsappLink = page.getByRole("link", {
    name: "WhatsApp üzerinden iletişime geç"
  });

  await expect(whatsappLink).toHaveAttribute("href", "https://wa.me/905386888306");
  await expect(whatsappLink).toHaveAttribute("target", "_blank");
  await expect(whatsappLink).toHaveAttribute("rel", "noopener noreferrer");
});

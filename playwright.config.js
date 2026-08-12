import { defineConfig, devices } from "@playwright/test";

const testServerPort = process.env.PLAYWRIGHT_PORT || "4176";
const testServerUrl = `http://127.0.0.1:${testServerPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || testServerUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
    ? undefined
    : {
        command: `node tools/serve.mjs ${testServerPort}`,
        url: testServerUrl,
        reuseExistingServer: false,
        timeout: 30_000
      },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      testIgnore: /production-hardening\.spec\.js/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true
      }
    }
  ]
});

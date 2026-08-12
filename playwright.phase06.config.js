import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PHASE06_BASE_URL || "http://127.0.0.1:8186";

export default defineConfig({
  testDir: "./tests/phase06",
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/phase06/artifacts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/phase06/html-report", open: "never" }]
  ],
  use: {
    baseURL,
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "phase06-chromium",
      use: {
        ...devices["Desktop Chrome"],
        recordHar: {
          path: "test-results/phase06/network.raw.har",
          content: "omit",
          mode: "minimal"
        }
      }
    },
    {
      name: "phase06-webkit",
      testMatch: /browser-contract\.spec\.js/,
      use: { ...devices["Desktop Safari"] }
    },
    {
      name: "phase06-firefox",
      testMatch: /browser-contract\.spec\.js/,
      use: { ...devices["Desktop Firefox"] }
    },
    {
      name: "phase06-mobile-chromium",
      testMatch: /browser-contract\.spec\.js/,
      use: { ...devices["Pixel 7"] }
    }
  ]
});

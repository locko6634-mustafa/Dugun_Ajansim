import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/phase06",
  testMatch: /browser-contract\.spec\.js/,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  outputDir: "test-results/phase06/channel-artifacts",
  reporter: "list",
  use: {
    baseURL: process.env.PHASE06_BASE_URL || "http://127.0.0.1:8186",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "stable-chrome", use: { channel: "chrome" } },
    { name: "stable-edge", use: { channel: "msedge" } }
  ]
});

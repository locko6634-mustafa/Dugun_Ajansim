import { test as base, expect } from "@playwright/test";

const safeRequestId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;

export const test = base.extend({
  browserGateAllowedHttp: [[], { option: true }],
  browserGateAllowedErrors: [[], { option: true }],
  browserGateAllowedPendingHosts: [[], { option: true }],
  browserGate: [
    async (
      { page, browserGateAllowedHttp, browserGateAllowedErrors, browserGateAllowedPendingHosts },
      use,
      testInfo
    ) => {
      const failures = [];
      const pending = new Map();
      const requestIds = new Set();
      const isAllowedPendingRequest = (request) => {
        try {
          const requestUrl = new URL(request.url());
          const hostname =
            requestUrl.hostname ||
            (requestUrl.protocol === "blob:" ? new URL(requestUrl.pathname).hostname : "");
          return browserGateAllowedPendingHosts.includes(hostname);
        } catch {
          return false;
        }
      };

      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !browserGateAllowedErrors.some((pattern) => new RegExp(pattern).test(message.text()))
        ) {
          failures.push(`console.error: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
      page.on("request", (request) => pending.set(request, Date.now()));
      page.on("requestfinished", (request) => pending.delete(request));
      page.on("requestfailed", (request) => {
        pending.delete(request);
        if (isAllowedPendingRequest(request)) return;
        failures.push(
          `requestfailed: ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText || "unknown"}`
        );
      });
      page.on("response", (response) => {
        const requestId = safeRequestId(
          response.headers()["x-correlation-id"] || response.headers()["x-request-id"]
        );
        if (requestId) requestIds.add(requestId);
        if (response.status() >= 400) {
          const signature = `${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`;
          if (!browserGateAllowedHttp.includes(signature)) {
            failures.push(`unexpected-http: ${signature}`);
          }
        }
      });

      await use({ failures, requestIds });

      if (!page.isClosed()) {
        await expect
          .poll(
            () => [...pending.keys()].filter((request) => !isAllowedPendingRequest(request)).length,
            { timeout: 5_000 }
          )
          .toBe(0)
          .catch(() => {});
      }
      for (const [request, startedAt] of pending) {
        if (isAllowedPendingRequest(request)) continue;
        failures.push(
          `pending-request: ${request.method()} ${new URL(request.url()).pathname} ${Date.now() - startedAt}ms`
        );
      }
      await testInfo.attach("sanitized-request-ids", {
        body: Buffer.from(JSON.stringify([...requestIds].sort(), null, 2)),
        contentType: "application/json"
      });
      expect(failures, "Global browser hata kapısı").toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };

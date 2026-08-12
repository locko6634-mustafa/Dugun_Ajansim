import { readFile, rm, writeFile } from "node:fs/promises";

const source = new URL("../test-results/phase06/network.raw.har", import.meta.url);
const target = new URL("../test-results/phase06/network.masked.har", import.meta.url);
const sensitiveHeaders = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "turnstile-token",
  "payment-flow-key"
]);

try {
  const har = JSON.parse(await readFile(source, "utf8"));
  for (const entry of har.log?.entries ?? []) {
    for (const side of [entry.request, entry.response]) {
      if (!side) continue;
      side.headers = (side.headers ?? []).map((header) =>
        sensitiveHeaders.has(String(header.name).toLowerCase())
          ? { ...header, value: "[MASKED]" }
          : header
      );
      delete side.cookies;
      delete side.postData;
      if (side.content) delete side.content.text;
    }
  }
  await writeFile(target, `${JSON.stringify(har)}\n`, "utf8");
  await rm(source);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

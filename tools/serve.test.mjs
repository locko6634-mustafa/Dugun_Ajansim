import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { createStaticServer, DEFAULT_HOST } from "./serve.mjs";

const server = createStaticServer();
let port;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: DEFAULT_HOST, port, path: pathname }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
  });
}

before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, DEFAULT_HOST, resolve);
  });
  const address = server.address();
  assert.equal(address.address, DEFAULT_HOST);
  port = address.port;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

test("statik sunucu yalnız yayımlanabilir ön yüz dosyalarını sunar", async () => {
  assert.equal(await request("/index.html"), 200);
  assert.equal(await request("/js/shared/runtime-config.js"), 200);
});

test("statik sunucu depo içi hassas ve kaynak yollarını reddeder", async () => {
  for (const pathname of [
    "/backend/package.json",
    "/backend/.env",
    "/.git/config",
    "/tools/serve.mjs",
    "/package.json",
    "/%2e%2e/package.json"
  ]) {
    assert.equal(await request(pathname), 404, pathname);
  }
});

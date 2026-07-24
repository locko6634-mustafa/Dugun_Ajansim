import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

test("Proje temel dosya ve klasör yapısı eksiksizdir", async () => {
  const requiredFiles = [
    "index.html",
    "css/styles.css",
    "js/app.js",
    "vendor/gsap.min.js",
    "vendor/ScrollTrigger.min.js",
    "run_server.bat",
    "sunucu_baslat.ps1",
    "AGENT.md",
    "package.json",
    "vercel.json"
  ];

  for (const file of requiredFiles) {
    const isPresent = await exists(file);
    assert.strictEqual(isPresent, true, `Gerekli dosya bulunamadı: ${file}`);
  }
});

test("AGENT.md sunucu, test ve git kurallarını içerir", async () => {
  const agentMd = await read("AGENT.md");
  assert.match(agentMd, /run_server\.bat/, "AGENT.md dosyası run_server.bat kullanımını şart koşmalıdır.");
  assert.match(agentMd, /DOĞRUDAN SUNUCU BAŞLATMAK KESİNLİKLE YASAKTIR/, "AGENT.md yasak sunucu başlatma kuralını içermelidir.");
  assert.match(agentMd, /http:\/\/localhost:8000/, "AGENT.md varsayılan port bilgisini içermelidir.");
  assert.match(agentMd, /Git Versiyon Kontrolü ve Push Kuralları/, "AGENT.md git commit ve push kurallarını içermelidir.");
  assert.match(agentMd, /ASCII Alfabe/, "AGENT.md İngilizce alfabe (ASCII) kuralını içermelidir.");
});

test("Sunucu başlatma scriptleri doğru yapılandırılmıştır", async () => {
  const batScript = await read("run_server.bat");
  assert.match(batScript, /sunucu_baslat\.ps1/, "run_server.bat dosyası sunucu_baslat.ps1 çağırmalıdır.");

  const psScript = await read("sunucu_baslat.ps1");
  assert.match(psScript, /8000/, "sunucu_baslat.ps1 8000 portunu hedeflemelidir.");
  assert.match(psScript, /Invoke-CimMethod/, "sunucu_baslat.ps1 WMI ile bağımsız süreç başlatmalıdır.");
});

test("vercel.json geçerli bir JSON ve Vercel statik yapılandırması içerir", async () => {
  const vercelContent = await read("vercel.json");
  const parsed = JSON.parse(vercelContent);
  assert.strictEqual(parsed.version, 2, "vercel.json version 2 olmalıdır.");
  assert.strictEqual(parsed.cleanUrls, true, "cleanUrls aktif olmalıdır.");
  assert.strictEqual(parsed.trailingSlash, false, "trailingSlash false olmalıdır.");
  assert.ok(Array.isArray(parsed.headers), "headers bir dizi olmalıdır.");
});

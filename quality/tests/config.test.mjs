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
    "package.json"
  ];

  for (const file of requiredFiles) {
    const isPresent = await exists(file);
    assert.strictEqual(isPresent, true, `Gerekli dosya bulunamadı: ${file}`);
  }
});

test("AGENT.md sunucu ve test kurallarını içerir", async () => {
  const agentMd = await read("AGENT.md");
  assert.match(agentMd, /run_server\.bat/, "AGENT.md dosyası run_server.bat kullanımını şart koşmalıdır.");
  assert.match(agentMd, /DOĞRUDAN SUNUCU BAŞLATMAK KESİNLİKLE YASAKTIR/, "AGENT.md yasak sunucu başlatma kuralını içermelidir.");
  assert.match(agentMd, /http:\/\/localhost:8000/, "AGENT.md varsayılan port bilgisini içermelidir.");
});

test("Sunucu başlatma scriptleri doğru yapılandırılmıştır", async () => {
  const batScript = await read("run_server.bat");
  assert.match(batScript, /sunucu_baslat\.ps1/, "run_server.bat dosyası sunucu_baslat.ps1 çağırmalıdır.");

  const psScript = await read("sunucu_baslat.ps1");
  assert.match(psScript, /8000/, "sunucu_baslat.ps1 8000 portunu hedeflemelidir.");
  assert.match(psScript, /Invoke-CimMethod/, "sunucu_baslat.ps1 WMI ile bağımsız süreç başlatmalıdır.");
});

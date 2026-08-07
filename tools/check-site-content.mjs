import { readFile } from "node:fs/promises";

const htmlFiles = ["index.html", "paketini-olustur.html"];
const regulatedDocumentFiles = [
  "kvkk-aydinlatma.html",
  "gizlilik-politikasi.html",
  "kullanim-sartlari.html"
];
const forbiddenMarketingClaims = [
  /Türkiye['’]nin En Kapsamlı/iu,
  /70\+\s*(?:Kişilik|Uzman)/iu,
  /1500(?:’den|\+|\s+fazla)/iu,
  /yüzlerce organizasyon/iu,
  /2018’den beri/iu,
  /2027 itibarıyla uluslararası/iu
];

const entries = await Promise.all(
  htmlFiles.map(async (file) => [
    file,
    await readFile(new URL(`../${file}`, import.meta.url), "utf8")
  ])
);
const failures = [];

for (const [file, content] of entries) {
  if (/©\s*\d{4}\s+Düğünajansım/u.test(content)) {
    failures.push(`${file}: copyright yılı sabit yazılmamalı`);
  }

  if (!content.includes("data-current-year")) {
    failures.push(`${file}: dinamik copyright yıl alanı eksik`);
  }
}

for (const pattern of forbiddenMarketingClaims) {
  if (pattern.test(entries[0][1])) {
    failures.push(`index.html: doğrulama kaynağı olmayan pazarlama iddiası bulundu (${pattern})`);
  }
}

for (const file of regulatedDocumentFiles) {
  const content = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  if (!/<time\b[^>]*datetime="\d{4}-\d{2}-\d{2}"/u.test(content)) {
    failures.push(`${file}: belge revizyon tarihi makinece okunabilir <time> alanında tutulmalı`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Site içeriği tarih ve pazarlama iddiası sözleşmesi doğrulandı.");
}

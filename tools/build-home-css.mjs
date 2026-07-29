import { readFile, writeFile } from "node:fs/promises";

const homeCssDirectory = new URL("../css/home/", import.meta.url);
const outputFile = new URL("styles.css", homeCssDirectory);
const sourceFiles = [
  "base.css",
  "package-invitation.css",
  "home.css",
  "gallery.css",
  "shoots.css",
  "services.css",
  "venues.css",
  "faq.css",
  "footer.css",
  "responsive.css",
  "motion.css"
];

const sections = await Promise.all(
  sourceFiles.map(async (fileName) => {
    const css = await readFile(new URL(fileName, homeCssDirectory), "utf8");
    return `/* Kaynak: ${fileName} */\n\n${css.trim()}`;
  })
);

const banner = "/* Otomatik uretilir: npm run build:css. Kaynak modulleri dogrudan duzenleyin. */";
await writeFile(outputFile, `${banner}\n\n${sections.join("\n\n")}\n`, "utf8");

console.log(`Ana sayfa CSS paketi olusturuldu: ${sourceFiles.length} modul.`);

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

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*([\{\}\:\;\,\>\+\~])\s*/g, "$1")
    .replace(/;;+/g, ";")
    .replace(/;}/g, "}")
    .trim();
}

const minified = minifyCss(sections.join("\n"));
const banner = "/* Otomatik uretilir: npm run build:css */";
await writeFile(outputFile, `${banner}${minified}\n`, "utf8");

console.log(`Ana sayfa CSS paketi olusturuldu ve minified edildi: ${sourceFiles.length} modul.`);

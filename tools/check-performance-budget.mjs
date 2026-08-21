import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const homeCss = await readFile("css/home/site.css", "utf8");
const images = [...html.matchAll(/<img\b[^>]*>/gi)];
const videos = [...html.matchAll(/<video\b[^>]*>/gi)];
const missingDimensions = images.filter(
  (match) => !/\bwidth\s*=/.test(match[0]) || !/\bheight\s*=/.test(match[0])
);
const lazyCount = images.filter((match) => /\bloading\s*=\s*["']lazy["']/i.test(match[0])).length;

const failures = [];
if (images.length > 40) failures.push(`index.html: ${images.length} img etiketi (butce: 40)`);
if (missingDimensions.length > 0)
  failures.push(`${missingDimensions.length} gorselde width/height eksik`);
if (videos.length > 5) failures.push(`index.html: ${videos.length} video etiketi (butce: 5)`);
if (/<source\b[^>]*\ssrc=["'][^"']+\.mp4/i.test(html))
  failures.push("Video kaynaklari ilk HTML yuklemesinde etkin");
if (videos.some((match) => !/\bpreload=["']none["']/i.test(match[0])))
  failures.push("Tum videolar preload=none kullanmiyor");
if (/@import\s+/i.test(homeCss)) failures.push("Ana CSS paketinde render-blocking @import var");
if (
  !/<img\b[^>]*\bsrc=["']assets\/images\/hero-team\.webp["'][^>]*\bfetchpriority=["']high/i.test(
    html
  )
)
  failures.push("Hero LCP gorselinde yuksek indirme onceligi eksik");
if (lazyCount < Math.max(0, images.length - 3))
  failures.push(`lazy loading kapsami yetersiz (${lazyCount}/${images.length})`);

if (failures.length) {
  console.error("Performans butcesi asildi:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Performans butcesi basarili.");
}

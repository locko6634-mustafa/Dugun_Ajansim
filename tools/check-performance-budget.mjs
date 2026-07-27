import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
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
if (videos.length > 3) failures.push(`index.html: ${videos.length} video etiketi (butce: 3)`);
if (lazyCount < Math.max(0, images.length - 3))
  failures.push(`lazy loading kapsami yetersiz (${lazyCount}/${images.length})`);

if (failures.length) {
  console.error("Performans butcesi asildi:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Performans butcesi basarili.");
}

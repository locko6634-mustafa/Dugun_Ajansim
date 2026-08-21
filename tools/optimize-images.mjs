import { stat, writeFile, readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(__dirname, "..", "assets", "images");

async function optimizeImage(filePath, maxWidth = null, quality = 78) {
  try {
    const origBuffer = await readFile(filePath);
    const origSize = origBuffer.length;

    let pipeline = sharp(origBuffer);
    const metadata = await pipeline.metadata();

    if (maxWidth && metadata.width > maxWidth) {
      pipeline = pipeline.resize({ width: maxWidth });
    }

    const outputBuffer = await pipeline.webp({ quality, effort: 6 }).toBuffer();
    await writeFile(filePath, outputBuffer);

    const newStat = await stat(filePath);
    const savings = origSize - newStat.size;
    console.log(
      `Optimized ${filePath}: ${(origSize / 1024).toFixed(1)} KiB -> ${(newStat.size / 1024).toFixed(1)} KiB (Saved ${(savings / 1024).toFixed(1)} KiB)`
    );
  } catch (err) {
    console.error(`Error optimizing ${filePath}:`, err.message);
  }
}

async function processDirectory(dirPath, options = {}) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isFile() && entry.name.endsWith(".webp")) {
      await optimizeImage(fullPath, options.maxWidth, options.quality || 78);
    }
  }
}

async function main() {
  const rules = {
    "hero-team.webp": { maxWidth: 1200, quality: 78 },
    "hero-couple.webp": { maxWidth: 650, quality: 76 },
    "venue-pavilion.webp": { maxWidth: 400, quality: 76 },
    "bride-portrait.webp": { maxWidth: 380, quality: 76 },
    "groom-portrait.webp": { maxWidth: 400, quality: 76 },
    "why-beauty-studio.webp": { maxWidth: 700, quality: 76 },
    "why-bridal-showroom.webp": { maxWidth: 700, quality: 76 },
    "why-digital-delivery.webp": { maxWidth: 700, quality: 76 }
  };

  for (const [filename, opts] of Object.entries(rules)) {
    const path = join(imagesDir, filename);
    await optimizeImage(path, opts.maxWidth, opts.quality);
  }

  await processDirectory(join(imagesDir, "services"), { maxWidth: 700, quality: 78 });
  await processDirectory(join(imagesDir, "venues"), { maxWidth: 650, quality: 78 });

  const gardenMappings = {
    "bella.webp": "bella-garden.webp",
    "rena.webp": "rena-garden.webp",
    "talia.webp": "talia-garden.webp"
  };

  const venuesDir = join(imagesDir, "venues");
  for (const [srcName, targetName] of Object.entries(gardenMappings)) {
    const srcPath = join(venuesDir, srcName);
    const targetPath = join(venuesDir, targetName);
    await optimizeImage(srcPath, 500, 78);
    const srcBuffer = await readFile(srcPath);
    const buffer = await sharp(srcBuffer).resize({ width: 500 }).webp({ quality: 78 }).toBuffer();
    await writeFile(targetPath, buffer);
    const s = await stat(targetPath);
    console.log(`Generated garden poster: ${targetPath} (${(s.size / 1024).toFixed(1)} KiB)`);
  }
}

main();

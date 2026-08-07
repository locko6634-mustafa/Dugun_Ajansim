import { readdir, readFile } from "node:fs/promises";
import { extname } from "node:path";

const projectRoot = new URL("../", import.meta.url);
const javascriptRoot = new URL("../js/", import.meta.url);
const manualVersionPattern = /\?v=[^"'`\s)>]+/gu;

const rootEntries = await readdir(projectRoot, { withFileTypes: true });
const htmlFiles = rootEntries
  .filter((entry) => entry.isFile() && extname(entry.name) === ".html")
  .map((entry) => entry.name);

const collectJavaScriptFiles = async (directory, prefix = "js") => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(
        ...(await collectJavaScriptFiles(new URL(`${entry.name}/`, directory), relativePath))
      );
    } else if (entry.isFile() && extname(entry.name) === ".js") {
      files.push(relativePath);
    }
  }

  return files;
};

const sourceFiles = [...htmlFiles, ...(await collectJavaScriptFiles(javascriptRoot))];
const failures = [];

for (const file of sourceFiles) {
  const content = await readFile(new URL(file, projectRoot), "utf8");
  const manualVersions = [...content.matchAll(manualVersionPattern)];

  for (const match of manualVersions) {
    const line = content.slice(0, match.index).split("\n").length;
    failures.push(`${file}:${line}: manuel asset sürümü kaldırılmalı (${match[0]})`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Asset URL'leri merkezi Nginx cache sözleşmesiyle uyumlu.");
}

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const CACHE_FILE = resolve(ROOT, "node_modules", ".cache", "agent-check", "success.json");
const npmCli =
  process.env.npm_execpath ??
  resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

export const BUDGETS_MS = Object.freeze({
  docs: 60_000,
  static: 180_000,
  e2e: 180_000,
  backend: 240_000
});

const FRONTEND_EXTENSIONS = /\.(?:html|css|js|mjs)$/;
const DOC_EXTENSIONS = /\.(?:md|txt)$/;
const BACKEND_UNIT_PATTERN = "backend-unit";
const AUTH_PATTERN = "auth";

function command(id, cwd, args, budget, cache = true) {
  return { id, cwd, executable: process.execPath, args: [npmCli, ...args], budget, cache };
}

export function classifyChanges(files) {
  const normalized = files.map((file) => file.replaceAll("\\", "/"));
  const categories = new Set();

  for (const file of normalized) {
    if (DOC_EXTENSIONS.test(file) || file === "AGENT.md") categories.add("docs");
    else if (file.startsWith("backend/prisma/") || file === "backend/compose.test.yaml")
      categories.add("backend-db");
    else if (
      file === "backend/src/routes/auth.routes.ts" ||
      /^backend\/src\/(?:auth|security)\//.test(file) ||
      /^backend\/src\/middlewares\/(?:auth|security|rateLimit)\.middleware\.ts$/.test(file) ||
      file === "backend/src/middlewares/databaseRateLimitStore.ts"
    )
      categories.add("backend-auth");
    else if (file.startsWith("backend/") && /\.(?:ts|json)$/.test(file))
      categories.add("backend-unit");
    else if (/^(?:admin\.html|css\/admin|js\/admin\/)/.test(file)) categories.add("admin");
    else if (/^(?:css\/|.*\.html$|tests\/e2e\/smoke)/.test(file)) categories.add("responsive");
    else if (
      FRONTEND_EXTENSIONS.test(file) ||
      file === "package.json" ||
      file === "playwright.config.js"
    )
      categories.add("frontend");
    else categories.add("unknown");
  }

  return categories;
}

export function createPlan(files) {
  const categories = classifyChanges(files);
  const plan = [];
  const onlyDocs = categories.size === 1 && categories.has("docs");

  if (onlyDocs) {
    plan.push(
      command("docs-format", ROOT, ["exec", "--", "prettier", "--check", ...files], BUDGETS_MS.docs)
    );
    return plan;
  }

  if (
    [...categories].some((item) => ["frontend", "responsive", "admin", "unknown"].includes(item))
  ) {
    plan.push(command("frontend-static", ROOT, ["run", "validate:frontend"], BUDGETS_MS.static));
  }

  if (categories.has("admin")) {
    plan.push(
      command(
        "admin-e2e",
        ROOT,
        [
          "run",
          "test:targeted",
          "--",
          "tests/e2e/smoke.spec.js",
          "--grep",
          "@frontend-smoke",
          "--project=chromium"
        ],
        BUDGETS_MS.e2e
      )
    );
  }
  if (categories.has("responsive") || categories.has("unknown")) {
    plan.push(
      command(
        "responsive-e2e",
        ROOT,
        [
          "run",
          "test:targeted",
          "--",
          "tests/e2e/smoke.spec.js",
          "--grep",
          "@responsive",
          "--project=chromium",
          "--project=mobile-chromium"
        ],
        BUDGETS_MS.e2e
      )
    );
  } else if (categories.has("frontend") && !categories.has("admin")) {
    plan.push(
      command(
        "frontend-smoke",
        ROOT,
        [
          "run",
          "test:targeted",
          "--",
          "tests/e2e/smoke.spec.js",
          "--grep",
          "@frontend-smoke",
          "--project=chromium"
        ],
        BUDGETS_MS.e2e
      )
    );
  }

  if ([...categories].some((item) => item.startsWith("backend-") || item === "unknown")) {
    const pattern =
      categories.has("backend-auth") || categories.has("backend-db") || categories.has("unknown")
        ? AUTH_PATTERN
        : BACKEND_UNIT_PATTERN;
    plan.push(
      command("backend-build", resolve(ROOT, "backend"), ["run", "build"], BUDGETS_MS.backend)
    );
    plan.push(
      command(
        "backend-test-types",
        resolve(ROOT, "backend"),
        ["run", "typecheck:tests"],
        BUDGETS_MS.backend
      )
    );
    plan.push(
      command(
        "backend-targeted",
        resolve(ROOT, "backend"),
        [
          "run",
          "test:targeted",
          "--",
          `--test-name-pattern=${pattern}`,
          "tests/backend.test.ts",
          "tests/mvp.test.ts"
        ],
        BUDGETS_MS.backend
      )
    );
  }

  return plan;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} başarısız oldu`);
  return result.stdout;
}

function changedFiles() {
  const tracked = git(["diff", "--name-only", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/).filter(Boolean))];
}

export function filesForCommand(commandId, files) {
  if (commandId.startsWith("backend-")) return files.filter((file) => file.startsWith("backend/"));
  if (commandId === "docs-format") return files.filter((file) => DOC_EXTENSIONS.test(file));
  return files.filter((file) => !file.startsWith("backend/") && !DOC_EXTENSIONS.test(file));
}

function fingerprint(files, commandId) {
  const hash = createHash("sha256");
  hash.update(git(["rev-parse", "HEAD"]).trim());
  for (const file of filesForCommand(commandId, files).toSorted()) {
    hash.update(file);
    const path = resolve(ROOT, file);
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

function loadCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
}

export function infrastructureEvidence(output) {
  return /EADDRINUSE|browser.*(?:closed|disconnected)|ECONNRESET|connection.*reset/i.test(output);
}

function terminateTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    child.kill("SIGKILL");
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

export async function runOnce(item) {
  const started = Date.now();
  let output = "";
  let timedOut = false;
  const child = spawn(item.executable, item.args, {
    cwd: item.cwd,
    env: { ...process.env, FORCE_COLOR: "0" },
    detached: process.platform !== "win32",
    stdio: ["inherit", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });
  const exitCode = await new Promise((resolveExit) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveExit(code ?? 1);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTree(child);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish(1);
    }, item.budget);
    child.once("error", () => finish(1));
    child.once("close", finish);
  });
  return { exitCode, timedOut, output, duration: Date.now() - started };
}

async function run(item) {
  let result = await runOnce(item);
  if (result.timedOut && infrastructureEvidence(result.output)) {
    console.error(`\n${item.id}: altyapı belirtisi bulundu; tek kontrollü tekrar yapılıyor.`);
    result = await runOnce(item);
  }
  return result;
}

export function createCacheKey(stateKey, item) {
  return createHash("sha256")
    .update(`${stateKey}:${item.id}:${item.args.join("\0")}`)
    .digest("hex");
}

async function main() {
  const files = changedFiles();
  if (files.length === 0) {
    console.log("Değişen dosya yok; hızlı kontrol çalıştırılmadı.");
    return;
  }

  const plan = createPlan(files);
  const cache = loadCache();
  const summary = [];

  console.log(`Değişiklikler: ${files.join(", ")}`);
  console.log(`Seçilen kontroller: ${plan.map((item) => item.id).join(", ")}`);

  for (const item of plan) {
    const stateKey = fingerprint(files, item.id);
    const cacheKey = createCacheKey(stateKey, item);
    if (item.cache && cache[cacheKey]) {
      summary.push({ id: item.id, status: "önbellekten geçti", duration: 0 });
      continue;
    }
    const result = await run(item);
    summary.push({
      id: item.id,
      status:
        result.exitCode === 0 && !result.timedOut
          ? "geçti"
          : result.timedOut
            ? "zaman aşımı"
            : "başarısız",
      duration: result.duration
    });
    if (result.exitCode !== 0 || result.timedOut) {
      console.table(summary);
      process.exitCode = 1;
      return;
    }
    cache[cacheKey] = { completedAt: new Date().toISOString() };
    saveCache(cache);
  }

  console.table(summary);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

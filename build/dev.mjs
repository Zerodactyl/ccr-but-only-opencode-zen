import esbuild from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  cliSourceRoot,
  copyModelCatalog,
  coreSourceRoot,
  createCliBuildOptions,
  ensureDist,
  modelCatalogInput,
  projectRoot,
  watchPlugin
} from "./esbuild.config.mjs";

const ignoredSignatureEntries = new Set([".DS_Store"]);
const watchSignatures = new Map();
let styleBuildTimer = null;
const styleBuildDelayMs = 160;
const stylePollIntervalMs = 1000;
let styleBuildInFlight = false;
let queuedStyleBuildReason = null;
const coreSharedSourceRoot = path.join(coreSourceRoot, "shared");
const styleWatchRoots = [coreSharedSourceRoot].filter((watchRoot) => existsSync(watchRoot));

function parseDevTarget(args) {
  const target = args[0] ?? "cli";
  if (target === "--help" || target === "-h") {
    console.log("Usage: node build/dev.mjs [cli]");
    process.exit(0);
  }
  if (target === "cli") {
    return target;
  }
  console.error(`Unknown dev target "${target}". Expected cli.`);
  process.exit(2);
}

function logDev(message) {
  console.log(`[dev] ${new Date().toISOString()} ${message}`);
}

function relativePath(file) {
  return path.relative(projectRoot, file) || ".";
}

function contentSignature(targetPath) {
  return readContentSignature(targetPath);
}

function readContentSignature(targetPath) {
  if (!existsSync(targetPath)) {
    return { key: "missing", summary: "missing" };
  }
  const stats = statSync(targetPath);
  if (stats.isDirectory()) {
    return directorySignature(targetPath);
  }
  const content = readFileSync(targetPath);
  const hash = createHash("sha1").update(content).digest("hex").slice(0, 12);
  return { key: `file:${hash}`, summary: `size=${stats.size} sha1=${hash}` };
}

function directorySignature(targetPath) {
  const files = listDirectoryFiles(targetPath);
  const hash = createHash("sha1");
  let newestMtimeMs = 0;
  for (const file of files) {
    const absolutePath = path.join(targetPath, file);
    const stats = statSync(absolutePath);
    newestMtimeMs = Math.max(newestMtimeMs, stats.mtimeMs);
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }
  const digest = hash.digest("hex").slice(0, 12);
  return { key: `dir:${digest}`, summary: `files=${files.length} newestMtime=${newestMtimeMs} sha1=${digest}` };
}

function listDirectoryFiles(targetPath, basePath = targetPath) {
  const entries = readdirSync(targetPath, { withFileTypes: true })
    .filter((entry) => !ignoredSignatureEntries.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(targetPath, entry.name);
    const relative = path.relative(basePath, absolutePath);
    if (entry.isDirectory()) {
      files.push(...listDirectoryFiles(absolutePath, basePath));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function rememberWatchSignature(label, targetPath, options = {}) {
  const signature = options.metadataOnly ? metadataSignature(targetPath) : contentSignature(targetPath);
  watchSignatures.set(label, signature.key);
  logDev(`watch baseline: ${label} ${relativePath(targetPath)}; ${signature.summary}`);
}

function metadataSignature(targetPath) {
  if (!existsSync(targetPath)) {
    return { key: "missing", summary: "missing" };
  }
  const stats = statSync(targetPath);
  return { key: `metadata:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`, summary: `size=${stats.size}` };
}

function pollSourceWatchTargets() {
  if (existsSync(modelCatalogInput)) {
    pollWatchedInput("model catalog", modelCatalogInput, copyModelCatalog, { metadataOnly: true });
  }
}

function pollStyleWatchRoots() {
  for (const styleWatchRoot of styleWatchRoots) {
    const label = `styles ${relativePath(styleWatchRoot)}`;
    const signature = contentSignature(styleWatchRoot);
    const previousSignature = watchSignatures.get(label);
    if (previousSignature === signature.key) {
      continue;
    }
    watchSignatures.set(label, signature.key);
    logDev(`watch event: ${label}; ${signature.summary}; content=changed`);
  }
}

function pollWatchedInput(label, targetPath, onChange, options = {}) {
  const signature = options.metadataOnly ? metadataSignature(targetPath) : contentSignature(targetPath);
  const previousSignature = watchSignatures.get(label);
  if (previousSignature === signature.key) {
    return;
  }
  watchSignatures.set(label, signature.key);
  logDev(`watch event: ${label} ${relativePath(targetPath)}; ${signature.summary}; content=changed`);
  try {
    onChange();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDev(`watch action failed: ${label}; ${message}`);
  }
}

const devTarget = parseDevTarget(process.argv.slice(2));
logDev(`starting dev build target=${devTarget} (CLI only)`);
ensureDist();
copyModelCatalog();

for (const styleWatchRoot of styleWatchRoots) {
  rememberWatchSignature(`styles ${relativePath(styleWatchRoot)}`, styleWatchRoot);
}
if (existsSync(modelCatalogInput)) {
  rememberWatchSignature("model catalog", modelCatalogInput, { metadataOnly: true });
}

const sourcePoller = setInterval(() => {
  pollStyleWatchRoots();
  pollSourceWatchTargets();
}, stylePollIntervalMs);

const contexts = [];
contexts.push(
  await esbuild.context(
    createCliBuildOptions({
      mode: "development",
      plugins: [watchPlugin("cli", (name) => logDev(`build ready: ${name}`))]
    })
  )
);

await Promise.all(contexts.map((context) => context.watch()));
logDev("watchers are active");

async function shutdown() {
  logDev("shutting down dev build");
  if (styleBuildTimer) {
    clearTimeout(styleBuildTimer);
  }
  clearInterval(sourcePoller);
  await Promise.all(contexts.map((context) => context.dispose()));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

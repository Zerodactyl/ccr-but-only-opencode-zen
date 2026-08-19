import esbuild from "esbuild";
import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);

export const projectRoot = path.resolve(__dirname, "..");
export const packagesRoot = path.join(projectRoot, "packages");
export const cliRoot = path.join(packagesRoot, "cli");
export const coreRoot = path.join(packagesRoot, "core");
export const cliSourceRoot = path.join(cliRoot, "src");
export const coreSourceRoot = path.join(coreRoot, "src");
export const cliDistDir = path.join(cliRoot, "dist");
export const coreDistDir = path.join(coreRoot, "dist");
export const cliMainOutDir = path.join(cliDistDir, "main");
export const coreMainOutDir = path.join(coreDistDir, "main");
export const gatewayPackageRoot = path.dirname(requireFromHere.resolve("@the-next-ai/ai-gateway/package.json"));
export const gatewayRuntimeInput = requireFromHere.resolve("@the-next-ai/ai-gateway/bin/next-ai-gateway.js");
export const modelCatalogInput = path.join(coreRoot, "models.json");
export const cliModelCatalogOutput = path.join(cliDistDir, "models.json");
export const coreModelCatalogOutput = path.join(coreDistDir, "models.json");
export const botGatewaySdkPackageRoot = path.dirname(requireFromHere.resolve("@the-next-ai/bot-gateway-sdk/package.json"));
export const botGatewaySdkEntryInput = path.join(botGatewaySdkPackageRoot, "dist", "index.js");
export const electronUndiciProxyAgentInput = path.join(coreSourceRoot, "proxy", "undici-proxy-agent.ts");
export const localAgentAuthProviderHookInput = path.join(coreSourceRoot, "gateway", "core-runtime", "local-agent-auth-provider-hook.ts");
export const upstreamHeaderSanitizerInput = path.join(coreSourceRoot, "gateway", "core-runtime", "upstream-header-sanitizer.ts");
const lightweightMcpBundleNames = ["browser-web-search-proxy-mcp.js", "fusion-vision-mcp.js", "fusion-tool-fallback-mcp.js", "media-tools-proxy-mcp.js"];
const lightweightMcpBundleMaxBytes = 128 * 1024;
const forbiddenLightweightMcpInputs = [
  { prefix: "packages/core/src/config/", reason: "config modules can pull in native storage side effects" },
  { prefix: "packages/core/src/storage/", reason: "native SQLite storage is not allowed in lightweight MCP subprocesses" },
  { prefix: "node_modules/better-sqlite3/", reason: "native SQLite is not allowed in lightweight MCP subprocesses" }
];
const forbiddenLightweightMcpExternalImports = new Set(["better-sqlite3"]);

const nodeExternals = [
  "electron",
  "better-sqlite3",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
];

export function cleanDist() {
  rmSync(cliDistDir, { force: true, recursive: true });
  rmSync(coreDistDir, { force: true, recursive: true });
  ensureDist();
}

export function ensureDist() {
  mkdirSync(cliMainOutDir, { recursive: true });
  mkdirSync(coreMainOutDir, { recursive: true });
}

export function copyModelCatalog() {
  ensureDist();
  if (existsSync(modelCatalogInput)) {
    cpSync(modelCatalogInput, cliModelCatalogOutput);
    cpSync(modelCatalogInput, coreModelCatalogOutput);
  }
}

function normalizeDuplicateShebangs(source) {
  const lines = source.split("\n");
  if (!lines[0]?.startsWith("#!")) {
    return source;
  }
  let index = 1;
  while (lines[index]?.startsWith("#!")) {
    index += 1;
  }
  return [lines[0], ...lines.slice(index)].join("\n");
}

export function createCliBuildOptions({ mode = "production", plugins = [] } = {}) {
  return {
    absWorkingDir: projectRoot,
    bundle: true,
    entryNames: "[name]",
    entryPoints: [
      path.join(cliSourceRoot, "cli.ts"),
      path.join(coreSourceRoot, "gateway", "core-runtime", "gateway-bootstrap.ts"),
      path.join(coreSourceRoot, "mcp", "fusion-vision-mcp.ts"),
      path.join(coreSourceRoot, "mcp", "fusion-tool-fallback-mcp.ts"),
      path.join(coreSourceRoot, "mcp", "media-tools-proxy-mcp.ts"),
      path.join(coreSourceRoot, "mcp", "toolhub-mcp.ts"),
      path.join(coreSourceRoot, "observability", "request-log-worker.ts"),
      path.join(coreSourceRoot, "routing", "route-script-worker.ts"),
      localAgentAuthProviderHookInput,
      upstreamHeaderSanitizerInput
    ],
    external: nodeExternals.filter((moduleName) => moduleName !== "electron"),
    format: "cjs",
    legalComments: "none",
    logLevel: "info",
    minify: mode === "production",
    outdir: cliMainOutDir,
    platform: "node",
    plugins: [forbidCliElectronPlugin(), packageAliasPlugin(), ...plugins],
    sourcemap: mode !== "production",
    target: "node22"
  };
}

export function createCoreServerBuildOptions({ mode = "production", plugins = [] } = {}) {
  return {
    absWorkingDir: projectRoot,
    bundle: true,
    entryNames: "[name]",
    entryPoints: [
      path.join(coreSourceRoot, "entrypoints", "headless.ts"),
      path.join(coreSourceRoot, "gateway", "core-runtime", "gateway-bootstrap.ts"),
      path.join(coreSourceRoot, "mcp", "fusion-vision-mcp.ts"),
      path.join(coreSourceRoot, "mcp", "fusion-tool-fallback-mcp.ts"),
      path.join(coreSourceRoot, "mcp", "media-tools-proxy-mcp.ts"),
      path.join(coreSourceRoot, "mcp", "toolhub-mcp.ts"),
      path.join(coreSourceRoot, "observability", "request-log-worker.ts"),
      path.join(coreSourceRoot, "routing", "route-script-worker.ts"),
      localAgentAuthProviderHookInput,
      upstreamHeaderSanitizerInput
    ],
    external: nodeExternals.filter((moduleName) => moduleName !== "electron"),
    format: "cjs",
    legalComments: "none",
    logLevel: "info",
    minify: mode === "production",
    outdir: coreMainOutDir,
    platform: "node",
    plugins: [forbidCliElectronPlugin(), packageAliasPlugin(), ...plugins],
    sourcemap: mode !== "production",
    target: "node22"
  };
}

export function watchPlugin(name, onEnd) {
  return {
    name: `${name}-watch`,
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) {
          onEnd(name);
        }
      });
    }
  };
}

export async function buildCli(options = {}) {
  await esbuild.build(createCliBuildOptions(options));
  const cliRuntime = path.join(cliMainOutDir, "cli.js");
  if (existsSync(cliRuntime)) {
    chmodSync(cliRuntime, 0o755);
  }
}

export async function buildCoreServer(options = {}) {
  await esbuild.build(createCoreServerBuildOptions(options));
}

export function binPath(name) {
  const extension = process.platform === "win32" ? ".cmd" : "";
  return path.join(projectRoot, "node_modules", ".bin", `${name}${extension}`);
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

function packageAliasPlugin() {
  return {
    name: "ccr-package-alias",
    setup(build) {
      build.onResolve({ filter: /^@ccr\/cli\// }, (args) => {
        return { path: resolvePackageImport(cliSourceRoot, args.path.slice("@ccr/cli/".length)) };
      });
      build.onResolve({ filter: /^@ccr\/core\// }, (args) => {
        return { path: resolvePackageImport(coreSourceRoot, args.path.slice("@ccr/core/".length)) };
      });
    }
  };
}

function forbidCliElectronPlugin() {
  return {
    name: "forbid-cli-electron",
    setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => {
        return {
          errors: [
            {
              text: "CLI bundle must not import electron. Move the dependency behind a desktop-only boundary."
            }
          ]
        };
      });
    }
  };
}

function validateLightweightMcpBundles(metafile) {
  if (!metafile) {
    return;
  }

  const outputsByName = new Map(
    Object.entries(metafile.outputs).map(([outputPath, output]) => [path.basename(outputPath), { output, outputPath }])
  );

  for (const bundleName of lightweightMcpBundleNames) {
    const entry = outputsByName.get(bundleName);
    if (!entry) {
      continue;
    }

    const violations = [];
    if (entry.output.bytes > lightweightMcpBundleMaxBytes) {
      violations.push(`bundle size ${entry.output.bytes} bytes exceeds ${lightweightMcpBundleMaxBytes} bytes`);
    }

    for (const inputPath of Object.keys(entry.output.inputs ?? {})) {
      const normalizedInput = normalizeBuildPath(inputPath);
      for (const rule of forbiddenLightweightMcpInputs) {
        if (normalizedInput.startsWith(rule.prefix)) {
          violations.push(`${normalizedInput} (${rule.reason})`);
        }
      }
    }

    for (const imported of entry.output.imports ?? []) {
      if (imported.external && forbiddenLightweightMcpExternalImports.has(imported.path)) {
        violations.push(`${imported.path} (external native/runtime dependency is not allowed)`);
      }
    }

    if (violations.length > 0) {
      throw new Error([
        `Lightweight MCP bundle ${bundleName} crossed its dependency boundary.`,
        ...violations.map((violation) => `- ${violation}`)
      ].join("\n"));
    }
  }
}

function normalizeBuildPath(value) {
  return value.split(path.sep).join("/");
}

function resolvePackageImport(rootDir, importPath) {
  const packageBasePath = path.resolve(rootDir, importPath);
  const candidates = [
    packageBasePath,
    `${packageBasePath}.tsx`,
    `${packageBasePath}.ts`,
    `${packageBasePath}.jsx`,
    `${packageBasePath}.js`,
    `${packageBasePath}.json`,
    path.join(packageBasePath, "index.tsx"),
    path.join(packageBasePath, "index.ts"),
    path.join(packageBasePath, "index.jsx"),
    path.join(packageBasePath, "index.js")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return packageBasePath;
}

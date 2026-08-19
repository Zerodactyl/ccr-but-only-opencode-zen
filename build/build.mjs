import { buildCli, buildCoreServer, cleanDist, copyModelCatalog } from "./esbuild.config.mjs";

const mode = process.argv.includes("--dev") ? "development" : "production";

cleanDist();
copyModelCatalog();

await Promise.all([
  buildCli({ mode }),
  buildCoreServer({ mode })
]);

console.log(`Built CLI and core packages in ${mode} mode.`);

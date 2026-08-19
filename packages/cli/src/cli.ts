import { createInterface } from "node:readline/promises";
import { loadAppConfig, saveAppConfig } from "@ccr/core/config/config";
import { applyProfileConfig, applyProfileRuntimeConfig } from "@ccr/core/profiles/service";
import { openProfileFromCcr } from "@ccr/core/profiles/launch-service";
import { defaultProfileOpenSurface, findProfileForOpen, resolveProfileOpenSurface } from "@ccr/core/profiles/launch-core";
import { startHeadlessRuntime } from "@ccr/core/headless/runtime";
import { assertAvailableGatewayModels, type GatewayProviderConfig, type ProfileOpenSurface } from "@ccr/core/contracts/app";
import { getProviderPresets } from "@ccr/core/providers/presets/index";

const defaultCliCommandName = "ccr-opz";

type CliOptions =
  | StartCliOptions
  | SetupCliOptions
  | ProfileCliOptions;

type StartCliOptions = {
  command: "start";
  help: boolean;
  port?: number;
};

type SetupCliOptions = {
  command: "setup";
  help: boolean;
};

type ProfileCliOptions = {
  agentArgs: string[];
  command: "profile";
  help: boolean;
  profileRef: string;
  surface?: ProfileOpenSurface;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "setup") {
    if (options.help) {
      printSetupHelp(0);
      return;
    }
    await runSetupWizard();
    return;
  }

  if (options.command === "start") {
    if (options.help) {
      printStartHelp(0);
      return;
    }
    await runGatewayForeground(options.port);
    return;
  }

  const profileOptions = options as ProfileCliOptions;
  if (profileOptions.help || !profileOptions.profileRef) {
    printHelp(profileOptions.help ? 0 : 2);
    return;
  }

  const config = await loadAppConfig();
  assertAvailableGatewayModels(config);
  await applyProfileConfig(config);
  const profile = findProfileForOpen(config, profileOptions.profileRef);
  const surface = profileOptions.surface ?? defaultProfileOpenSurface(profile);
  const resolvedSurface = resolveProfileOpenSurface(profile, surface);

  if (profile.agent === "claude-design") {
    throw new Error("Claude Design profiles can only be opened from CCR Desktop.");
  }
  if (profile.agent === "claude-code" && resolvedSurface === "app" && profileOptions.agentArgs.length > 0) {
    throw new Error("Claude App profiles do not support agent arguments.");
  }

  await startHeadlessRuntime({ startGateway: true });
  try {
    if (resolvedSurface === "cli") {
      const result = applyProfileRuntimeConfig(config, profile, config.APIKEY);
      if (!result.ok) {
        throw new Error(result.message);
      }
    }
    const opened = await openProfileFromCcr(config, { profileId: profile.id, surface });
    process.stdout.write(`${opened.message}\n`);
    return;
  } finally {
    if (resolvedSurface === "cli") {
      // The agent process inherits this process group; keep the gateway alive
      // for the agent to use, but release the runtime handle.
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  if (args[0] === "start") {
    return parseStartArgs(args.slice(1));
  }
  if (args[0] === "setup" || args[0] === "init") {
    return parseSetupArgs(args.slice(1));
  }

  const options: ProfileCliOptions = {
    agentArgs: [],
    command: "profile",
    help: false,
    profileRef: ""
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      options.agentArgs.push(...args.slice(index + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--app") {
      options.surface = "app";
      continue;
    }
    if (arg === "--cli") {
      options.surface = "cli";
      continue;
    }
    if (options.profileRef) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    options.profileRef = arg;
  }
  if (!options.profileRef && !options.help) {
    options.profileRef = "";
  }
  return options;
}

function parseStartArgs(args: string[]): StartCliOptions {
  const options: StartCliOptions = {
    command: "start",
    help: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
      continue;
    }
    if (arg === "--port") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--port requires a value");
      }
      options.port = parsePort(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown start option: ${arg}. Use --port=<port> or --help.`);
  }
  return options;
}

function parseSetupArgs(args: string[]): SetupCliOptions {
  const options: SetupCliOptions = {
    command: "setup",
    help: false
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown setup option: ${arg}`);
  }
  return options;
}

async function runGatewayForeground(port?: number): Promise<void> {
  const runtime = await startHeadlessRuntime({ startGateway: true, gatewayPort: port });
  process.stdout.write(`CCR gateway is running at ${runtime.url}\n`);
  process.stdout.write("Press Ctrl+C to stop.\n");

  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) {
      return;
    }
    closing = true;
    process.stdout.write("\nStopping CCR gateway...\n");
    void runtime.stop().finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await new Promise<void>(() => undefined);
}

async function runSetupWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("CCR setup — configure your gateway\n");
    process.stdout.write("===================================\n\n");

    const presets = getProviderPresets().filter((preset) => preset.id === "opencode-zen" || preset.id === "opencode-go");
    process.stdout.write("Available providers:\n");
    presets.forEach((preset, index) => {
      process.stdout.write(`  ${index + 1}. ${preset.name} (${preset.id})\n`);
    });

    const choice = (await rl.question(`Select provider [1-${presets.length}]: `)).trim();
    const choiceIndex = Number.parseInt(choice, 10) - 1;
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= presets.length) {
      throw new Error(`Invalid provider selection: ${choice}`);
    }
    const preset = presets[choiceIndex];

    const apiKey = (await rl.question(`API key for ${preset.name}: `)).trim();
    if (!apiKey) {
      throw new Error("API key is required.");
    }

    const defaultPort = 3456;
    const portInput = (await rl.question(`Gateway port [${defaultPort}]: `)).trim();
    const port = portInput ? parsePort(portInput) : defaultPort;

    const config = await loadAppConfig();
    const baseUrl = preset.endpoints[0]?.baseUrl ?? "";
    const models = preset.defaultModels ?? [];

    const providers = config.Providers.map((provider) => ({ ...provider }));
    const existingIndex = providers.findIndex((provider) => provider.name === preset.id || provider.id === preset.id);
    const updatedProvider: GatewayProviderConfig = {
      ...(existingIndex >= 0 ? providers[existingIndex] : { name: preset.id, id: preset.id, models: [] }),
      enabled: true,
      apiKey,
      api_key: apiKey,
      baseUrl: baseUrl || undefined,
      api_base_url: baseUrl || undefined,
      models: models.length ? models : existingIndex >= 0 ? providers[existingIndex].models : [],
      protocolDetectionMode: "auto"
    };
    if (existingIndex >= 0) {
      providers[existingIndex] = updatedProvider;
    } else {
      providers.push(updatedProvider);
    }

    config.Providers = providers;
    config.preferredProvider = preset.id;
    config.APIKEY = apiKey;
    config.gateway = { ...config.gateway, port };
    config.PORT = port;

    await saveAppConfig(config);

    process.stdout.write("\nConfiguration saved.\n");
    process.stdout.write(`Next steps:\n`);
    process.stdout.write(`  ccr start          # run the gateway in the foreground\n`);
    process.stdout.write(`  ccr <profile>      # open an agent through the gateway\n`);
    process.stdout.write(`  ccr --help         # list available profiles\n`);
  } finally {
    rl.close();
  }
}

function printHelp(exitCode: number): void {
  const command = cliCommandName();
  const output = [
    "Usage:",
    `  ${command} setup`,
    `  ${command} start [--port <port>]`,
    `  ${command} <profile-name-or-id> [cli|app] [-- <agent args>]`,
    "",
    "Notes:",
    "  --cli and --app are alternatives to the positional profile surface.",
    "  Put agent-specific arguments after --.",
    "",
    "Examples:",
    `  ${command} setup`,
    `  ${command} start`,
    `  ${command} Codex`,
    `  ${command} default-codex -- --model gpt-5-codex`,
    `  ${command} default-codex app`
  ].join("\n");
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${output}\n`);
  process.exitCode = exitCode;
}

function printStartHelp(exitCode: number): void {
  const command = cliCommandName();
  const output = [
    "Usage:",
    `  ${command} start [--port <port>]`,
    "",
    "Starts the CCR model gateway in the foreground.",
    "",
    "Options:",
    "  --port <port>    Gateway port. Defaults to 3456.",
    "",
    "Environment:",
    "  CCR_GATEWAY_PORT    Default gateway port."
  ].join("\n");
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${output}\n`);
  process.exitCode = exitCode;
}

function printSetupHelp(exitCode: number): void {
  const command = cliCommandName();
  const output = [
    "Usage:",
    `  ${command} setup`,
    "",
    "Interactive wizard that configures a provider, API key, and gateway port."
  ].join("\n");
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${output}\n`);
  process.exitCode = exitCode;
}

function cliCommandName(): string {
  const configured = process.env.CCR_CLI_COMMAND_NAME?.trim();
  return configured && /^[A-Za-z0-9._-]+$/.test(configured) ? configured : defaultCliCommandName;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

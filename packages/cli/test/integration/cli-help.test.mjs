import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const cliRuntime = path.join(process.cwd(), ".test-dist", "cli", "runtime", "cli.js");

test("built CLI exposes package-owned help", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /ccr-opz setup/);
  assert.match(result.stdout, /ccr-opz <profile-name-or-id>/);
});

test("built CLI rejects invalid ports before starting services", () => {
  const result = runCli(["start", "--port", "invalid"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid port: invalid/);
});

test("every service command exposes its package-owned command help", () => {
  for (const [command, usage] of [
    ["start", /ccr-opz start/],
    ["setup", /ccr-opz setup/]
  ]) {
    const result = runCli([command, "--help"]);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, usage, command);
  }
});

test("built CLI rejects missing, out-of-range, and unknown service options", () => {
  const cases = [
    [["start", "--port", "0"], /Invalid port: 0/],
    [["start", "--port=65536"], /Invalid port: 65536/],
    [["start", "--unknown"], /Unknown start option: --unknown/]
  ];

  for (const [args, error] of cases) {
    const result = runCli(args);
    assert.equal(result.status, 1, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, error, args.join(" "));
  }
});

test("built CLI requires a profile reference when no command is supplied", () => {
  const result = runCli([]);

  assert.equal(result.status, 2, result.stderr);
  assert.match(`${result.stdout}${result.stderr}`, /ccr-opz <profile-name-or-id>/);
});

function runCli(args) {
  return spawnSync(process.execPath, [cliRuntime, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CCR_CLI_COMMAND_NAME: "ccr-opz"
    }
  });
}

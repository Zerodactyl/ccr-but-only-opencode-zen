<div align="center">

# CCR-OPZ

### A CLI-only LLM gateway router for coding agents.

Route Claude Code, Codex, OpenCode, and compatible API clients to **OpenCode Zen** or **OpenCode Go** from one command-line tool. No desktop app, no web UI, no Electron — just a headless gateway you start in your terminal.

<p>
  <a href="#quick-start"><img alt="Quick Start" src="https://img.shields.io/badge/Get_Started-Quick_Start-16A34A?style=for-the-badge&logo=rocket&logoColor=white" /></a>
  <a href="./docs/README.md"><img alt="Read the Docs" src="https://img.shields.io/badge/Explore-Documentation-0F172A?style=for-the-badge&logo=readthedocs&logoColor=white" /></a>
</p>

</div>

## Why CCR-OPZ?

CCR-OPZ is a fork of [Claude Code Router](https://github.com/musistudio/claude-code-router) trimmed down to a **pure CLI**. It runs a local model gateway that your coding agents talk to, and it supports exactly two providers:

| Provider | Base URL | Notes |
|----------|----------|-------|
| **OpenCode Zen** | `https://opencode.ai/zen/v1` | OpenAI-compatible v1 endpoint |
| **OpenCode Go** | `https://opencode.ai/zen/go/v1` | OpenAI-compatible v1 endpoint |

- Route requests from Claude Code, Codex, OpenCode, Pi, ZCode, and any OpenAI-compatible client.
- Fail over, extend, and observe every request from a single gateway.
- One interactive `ccr-opz setup` wizard to configure the provider, API key, and port.
- Headless: `ccr-opz start` runs the gateway in the foreground; `ccr-opz <profile>` opens an agent through it.

## Quick Start

```bash
# 1. Install (from source)
npm ci
npm run build
npm link            # or: npm install -g

# 2. Configure a provider
ccr-opz setup
#   → pick OpenCode Zen or OpenCode Go
#   → paste your API key
#   → choose a gateway port (default 3456)

# 3. Start the gateway
ccr-opz start
#   gateway listens at http://127.0.0.1:3456

# 4. Open an agent through the gateway
ccr-opz <profile-name-or-id>
```

## Commands

```
ccr-opz setup
ccr-opz start [--port <port>]
ccr-opz <profile-name-or-id> [cli|app] [-- <agent args>]
```

| Command | Description |
|---------|-------------|
| `ccr-opz setup` | Interactive wizard: provider, API key, gateway port. |
| `ccr-opz start` | Run the gateway in the foreground (Ctrl+C to stop). |
| `ccr-opz <profile>` | Open an agent profile through the gateway. |

### Environment

- `CCR_GATEWAY_PORT` — default gateway port (overrides the configured port for `start`).
- `CCR_CLI_COMMAND_NAME` — override the command name printed in help text.

## How it works

CCR-OPZ runs an in-process gateway — there is no background daemon and no HTTP control plane. `ccr-opz start` keeps the gateway in the foreground; `ccr-opz <profile>` opens an agent (the agent process inherits this process group and keeps the gateway alive for its own use). Point your coding agent's `baseUrl` at `http://127.0.0.1:3456` and its API key at the gateway key.

## Building from source

```bash
npm ci
npm run build      # build core + cli bundles
npm run typecheck  # tsc --noEmit
npm test           # run unit/integration tests
```

Node 22 is required.

## License

MIT — see [LICENSE](./LICENSE).

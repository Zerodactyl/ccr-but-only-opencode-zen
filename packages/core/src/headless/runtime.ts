/**
 * Headless runtime for the CLI control plane.
 *
 * This replaces the old web management server + HTTP RPC daemon. The CLI now
 * runs the gateway in-process: no background daemon, no HTTP control plane, no
 * browser UI. `ccr start` keeps the gateway in the foreground; `ccr <profile>`
 * opens an agent through `openProfileFromCcr` directly.
 */

import { gatewayService } from "@ccr/core/gateway/service";
import { stopProviderModelAutoRefreshService, syncProviderModelAutoRefreshService } from "@ccr/core/providers/model-auto-refresh";
import { proxyService } from "@ccr/core/proxy/service";
import { syncClaudeAppGatewayConfig, restoreClaudeAppGatewayConfig } from "@ccr/core/agents/claude-app/gateway-service";
import { applyProfileConfig } from "@ccr/core/profiles/service";
import { openProfileFromCcr } from "@ccr/core/profiles/launch-service";
import { loadAppConfig } from "@ccr/core/config/config";
import type { AppConfig, GatewayStatus, ProfileOpenRequest, ProfileOpenResult } from "@ccr/core/contracts/app";

export type HeadlessRuntimeOptions = {
  /** Start the gateway immediately (default true). */
  startGateway?: boolean;
  /** Override the gateway port; otherwise read from config. */
  gatewayPort?: number;
};

export type HeadlessRuntime = {
  /** The gateway control handle (start/stop/status/updateConfig). */
  gateway: typeof gatewayService;
  /** Open an agent profile through the running gateway. */
  openProfile: (request: ProfileOpenRequest) => Promise<ProfileOpenResult>;
  /** Idempotently ensure the gateway is running. */
  ensureGateway: () => Promise<GatewayStatus>;
  /** Stop the gateway and restore any host config (system proxy, Claude app). */
  stop: () => Promise<void>;
  /** Resolved gateway base URL (e.g. http://127.0.0.1:3456). */
  url: string;
};

function gatewayUrl(config: AppConfig, overridePort?: number): string {
  const port = overridePort ?? config.gateway.port ?? 3456;
  return `http://127.0.0.1:${port}`;
}

/**
 * Start configured services (gateway + proxy + model auto-refresh) in-process.
 * Mirrors the previous `startConfiguredServices` flow from the web server, but
 * without the HTTP layer.
 */
async function startConfiguredServices(reason: string, overridePort?: number): Promise<void> {
  const config = await loadAppConfig();
  try {
    const synced = await syncClaudeAppGatewayConfig(config);
    const effectiveConfig = synced.config ?? config;
    const status = await gatewayService.ensureStarted({ ...effectiveConfig, gateway: { ...effectiveConfig.gateway, port: overridePort ?? effectiveConfig.gateway.port } });
    if (status.state === "error") {
      console.error(`Failed to start gateway during ${reason}: ${status.lastError}`);
    }
    if (status.state === "running") {
      const result = await applyProfileConfig(effectiveConfig, { excludeAgents: ["zcode"] });
      if (result && "applied" in result && Array.isArray((result as { applied?: unknown[] }).applied)) {
        for (const entry of (result as { applied: Array<{ profileId: string; error?: string }> }).applied) {
          if (entry.error) {
            console.error(`Failed to apply profile ${entry.profileId}: ${entry.error}`);
          }
        }
      }
    }
    if (effectiveConfig.proxy.enabled && effectiveConfig.proxy.systemProxy) {
      const proxyStatus = await proxyService.ensureSystemProxyActive();
      if (proxyStatus.systemProxy.state !== "active") {
        const details = proxyStatus.systemProxy.lastError ? `: ${proxyStatus.systemProxy.lastError}` : "";
        console.error(`Proxy mode is enabled, but system proxy is ${proxyStatus.systemProxy.state} during ${reason}${details}`);
      }
    }
    syncProviderModelAutoRefreshService(effectiveConfig, {
      logger: console,
      onConfigChanged: async (nextConfig) => {
        await gatewayService.updateConfig(nextConfig);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start configured services during ${reason}: ${message}`);
  }
}

export async function startHeadlessRuntime(options: HeadlessRuntimeOptions = {}): Promise<HeadlessRuntime> {
  if (options.startGateway !== false) {
    await startConfiguredServices("cli startup", options.gatewayPort);
  }

  const config = await loadAppConfig();
  const url = gatewayUrl(config, options.gatewayPort);

  return {
    gateway: gatewayService,
    openProfile: (request: ProfileOpenRequest) => openProfileFromCcr(config, request),
    ensureGateway: async () => {
      const current = await loadAppConfig();
      return gatewayService.ensureStarted(current);
    },
    stop: async () => {
      stopProviderModelAutoRefreshService();
      await gatewayService.stop({ proxyRestoreTimeoutMs: 30_000 }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to stop gateway: ${message}`);
      });
      try {
        restoreClaudeAppGatewayConfig();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to restore Claude App gateway config: ${message}`);
      }
    },
    url
  };
}

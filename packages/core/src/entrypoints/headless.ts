/**
 * Core headless entry point.
 *
 * Provides the in-process gateway runtime used by the CLI. This exists so the
 * core package has a buildable entry that does not depend on the removed web
 * management server.
 */

export { startHeadlessRuntime } from "../headless/runtime";
export { gatewayService } from "../gateway/service";

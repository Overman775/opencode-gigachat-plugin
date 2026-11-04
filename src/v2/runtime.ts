import type { Plugin } from "@opencode/plugin";
import { GigaCodeAuthManager } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";
import { DEFAULT_ENDPOINT_PORT, INTEGRATION_ID } from "./constants.js";
import { startGigachatEndpoint } from "./endpoint.js";
import type { GigachatEndpoint } from "./endpoint.js";
import { KeyedLimiter, maxConcurrentPerAccount } from "./limiter.js";

/**
 * V2 runtime state.
 *
 * `setup(ctx)` runs once per location, so the auth manager, the local endpoint
 * and the last known context live in the module and are shared.
 */
export const authManager = new GigaCodeAuthManager();

/**
 * One queue per account, shared by the local endpoint and the image tool:
 * GigaChat rejects a second simultaneous call with 429.
 */
export const accountLimiter = new KeyedLimiter(maxConcurrentPerAccount());

let endpointPromise: Promise<GigachatEndpoint> | null = null;
let lastContext: Plugin.Context | null = null;

export function rememberContext(context: Plugin.Context): void {
  lastContext = context;
}

/** Working directory of the most recent location; used for tool output paths. */
export function lastDirectory(): string | undefined {
  return lastContext?.location.directory;
}

/** Endpoint port; fixed by default so a declared provider can point at it. */
export function preferredPort(): number {
  const raw = process.env.GIGACHAT_ENDPOINT_PORT;
  if (!raw) return DEFAULT_ENDPOINT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ENDPOINT_PORT;
}

/**
 * Reads the credential OpenCode stored for the provider.
 * Runs before every request, so a later `auth login` takes effect without a restart.
 */
export async function refreshCredentialsFromConnection(): Promise<void> {
  const context = lastContext;
  if (!context) return;
  try {
    const connection = await context.integration.connection.active(INTEGRATION_ID);
    if (!connection) return;
    if (connection.type === "env") {
      // Environment connections are read from the process environment directly.
      return;
    }
    // A single stored key must not replace an explicitly configured rotation
    // list, or every request would collapse it back to one account.
    if (authManager.getAccounts().length > 1) return;
    const value = await context.integration.connection.resolve(connection);
    if (!value || value.type !== "key" || !value.key) return;
    // OpenCode 2.0 stores extra fields in `configuration`, 2.1 moved them to `metadata`.
    const fields = value as {
      configuration?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
    const scope = (fields.configuration ?? fields.metadata)?.scope;
    authManager.setCredentials(value.key, typeof scope === "string" ? scope : undefined);
    logger.log(`[GigaCode-V2] Using stored credentials from the "${connection.label}" connection`);
  } catch (error) {
    logger.warn(
      "[GigaCode-V2] Could not read stored credentials:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function ensureEndpoint(): Promise<GigachatEndpoint> {
  if (!endpointPromise) {
    endpointPromise = startGigachatEndpoint({
      auth: authManager,
      port: preferredPort(),
      ensureCredentials: refreshCredentialsFromConnection,
      limiter: accountLimiter,
    }).catch((error: unknown) => {
      endpointPromise = null;
      logger.error(
        "[GigaCode-V2] Failed to start local endpoint:",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    });
  }
  return endpointPromise;
}

let activeSetups = 0;

export function retainEndpoint(): void {
  activeSetups += 1;
}

/**
 * Releases one location's hold on the shared endpoint. A hot reload disposes
 * every location, which closes the listener and frees the fixed port for the
 * next module instance.
 */
export async function releaseEndpoint(): Promise<void> {
  activeSetups = Math.max(0, activeSetups - 1);
  if (activeSetups > 0) return;
  const pending = endpointPromise;
  endpointPromise = null;
  if (!pending) return;
  try {
    const endpoint = await pending;
    await endpoint.close();
    logger.log("[GigaCode-V2] Local endpoint closed");
  } catch (error) {
    logger.warn(
      "[GigaCode-V2] Could not close the local endpoint:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

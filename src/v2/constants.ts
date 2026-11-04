/**
 * Constants for the V2 transport.
 *
 * The V1 plugin intercepted `globalThis.fetch`; V2 does not route provider
 * traffic through fetch, so the port registers a provider whose `baseURL`
 * points at a local endpoint owned by this plugin (see `endpoint.ts`).
 */

export const V2_PROVIDER_ID = "gigachat";

/** Provider key from the V1 configuration file. Kept working after the port. */
export const LEGACY_PROVIDER_ID = "GigaChat (Sberbank)";

/** Runtime package used for OpenAI-compatible providers. */
export const RUNTIME_PACKAGE = "@opencode/ai/providers/openai-compatible";

export const ENDPOINT_HOST = "127.0.0.1";

/**
 * Stable endpoint port.
 *
 * A provider declared in `opencode.json` needs a fixed `baseURL`, and only such
 * a provider gets an integration that can expose auth methods. Override with
 * `GIGACHAT_ENDPOINT_PORT` when the default port is taken.
 */
export const DEFAULT_ENDPOINT_PORT = 45731;

export const INTEGRATION_ID = "gigachat";

/** Paths served by the local endpoint, relative to `/v1`. */
export const CHAT_COMPLETIONS_SUFFIX = "/chat/completions";
export const FILES_SUFFIX = "/files";
export const MODELS_SUFFIX = "/models";

/** Guard against unbounded request buffering in the local endpoint. */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

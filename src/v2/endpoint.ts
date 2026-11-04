import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { GIGACHAT_API_URL } from "../constants.js";
import type { GigaCodeAuthManager } from "../gigacode/auth.js";
import { sanitizeError } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";
import { createErrorResponse } from "../plugin/errors.js";
import { sendChatRequest, sendProxyRequest } from "../plugin/transport.js";
import type { ConnectionSettings } from "../plugin/transport.js";
import { CHAT_COMPLETIONS_SUFFIX, ENDPOINT_HOST, MAX_REQUEST_BYTES } from "./constants.js";
import { KeyedLimiter, maxConcurrentPerAccount } from "./limiter.js";

/**
 * The local endpoint plays the role the V1 fetch interceptor had: OpenCode
 * performs an ordinary HTTP request against it and the plugin owns the whole
 * exchange with the Sber API, including TLS and both format translations.
 */
export type EndpointAuth = Pick<
  GigaCodeAuthManager,
  "getAccessToken" | "getVerifySsl" | "getCaBundle" | "blockActiveAccount" | "rotateAccount"
>;

/** Statuses that mean "this key is done", so the next account may still work. */
const ROTATABLE_STATUSES = new Set([401, 403, 429]);

/**
 * GigaChat answers a second simultaneous call with 429 even when the account is
 * healthy. This delay is used only when there is no other account to rotate to.
 */
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;

function errorStatus(error: unknown): number | undefined {
  return sanitizeError(error).status;
}

export interface GigachatEndpointOptions {
  readonly auth: EndpointAuth;
  /** GigaChat API base URL; overridable for corporate proxies and tests. */
  readonly upstreamBaseUrl?: string;
  /** Preferred listening port; the OS picks a free one when omitted or busy. */
  readonly port?: number;
  /** Refreshes stored credentials before a request uses the token. */
  readonly ensureCredentials?: () => Promise<void>;
  /** Shared per-account queue; the image tool uses the same instance. */
  readonly limiter?: KeyedLimiter;
  /** Overrides the per-account limit from `GIGACHAT_MAX_CONCURRENCY`. */
  readonly maxConcurrentPerAccount?: number;
  /** Delay before retrying a 429 when no other account is configured. */
  readonly rateLimitRetryDelayMs?: number;
}

export interface GigachatEndpoint {
  readonly port: number;
  readonly baseURL: string;
  close(): Promise<void>;
}

const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
]);

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error(`Request body exceeded ${MAX_REQUEST_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requestHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** Maps `http://host/v1/files` to `/files`, keeping a corporate proxy prefix intact. */
function upstreamPath(pathname: string): string {
  return pathname.replace(/^\/v1(?=\/|$)/, "") || "/";
}

async function pipeWebResponse(response: ServerResponse, source: Response): Promise<void> {
  response.statusCode = source.status;
  const headers = new Headers(source.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.forEach((value, key) => response.setHeader(key, value));
  if (!source.body) {
    response.end();
    return;
  }
  const reader = source.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    if (!response.write(Buffer.from(value))) await once(response, "drain");
  }
  response.end();
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: GigachatEndpointOptions,
  limiter: KeyedLimiter,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  const signal = new AbortController();
  request.once("aborted", () => signal.abort());
  response.once("close", () => {
    if (!response.writableEnded) signal.abort();
  });

  let rotated = false;
  let heldAccount: string | undefined;

  const releaseSlot = () => {
    if (heldAccount === undefined) return;
    limiter.release(heldAccount);
    heldAccount = undefined;
  };

  try {
    const body = await readRequestBody(request);
    if (options.ensureCredentials) await options.ensureCredentials();
    const upstream = (options.upstreamBaseUrl ?? process.env.GIGACHAT_API_URL ?? GIGACHAT_API_URL).replace(
      /\/$/,
      "",
    );
    const isChat = url.pathname.endsWith(CHAT_COMPLETIONS_SUFFIX);
    const isInference = isChat || url.pathname.endsWith("/embeddings");
    logger.log(`[GigaCode-V2] ${method} ${url.pathname} -> ${isChat ? "chat" : "proxy"}`);

    // Fetches a token for whatever account is active right now, so a retry after
    // rotation uses the next key instead of the one that just failed.
    const attempt = async (): Promise<Response> => {
      const { token, account } = await options.auth.getAccessToken();
      if (isInference) {
        // GigaChat answers a second simultaneous inference call with 429, so
        // the endpoint queues per account instead of forwarding the overlap.
        await limiter.acquire(account.id, signal.signal);
        heldAccount = account.id;
      }
      try {
        const settings: ConnectionSettings = {
          token,
          verifySsl: options.auth.getVerifySsl(),
          caBundle: options.auth.getCaBundle(),
          headers: requestHeaders(request.headers),
          signal: signal.signal,
        };
        return isChat
          ? await sendChatRequest(`${upstream}${CHAT_COMPLETIONS_SUFFIX}`, body.toString("utf8"), settings)
          : await sendProxyRequest(
              `${upstream}${upstreamPath(url.pathname)}${url.search}`,
              method,
              body.byteLength > 0 ? new Uint8Array(body) : undefined,
              settings,
            );
      } catch (error) {
        releaseSlot();
        throw error;
      }
    };

    let result: Response;
    try {
      result = await attempt();
    } catch (error) {
      const status = errorStatus(error);
      if (status === undefined || !ROTATABLE_STATUSES.has(status)) throw error;

      if (status === 429) {
        // Rate limits are transient even with one account: retry after a pause
        // when there is nowhere to rotate. With several accounts, move first.
        if (options.auth.rotateAccount(`HTTP ${status}`)) {
          rotated = true;
          logger.warn(`[GigaCode-V2] Retrying ${url.pathname} with the next account`);
        } else {
          const delay = options.rateLimitRetryDelayMs ?? RATE_LIMIT_RETRY_DELAY_MS;
          logger.warn(`[GigaCode-V2] Rate limited; retrying ${url.pathname} in ${delay} ms`);
          if (delay > 0) await sleep(delay, signal.signal);
        }
        result = await attempt();
      } else {
        if (!options.auth.rotateAccount(`HTTP ${status}`)) throw error;
        rotated = true;
        logger.warn(`[GigaCode-V2] Retrying ${url.pathname} with the next account`);
        result = await attempt();
      }
    }
    await pipeWebResponse(response, result);
  } catch (error) {
    if (signal.signal.aborted) {
      response.destroy();
      return;
    }
    const errorResponse = await createErrorResponse(error, (reason) => {
      // The request already moved to the next account; only block it once.
      if (!rotated) options.auth.blockActiveAccount(reason);
    });
    await pipeWebResponse(response, errorResponse);
  } finally {
    releaseSlot();
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, ENDPOINT_HOST);
  });
}

export async function startGigachatEndpoint(
  options: GigachatEndpointOptions,
): Promise<GigachatEndpoint> {
  const limiter =
    options.limiter ??
    new KeyedLimiter(options.maxConcurrentPerAccount ?? maxConcurrentPerAccount());
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, limiter).catch((error: unknown) => {
      logger.error(
        "[GigaCode-V2] endpoint failure:",
        error instanceof Error ? error.message : String(error),
      );
      response.destroy();
    });
  });

  const preferredPort = options.port ?? 0;
  try {
    await listen(server, preferredPort);
  } catch (error) {
    if (preferredPort === 0) throw error;
    logger.warn(
      `[GigaCode-V2] Port ${preferredPort} is unavailable (${
        error instanceof Error ? error.message : String(error)
      }); falling back to a random port`,
    );
    await listen(server, 0);
  }

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const baseURL = `http://${ENDPOINT_HOST}:${port}/v1`;
  logger.log(`[GigaCode-V2] Local endpoint listening on ${baseURL}`);
  if (preferredPort !== 0 && port !== preferredPort) {
    logger.warn(
      `[GigaCode-V2] Endpoint port is ${port}, not ${preferredPort}. A provider declared with a fixed baseURL will not reach it; set GIGACHAT_ENDPOINT_PORT or free the port.`,
    );
  }

  return {
    port,
    baseURL,
    close: () => closeServer(server),
  };
}

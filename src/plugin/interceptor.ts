import type { GigaCodeAuthManager } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";
import { createErrorResponse } from "./errors.js";
import { hasProviderMarker, resolveGigaRoute } from "./routing.js";
import { sendChatRequest, sendProxyRequest } from "./transport.js";

type RequestAuth = Pick<
  GigaCodeAuthManager,
  "getAccessToken" | "getVerifySsl" | "getCaBundle" | "blockActiveAccount"
>;

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function createFetchInterceptor(
  authManager: RequestAuth,
  originalFetch: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const request =
      typeof input === "string" || input instanceof URL ? undefined : input;
    const url = request ? request.url : String(input);
    const headers = new Headers(init?.headers ?? request?.headers);
    const route = resolveGigaRoute(url, hasProviderMarker(headers));
    if (!route) return originalFetch(input, init);

    const method = init?.method || request?.method || "GET";
    const signal =
      init?.signal === null ? undefined : (init?.signal ?? request?.signal);
    signal?.throwIfAborted();
    logger.log(
      `Intercepting ${method} request to: ${url} -> ${route.targetUrl}`,
    );
    try {
      const body =
        init?.body != null ? new Response(init.body) : request?.clone();
      if (!headers.has("content-type") && body?.headers.has("content-type")) {
        headers.set("content-type", body.headers.get("content-type")!);
      }
      const { token } = await withAbort(authManager.getAccessToken(), signal);
      const settings = {
        token,
        verifySsl: authManager.getVerifySsl(),
        caBundle: authManager.getCaBundle(),
        headers,
        signal,
      };
      if (route.isChat) {
        const bodyText = body ? await withAbort(body.text(), signal) : "";
        signal?.throwIfAborted();
        return await sendChatRequest(route.targetUrl, bodyText, settings);
      }
      return await sendProxyRequest(
        route.targetUrl,
        method,
        body?.body
          ? Buffer.from(await withAbort(body.arrayBuffer(), signal))
          : undefined,
        settings,
      );
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      return createErrorResponse(error, (reason) =>
        authManager.blockActiveAccount(reason),
      );
    }
  };
}

export function setupGlobalFetchInterceptor(authManager: RequestAuth): void {
  globalThis.fetch = createFetchInterceptor(authManager, globalThis.fetch);
}

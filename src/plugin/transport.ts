import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { default as axios } from "axios";
import { getHttpsAgent } from "../gigacode/certs.js";
import { logger } from "../gigacode/logger.js";
import { headersToRecord, removeHeaderCaseInsensitive } from "./routing.js";
import { translateGigaChatToOpenAi } from "./responses.js";
import { translateSseStream } from "./stream.js";
import { translateOpenAiToGigaChat } from "./translation.js";

export interface ConnectionSettings {
  token: string;
  verifySsl: boolean;
  caBundle: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

function connectionOptions(settings: ConnectionSettings) {
  const headers = headersToRecord(settings.headers);
  removeHeaderCaseInsensitive(headers, "authorization");
  removeHeaderCaseInsensitive(headers, "x-opencode-provider-marker");
  removeHeaderCaseInsensitive(headers, "content-length");
  return {
    headers: {
      ...headers,
      Accept: "application/json",
      Authorization: `Bearer ${settings.token}`,
      RqUID: randomUUID(),
    },
    httpsAgent: getHttpsAgent(settings.verifySsl, settings.caBundle),
    timeout: 60000,
    signal: settings.signal,
  };
}

export async function sendChatRequest(
  url: string,
  bodyText: string,
  settings: ConnectionSettings,
): Promise<Response> {
  const chatUrl = new URL(url);
  chatUrl.pathname = chatUrl.pathname.replace(/\/$/, "");
  const body = await translateOpenAiToGigaChat(
    bodyText ? JSON.parse(bodyText) : {},
    settings.token,
    settings.verifySsl,
    settings.caBundle,
    {
      filesUrl: new URL("../files", chatUrl).href,
      headers: settings.headers,
      signal: settings.signal,
    },
  );
  settings.signal?.throwIfAborted();
  const options = connectionOptions(settings);
  removeHeaderCaseInsensitive(options.headers, "content-type");
  const headers = { ...options.headers, "Content-Type": "application/json" };
  logger.log("Forwarding translated request to GigaChat API completions...");
  if (body.stream) {
    const response = await axios.post<Readable>(url, body, {
      ...options,
      headers,
      responseType: "stream",
    });
    return new Response(translateSseStream(response.data), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  const response = await axios.post(url, body, { ...options, headers });
  return Response.json(translateGigaChatToOpenAi(response.data));
}

export async function sendProxyRequest(
  url: string,
  method: string,
  body: BodyInit | null | undefined,
  settings: ConnectionSettings,
): Promise<Response> {
  const options = connectionOptions(settings);
  settings.signal?.throwIfAborted();
  const response = await axios.request<ArrayBuffer>({
    ...options,
    url,
    method,
    data: body,
    responseType: "arraybuffer",
  });
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined)
      responseHeaders.set(
        key,
        Array.isArray(value) ? value.join(", ") : String(value),
      );
  }
  const emptyBody =
    method.toUpperCase() === "HEAD" ||
    [204, 205, 304].includes(response.status);
  return new Response(emptyBody ? null : response.data, {
    status: response.status,
    headers: responseHeaders,
  });
}

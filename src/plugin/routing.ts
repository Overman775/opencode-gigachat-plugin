import { GIGACHAT_API_URL } from "../constants.js";
import { logger } from "../gigacode/logger.js";
const gigaHosts = new Set<string>([
  "api.gigachat.local",
  "api.giga.chat",
  "ngw.devices.sberbank.ru",
  "ngw.devices.sberbank.ru:9443",
  "gigachat.devices.sberbank.ru",
]);

export function registerGigaEndpoint(url: string): void {
  if (!url) return;
  try {
    let hostVal = "";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      hostVal = new URL(url).host;
    } else {
      hostVal = new URL("https://" + url).host;
    }
    if (hostVal) {
      gigaHosts.add(hostVal);
      logger.log(`Registered custom GigaChat host: ${hostVal}`);
    }
  } catch (e) {
    const cleaned = url.replace(/https?:\/\//, "").split("/")[0];
    if (cleaned) {
      gigaHosts.add(cleaned);
      logger.log(`Registered custom GigaChat host (fallback): ${cleaned}`);
    }
  }
}

export function extractBodyText(body: BodyInit | null | undefined): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  // For other types (ReadableStream, FormData, etc.), return empty string
  // to avoid "[object ReadableStream]" garbage
  return "";
}

export function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function removeHeaderCaseInsensitive(
  headers: Record<string, string>,
  headerName: string,
): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === headerName.toLowerCase()) delete headers[key];
  }
}

export function hasProviderMarker(headers: HeadersInit | undefined): boolean {
  const value = new Headers(headers).get("x-opencode-provider-marker");
  return value === "gigachat" || value === "gigacode";
}

export function resolveGigaRoute(
  url: string,
  hasMarker: boolean,
): { targetUrl: string; isChat: boolean } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `https://${url}`,
    );
  } catch {
    return undefined;
  }
  if (!hasMarker && !gigaHosts.has(parsed.host)) return undefined;
  const isChat = parsed.pathname
    .replace(/\/$/, "")
    .endsWith("/chat/completions");
  let targetUrl = url;
  if (parsed.host === "api.gigachat.local") {
    const base = new URL(GIGACHAT_API_URL);
    const path = parsed.pathname.replace(/^\/v1(?=\/|$)/, "");
    targetUrl = `${base.origin}${base.pathname}${path}${parsed.search}`;
  }
  return { targetUrl, isChat };
}

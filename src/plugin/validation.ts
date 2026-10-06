import { randomUUID } from "node:crypto";
import { DEFAULT_CA_BUNDLE_FILE } from "../constants.js";
import { getHttpsAgent } from "../gigacode/certs.js";
import { logger } from "../gigacode/logger.js";
export function validateMessagePayload(content: string): void {
  const payloadBytes = Buffer.byteLength(content, "utf8");
  const limitBytes = 400 * 1024; // 400 KB warning threshold

  if (payloadBytes > limitBytes) {
    logger.warn(
      `WARNING: Content size (${Math.round(payloadBytes / 1024)} KB) is large. ` +
        "GigaChat models will fail if combined content exceeds the 128K token context window.",
    );
  }
}
export function transformRequestOptions(
  options: any,
  token: string,
  verifySsl: boolean,
  caBundlePath?: string,
): any {
  options.headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    RqUID: randomUUID(),
  };

  options.httpsAgent = getHttpsAgent(verifySsl, caBundlePath || DEFAULT_CA_BUNDLE_FILE);
  return options;
}

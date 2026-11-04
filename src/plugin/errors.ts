import { Readable } from "node:stream";
import { default as axios } from "axios";
import { sanitizeError } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";

async function readErrorBody(body: unknown): Promise<string> {
  if (body instanceof Readable) {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        body.removeListener("data", onData);
        body.removeListener("end", finish);
        resolve(Buffer.concat(chunks).toString("utf8"));
      };
      const onData = (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        // Diagnostics must not buffer an unbounded error response.
        const remaining = 64 * 1024 - size;
        chunks.push(bytes.subarray(0, remaining));
        size += Math.min(bytes.length, remaining);
        if (size >= 64 * 1024) {
          finish();
          body.destroy();
        }
      };
      const timer = setTimeout(() => {
        finish();
        body.destroy();
      }, 2000);
      body.on("data", onData);
      body.once("end", finish);
      body.once("error", finish);
      body.once("close", () => {
        finish();
        body.removeListener("error", finish);
      });
    });
  }
  if (body instanceof ArrayBuffer || Buffer.isBuffer(body))
    return new TextDecoder().decode(body);
  return typeof body === "string" ? body : (JSON.stringify(body) ?? "");
}

/** Short explanations for statuses whose bare code says nothing to the user. */
const STATUS_HINTS: Record<number, string> = {
  401: "the access token was rejected, check the credentials",
  402: "the current GigaChat tariff does not include this operation",
  403: "quota or billing is exhausted for this account",
  429: "rate limit exceeded, retry later or add another account",
};

export async function createErrorResponse(
  error: unknown,
  onQuotaError: (reason: string) => void,
): Promise<Response> {
  const cleanError = sanitizeError(error);
  const status = cleanError.status || 500;
  let serverMessage = "";
  if (axios.isAxiosError(error) && error.response?.data) {
    try {
      const body = await readErrorBody(error.response.data);
      const payload = JSON.parse(body) as {
        message?: string;
        error?: { message?: string };
      };
      serverMessage = payload.message || payload.error?.message || "";
    } catch {
      logger.warn("GigaChat returned a non-JSON error response.");
    }
  }
  logger.error("Interception translation failed:", cleanError.message);
  if (status === 429) onQuotaError("HTTP 429 Rate Limited");
  if (status === 403) onQuotaError("HTTP 403 Quota/Billing Exhausted");
  if (status === 401) onQuotaError("HTTP 401 Unauthorized");
  const details = [serverMessage, STATUS_HINTS[status]].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return Response.json(
    {
      error: {
        message: `GigaChat Translation Proxy Error: ${cleanError.message}${details.length ? ` (${details.join("; ")})` : ""}`,
        type: "api_error",
        code: status,
      },
    },
    { status },
  );
}

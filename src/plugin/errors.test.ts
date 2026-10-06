import { PassThrough, Readable } from "node:stream";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createErrorResponse } from "./errors.js";

function errorWithBody(data: unknown): AxiosError {
  return new AxiosError(
    "Request failed",
    "ERR_BAD_RESPONSE",
    undefined,
    undefined,
    {
      status: 429,
      statusText: "Limited",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data,
    },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("API error responses", () => {
  it("decodes diagnostic text split across UTF-8 chunks", async () => {
    const bytes = Buffer.from(
      JSON.stringify({ message: "Превышена квота 👋" }),
    );
    const body = Readable.from(
      Array.from(bytes, (byte) => Buffer.from([byte])),
    );
    const response = await createErrorResponse(errorWithBody(body), () => {});
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toContain(
      "Превышена квота 👋",
    );
  });

  it("closes an error stream that never finishes", async () => {
    vi.useFakeTimers();
    const body = new PassThrough();
    const pending = createErrorResponse(errorWithBody(body), () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).status).toBe(429);
    expect(body.destroyed).toBe(true);
    expect(body.listenerCount("data")).toBe(0);
  });

  it("limits buffered diagnostics and closes oversized error streams", async () => {
    const body = new PassThrough();
    const pending = createErrorResponse(errorWithBody(body), () => {});
    body.write(Buffer.alloc(65536, 120));
    expect((await pending).status).toBe(429);
    expect(body.destroyed).toBe(true);
  });

  it("returns a response even if server diagnostics cannot be serialized", async () => {
    const data: { self?: unknown } = {};
    data.self = data;
    const response = await createErrorResponse(errorWithBody(data), () => {});
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toContain("Request failed");
  });
});

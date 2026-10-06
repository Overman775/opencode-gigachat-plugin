import { Readable } from "node:stream";
import { default as axios, AxiosError, AxiosHeaders } from "axios";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setupGlobalFetchInterceptor,
  registerGigaEndpoint,
  getToolAlias,
} from "./request.js";

describe("Global Fetch Interceptor", () => {
  let originalFetch: typeof fetch;
  const mockAuthManager = {
    getAccessToken: async () => ({
      token: "mock-token",
      account: {
        id: "test-account",
        name: "Test Account",
        credentials: "test-credentials",
        scope: "GIGACHAT_API_PERS" as const,
      },
    }),
    getVerifySsl: () => true,
    getCaBundle: () => "mock-ca",
    blockActiveAccount: vi.fn(),
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should not intercept requests to non-giga hosts", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = mockFetch;

    setupGlobalFetchInterceptor(mockAuthManager);

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4" }),
    });

    expect(mockFetch).toHaveBeenCalled();
  });

  it("should not intercept non-giga hosts that only mention a giga host in the URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    const mockAxiosPost = vi.spyOn(axios, "post");
    globalThis.fetch = mockFetch;

    setupGlobalFetchInterceptor(mockAuthManager);

    await globalThis.fetch(
      "https://example.com/proxy?target=api.gigachat.local/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ model: "GigaChat-Max" }),
      },
    );

    expect(mockFetch).toHaveBeenCalled();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("should intercept requests with x-opencode-provider-marker header and strip it", async () => {
    const mockAxiosPost = vi.spyOn(axios, "post").mockResolvedValue({
      data: {
        choices: [{ message: { content: "test" } }],
      },
    } as any);

    setupGlobalFetchInterceptor(mockAuthManager);

    const headers: Record<string, string> = {
      "x-opencode-provider-marker": "gigacode",
      "Content-Type": "application/json",
    };

    const response = await globalThis.fetch(
      "https://my-custom-proxy.com/chat/completions",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "GigaChat-Max",
          messages: [{ role: "user", content: "test" }],
        }),
      },
    );

    expect(mockAxiosPost).toHaveBeenCalled();
    // Fetch must preserve caller-owned headers while stripping its internal marker upstream.
    expect(headers["x-opencode-provider-marker"]).toBe("gigacode");
    expect(
      mockAxiosPost.mock.calls[0]?.[2]?.headers?.["x-opencode-provider-marker"],
    ).toBeUndefined();

    const responseJson = await response.json();
    expect(responseJson.choices[0].message.content).toBe("test");
  });

  it("should intercept requests to registered custom base URLs", async () => {
    const mockAxiosPost = vi.spyOn(axios, "post").mockResolvedValue({
      data: {
        choices: [{ message: { content: "custom proxy" } }],
      },
    } as any);

    registerGigaEndpoint("https://my-company-sber-proxy.ru/v1");
    setupGlobalFetchInterceptor(mockAuthManager);

    const response = await globalThis.fetch(
      "https://my-company-sber-proxy.ru/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "GigaChat-Max",
          messages: [{ role: "user", content: "test" }],
        }),
      },
    );

    expect(mockAxiosPost).toHaveBeenCalled();
    const responseJson = await response.json();
    expect(responseJson.choices[0].message.content).toBe("custom proxy");
  });

  it("should keep a stable tool call id across streaming chunks", async () => {
    const alias = getToolAlias("stream_tool");
    const stream = Readable.from([
      `data: ${JSON.stringify({
        id: "chunk-1",
        model: "GigaChat-Max",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              function_call: {
                name: alias,
                arguments: { value: "one" },
              },
              functions_state_id: "state-1",
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "chunk-2",
        model: "GigaChat-Max",
        choices: [
          {
            index: 0,
            delta: {
              function_call: {
                name: alias,
                arguments: { value: "two" },
              },
            },
            finish_reason: "function_call",
          },
        ],
      })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    vi.spyOn(axios, "post").mockResolvedValue({
      data: stream,
    } as any);

    setupGlobalFetchInterceptor(mockAuthManager);

    const response = await globalThis.fetch(
      "https://api.gigachat.local/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "GigaChat-Max",
          stream: true,
          messages: [{ role: "user", content: "stream a tool call" }],
        }),
      },
    );

    const text = await response.text();
    const jsonLines = text
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)));
    const firstCall = jsonLines[0].choices[0].delta.tool_calls[0];
    const secondCall = jsonLines[1].choices[0].delta.tool_calls[0];

    expect(firstCall.id).toBe(secondCall.id);
    expect(firstCall.function.name).toBe("stream_tool");
    expect(jsonLines[0].choices[0].delta.functions_state_id).toBe("state-1");
    expect(jsonLines[1].choices[0].finish_reason).toBe("tool_calls");
  });

  it.each(["record", "Headers", "pairs"])(
    "recognizes marker headers supplied as %s",
    async (kind) => {
      const entries: [string, string][] = [
        ["X-OpenCode-Provider-Marker", "gigachat"],
        ["Content-Type", "application/json"],
      ];
      const headers =
        kind === "Headers"
          ? new Headers(entries)
          : kind === "pairs"
            ? entries
            : Object.fromEntries(entries);
      const post = vi.spyOn(axios, "post").mockResolvedValue({
        data: { choices: [{ message: { content: "ok" } }] },
      });
      setupGlobalFetchInterceptor(mockAuthManager);
      const response = await fetch(
        "https://marker-fixture.invalid/chat/completions",
        {
          method: "POST",
          headers,
          body: "{}",
        },
      );
      expect(response.status).toBe(200);
      expect(post).toHaveBeenCalledOnce();
      expect(new Headers(headers).has("x-opencode-provider-marker")).toBe(true);
    },
  );

  it("reads a Request body without consuming the original request", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: { choices: [{ message: { content: "ok" } }] },
    });
    const request = new Request(
      "https://api.gigachat.local/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "GigaChat",
          messages: [{ role: "user", content: "request body" }],
        }),
      },
    );
    setupGlobalFetchInterceptor(mockAuthManager);
    await fetch(request);
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      messages: [{ role: "user", content: "request body" }],
    });
    expect(request.bodyUsed).toBe(false);
    expect(await request.text()).toContain("request body");
  });

  it.each([403, 429])(
    "preserves HTTP %s and reports quota failures without exposing credentials",
    async (status) => {
      const error = new AxiosError(
        "Request failed",
        "ERR_BAD_RESPONSE",
        {
          headers: new AxiosHeaders({ Authorization: "Basic secret-key" }),
        },
        undefined,
        {
          status,
          statusText: "Rejected",
          headers: {},
          config: { headers: new AxiosHeaders() },
          data: Buffer.from(JSON.stringify({ message: "quota exhausted" })),
        },
      );
      vi.spyOn(axios, "post").mockRejectedValue(error);
      setupGlobalFetchInterceptor(mockAuthManager);
      const response = await fetch(
        "https://api.gigachat.local/v1/chat/completions",
        {
          method: "POST",
          body: "{}",
        },
      );
      const text = await response.text();
      expect(response.status).toBe(status);
      expect(text).toContain("quota exhausted");
      expect(text).not.toContain("secret-key");
      expect(error.config?.headers.has("authorization")).toBe(false);
      expect(mockAuthManager.blockActiveAccount).toHaveBeenCalled();
    },
  );

  it("allows frozen marker headers to be reused and forwards custom client headers", async () => {
    const post = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { choices: [] } });
    const headers = Object.freeze({
      "X-OpenCode-Provider-Marker": "gigachat",
      "X-Client-ID": "client-id",
      Authorization: "ignored-client-token",
    });
    setupGlobalFetchInterceptor(mockAuthManager);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(
        "https://reused-headers.invalid/chat/completions",
        {
          method: "POST",
          headers,
          body: new Blob(["{}"]),
        },
      );
      expect(response.status).toBe(200);
    }
    expect(post).toHaveBeenCalledTimes(2);
    const forwarded = post.mock.calls[0]?.[2]?.headers;
    expect(forwarded?.["x-client-id"]).toBe("client-id");
    expect(forwarded?.Authorization).toBe("Bearer mock-token");
    expect(forwarded?.["x-opencode-provider-marker"]).toBeUndefined();
  });

  it("preserves binary Request bodies and replaces Request headers with init headers", async () => {
    const bytes = new Uint8Array([0, 128, 255, 42]);
    const proxy = vi.spyOn(axios, "request").mockResolvedValue({
      data: bytes,
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
    const request = new Request("https://api.gigachat.local/v1/files", {
      method: "POST",
      body: bytes,
      headers: { "X-Original": "drop" },
    });
    setupGlobalFetchInterceptor(mockAuthManager);
    const response = await fetch(request, {
      headers: { "X-Override": "keep" },
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const config = proxy.mock.calls[0]?.[0];
    expect(config?.data).toEqual(Buffer.from(bytes));
    expect(config?.headers?.["x-original"]).toBeUndefined();
    expect(config?.headers?.["x-override"]).toBe("keep");
    expect(request.bodyUsed).toBe(false);
  });

  it("returns a valid empty HEAD response", async () => {
    vi.spyOn(axios, "request").mockResolvedValue({
      data: Buffer.alloc(0),
      status: 200,
      headers: {},
    });
    setupGlobalFetchInterceptor(mockAuthManager);
    const response = await fetch("https://api.gigachat.local/v1/models", {
      method: "HEAD",
    });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it("rejects pre-aborted requests without starting OAuth", async () => {
    const token = vi.spyOn(mockAuthManager, "getAccessToken");
    setupGlobalFetchInterceptor(mockAuthManager);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetch("https://api.gigachat.local/v1/models", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(token).not.toHaveBeenCalled();
  });

  it("aborts a caller waiting for shared OAuth without canceling the other caller", async () => {
    let resolveToken!: (
      value: Awaited<ReturnType<typeof mockAuthManager.getAccessToken>>,
    ) => void;
    const shared = new Promise<
      Awaited<ReturnType<typeof mockAuthManager.getAccessToken>>
    >((resolve) => {
      resolveToken = resolve;
    });
    vi.spyOn(mockAuthManager, "getAccessToken").mockReturnValue(shared);
    const post = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { choices: [] } });
    setupGlobalFetchInterceptor(mockAuthManager);
    const controller = new AbortController();
    const aborted = fetch("https://api.gigachat.local/v1/chat/completions", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    const surviving = fetch("https://api.gigachat.local/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    resolveToken({
      token: "shared-token",
      account: {
        id: "test",
        name: "test",
        credentials: "test",
        scope: "GIGACHAT_API_PERS",
      },
    });
    expect((await surviving).status).toBe(200);
    expect(post).toHaveBeenCalledOnce();
  });

  it("forwards cancellation to HTTP requests", async () => {
    const controller = new AbortController();
    const post = vi
      .spyOn(axios, "post")
      .mockImplementation(async (_url, _body, config) => {
        expect(config?.signal).toBe(controller.signal);
        controller.abort();
        throw new Error("Axios canceled");
      });
    setupGlobalFetchInterceptor(mockAuthManager);
    await expect(
      fetch("https://api.gigachat.local/v1/chat/completions", {
        method: "POST",
        body: "{}",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(post).toHaveBeenCalledOnce();
  });

  it("uploads images through the chat endpoint's proxy and does not send chat after upload failure", async () => {
    const controller = new AbortController();
    const post = vi.spyOn(axios, "post").mockRejectedValue(
      new AxiosError(
        "Upload rejected",
        "ERR_BAD_RESPONSE",
        undefined,
        undefined,
        {
          status: 403,
          statusText: "Forbidden",
          headers: {},
          data: {},
          config: { headers: new AxiosHeaders() },
        },
      ),
    );
    setupGlobalFetchInterceptor(mockAuthManager);
    const response = await fetch(
      "https://image-proxy.invalid/api/v1/chat/completions/",
      {
        method: "POST",
        headers: {
          "x-opencode-provider-marker": "gigachat",
          "X-Client-ID": "client",
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,aW1hZ2U=" },
                },
              ],
            },
          ],
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0]?.[0]).toBe(
      "https://image-proxy.invalid/api/v1/files",
    );
    const config = post.mock.calls[0]?.[2];
    expect(config?.signal).toBe(controller.signal);
    expect(config?.headers?.["x-client-id"]).toBe("client");
    expect(config?.headers?.["content-type"]).toMatch(/^multipart\/form-data/);
  });
});

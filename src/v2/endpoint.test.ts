import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startGigachatEndpoint } from "./endpoint.js";
import type { EndpointAuth, GigachatEndpoint } from "./endpoint.js";

interface CapturedRequest {
  url: string;
  authorization: string | undefined;
  body: unknown;
}

const TEST_AUTH: EndpointAuth = {
  getAccessToken: async () => ({
    token: "test-token",
    account: {
      id: "test",
      name: "test",
      credentials: "dGVzdA==",
      scope: "GIGACHAT_API_PERS",
    },
  }),
  getVerifySsl: () => false,
  getCaBundle: () => "",
  blockActiveAccount: () => {},
  rotateAccount: () => false,
};

const servers: Server[] = [];
const endpoints: GigachatEndpoint[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as AddressInfo).port;
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(text);
      }
    });
  });
}

interface SlowStreamMarks {
  secondWriteAt?: number;
}

/** Minimal GigaChat API stub: v1 contract, SSE for stream requests. */
async function startUpstream(
  captured: CapturedRequest[],
  options: { status?: number; errorBody?: string; slowStream?: SlowStreamMarks } = {},
): Promise<string> {
  const server = createServer((request, response) => {
    void readJson(request).then((body) => {
      captured.push({
        url: request.url ?? "",
        authorization: request.headers.authorization,
        body,
      });
      if (options.status && options.status >= 400) {
        response.writeHead(options.status, { "content-type": "application/json" });
        response.end(options.errorBody ?? JSON.stringify({ message: "quota exhausted" }));
        return;
      }
      const stream = (body as { stream?: boolean }).stream === true;
      if (stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          `data: ${JSON.stringify({
            id: "giga-1",
            created: 1,
            model: "GigaChat-2",
            choices: [{ index: 0, delta: { role: "assistant", content: "При" } }],
          })}\n\n`,
        );
        const second = () =>
          response.write(
            `data: ${JSON.stringify({
              id: "giga-1",
              created: 1,
              model: "GigaChat-2",
              choices: [{ index: 0, delta: { content: "вет" }, finish_reason: "stop" }],
            })}\n\n`,
          );
        const finish = () => response.end("data: [DONE]\n\n");
        if (options.slowStream) {
          // Deliberately hold the second event back to prove incremental delivery.
          setTimeout(() => {
            options.slowStream!.secondWriteAt = Date.now();
            second();
            finish();
          }, 150);
          return;
        }
        second();
        finish();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "giga-2",
          created: 2,
          model: "GigaChat-2",
          choices: [{ index: 0, message: { role: "assistant", content: "Привет" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      );
    });
  });
  const port = await listen(server);
  return `http://127.0.0.1:${port}`;
}

async function startEndpoint(upstreamBaseUrl: string): Promise<string> {
  const endpoint = await startGigachatEndpoint({ auth: TEST_AUTH, upstreamBaseUrl });
  endpoints.push(endpoint);
  return endpoint.baseURL;
}

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

describe("local GigaChat endpoint", () => {
  it("translates a streaming OpenAI request into GigaChat SSE", async () => {
    const captured: CapturedRequest[] = [];
    const upstream = await startUpstream(captured);
    const baseURL = await startEndpoint(upstream);

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-session": "s1" },
      body: JSON.stringify({
        model: "GigaChat-2",
        stream: true,
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "привет" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "mcp-server/read",
              description: "read",
              parameters: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"object":"chat.completion.chunk"');
    expect(text).toContain("При");
    expect(text).toContain("вет");
    expect(text).toContain("[DONE]");

    expect(captured).toHaveLength(1);
    const upstreamRequest = captured[0];
    expect(upstreamRequest?.url).toBe("/chat/completions");
    expect(upstreamRequest?.authorization).toBe("Bearer test-token");
    const body = upstreamRequest?.body as {
      stream?: boolean;
      functions?: { name: string }[];
      messages?: { role: string }[];
      tool_choice?: unknown;
    };
    // v1 contract: tools become functions, schema loses additionalProperties
    expect(body.stream).toBe(true);
    expect(body.functions?.[0]?.name).toBe("tool_1");
    expect(body.messages?.map((message) => message.role)).toEqual(["system", "user"]);
    expect(JSON.stringify(body)).not.toContain("additionalProperties");
    expect(JSON.stringify(body)).not.toContain("tool_choice");
  });

  it("returns a translated non-streaming completion", async () => {
    const captured: CapturedRequest[] = [];
    const upstream = await startUpstream(captured);
    const baseURL = await startEndpoint(upstream);

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "GigaChat-2",
        stream: false,
        messages: [{ role: "user", content: "привет" }],
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      object?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    expect(payload.object).toBe("chat.completion");
    expect(payload.choices?.[0]?.message?.content).toBe("Привет");
    expect(payload.usage?.total_tokens).toBe(5);
  });

  it("maps upstream failures into an OpenAI-style error payload", async () => {
    const captured: CapturedRequest[] = [];
    const upstream = await startUpstream(captured, {
      status: 429,
      errorBody: JSON.stringify({ message: "Too many requests" }),
    });
    const baseURL = await startEndpoint(upstream);

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "GigaChat-2",
        stream: false,
        messages: [{ role: "user", content: "привет" }],
      }),
    });

    expect(response.status).toBe(429);
    const payload = (await response.json()) as { error?: { message?: string } };
    expect(payload.error?.message).toContain("GigaChat Translation Proxy Error");
    expect(payload.error?.message).toContain("Too many requests");
  });

  it("proxies non-chat routes to GigaChat", async () => {
    const captured: CapturedRequest[] = [];
    const upstream = await startUpstream(captured);
    const baseURL = await startEndpoint(upstream);

    const response = await fetch(`${baseURL}/models`);

    expect(response.status).toBe(200);
    expect(captured[0]?.url).toBe("/models");
    expect(captured[0]?.authorization).toBe("Bearer test-token");
  });

  it("delivers stream events before the upstream finishes", async () => {
    const captured: CapturedRequest[] = [];
    const marks: SlowStreamMarks = {};
    const upstream = await startUpstream(captured, { slowStream: marks });
    const baseURL = await startEndpoint(upstream);

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "GigaChat-2",
        stream: true,
        messages: [{ role: "user", content: "привет" }],
      }),
    });

    expect(response.status).toBe(200);
    const body = response.body;
    expect(body).not.toBeNull();
    if (!body) return;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    let firstEventAt = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      if (firstEventAt === 0 && seen.includes("chat.completion.chunk")) firstEventAt = Date.now();
    }

    expect(seen).toContain("[DONE]");
    expect(firstEventAt).toBeGreaterThan(0);
    // The first event must reach the client while the upstream is still holding
    // the second one back: no full-response buffering in the endpoint.
    expect(marks.secondWriteAt).toBeDefined();
    expect(firstEventAt).toBeLessThan(marks.secondWriteAt ?? 0);
  });

  it("queues concurrent chat calls for the same account", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const upstreamServer = createServer((request, response) => {
      void readJson(request).then(() => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              id: "giga-queued",
              created: 4,
              model: "GigaChat-2",
              choices: [
                { index: 0, message: { role: "assistant", content: "ок" }, finish_reason: "stop" },
              ],
            }),
          );
        }, 60);
      });
    });
    const upstream = `http://127.0.0.1:${await listen(upstreamServer)}`;
    const endpoint = await startGigachatEndpoint({
      auth: TEST_AUTH,
      upstreamBaseUrl: upstream,
    });
    endpoints.push(endpoint);

    const call = () =>
      fetch(`${endpoint.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "GigaChat-2",
          stream: false,
          messages: [{ role: "user", content: "привет" }],
        }),
      });

    const [first, second] = await Promise.all([call(), call()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // GigaChat answers the second simultaneous call with 429, so the endpoint
    // must never keep two upstream calls open for one account.
    expect(maxInFlight).toBe(1);
  });

  it("retries a 429 once when only one account is configured", async () => {
    let attempts = 0;
    const upstreamServer = createServer((request, response) => {
      void readJson(request).then(() => {
        attempts += 1;
        if (attempts === 1) {
          response.writeHead(429, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "rate limit exceeded" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "giga-retry",
            created: 5,
            model: "GigaChat-2",
            choices: [
              { index: 0, message: { role: "assistant", content: "ок" }, finish_reason: "stop" },
            ],
          }),
        );
      });
    });
    const upstream = `http://127.0.0.1:${await listen(upstreamServer)}`;
    const endpoint = await startGigachatEndpoint({
      auth: TEST_AUTH,
      upstreamBaseUrl: upstream,
      rateLimitRetryDelayMs: 0,
    });
    endpoints.push(endpoint);

    const response = await fetch(`${endpoint.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "GigaChat-2",
        stream: false,
        messages: [{ role: "user", content: "привет" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it("retries with the next account when the active one is rate limited", async () => {
    const authorizations: string[] = [];
    const upstreamServer = createServer((request, response) => {
      void readJson(request).then(() => {
        const authorization = request.headers.authorization ?? "";
        authorizations.push(authorization);
        if (authorization === "Bearer first-token") {
          response.writeHead(429, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "quota exhausted" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "giga-3",
            created: 3,
            model: "GigaChat-2",
            choices: [
              { index: 0, message: { role: "assistant", content: "ок" }, finish_reason: "stop" },
            ],
          }),
        );
      });
    });
    const upstream = `http://127.0.0.1:${await listen(upstreamServer)}`;

    let active = 0;
    const auth: EndpointAuth = {
      getAccessToken: async () => ({
        token: active === 0 ? "first-token" : "second-token",
        account: {
          id: `account-${active}`,
          name: `account-${active}`,
          credentials: "dGVzdA==",
          scope: "GIGACHAT_API_PERS",
        },
      }),
      getVerifySsl: () => false,
      getCaBundle: () => "",
      blockActiveAccount: () => {},
      rotateAccount: () => {
        if (active > 0) return false;
        active = 1;
        return true;
      },
    };
    const endpoint = await startGigachatEndpoint({ auth, upstreamBaseUrl: upstream });
    endpoints.push(endpoint);

    const response = await fetch(`${endpoint.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "GigaChat-2",
        stream: false,
        messages: [{ role: "user", content: "привет" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(authorizations).toEqual(["Bearer first-token", "Bearer second-token"]);
  });
});

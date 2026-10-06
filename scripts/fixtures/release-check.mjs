import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";

const passthroughCalls = [];
globalThis.fetch = async (...args) => {
  passthroughCalls.push(args);
  return new Response("passthrough");
};
const originalFetch = globalThis.fetch;
const plugin = await import("./gigachat-plugin.js");
assert.equal(typeof plugin.default, "function");
assert.equal(plugin.default, plugin.GigaCodeConnectorPlugin);
assert.notEqual(globalThis.fetch, originalFetch);
const hooks = await plugin.default({
  client: { app: { log: async () => ({}) } },
});
assert.equal(hooks.auth.provider, "GigaChat (Sberbank)");
assert.equal(hooks.auth.methods[0].authorize, undefined);
for (const hook of [
  "config",
  "chat.params",
  "chat.message",
  "tool.execute.before",
]) {
  assert.equal(typeof hooks[hook], "function", hook);
}
await hooks.config({});
const auth = await hooks.auth.loader(async () => ({
  type: "api",
  key: "test-only",
  metadata: { scope: "GIGACHAT_API_PERS" },
}));
assert.equal(auth.credentials, "test-only");
assert.equal(auth.scope, "GIGACHAT_API_PERS");
await hooks["chat.params"]({ model: { providerID: "other" } }, {});
assert.equal(
  await (await fetch("https://example.invalid/passthrough")).text(),
  "passthrough",
);
assert.equal(passthroughCalls.length, 1);

let oauthCalls = 0;
let scenario = "text";
let uploaded = false;
let apiBase = "https://api.giga.chat/v1";
let chatCalls = 0;
let abortStarted = () => {};
let abortClosed = () => {};
let lastToolAlias;
const fixtureErrors = [];
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.headers["x-fixture-target"]);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    response.setHeader("Content-Type", "application/json");
    if (url.pathname.endsWith("/oauth")) {
      assert.equal(url.host, "ngw.devices.sberbank.ru:9443");
      assert.equal(request.headers.authorization, "Basic test-only");
      assert.equal(raw, "scope=GIGACHAT_API_PERS");
      oauthCalls++;
      response.end(
        JSON.stringify({
          access_token: "fixture-token",
          expires_at: Date.now() + 3600000,
        }),
      );
      return;
    }
    assert.equal(request.headers.authorization, "Bearer fixture-token");
    assert.ok(request.headers.rquid);
    if (url.pathname.endsWith("/models")) {
      assert.equal(url.href, "https://api.giga.chat/v1/models");
      if (scenario === "abort") {
        response.once("close", abortClosed);
        abortStarted();
        return;
      }
      response.end(JSON.stringify({ data: [{ id: "GigaChat" }] }));
      return;
    }
    if (url.pathname.endsWith("/files")) {
      assert.equal(url.href, `${apiBase}/files`);
      assert.match(
        request.headers["content-type"],
        /^multipart\/form-data; boundary=/,
      );
      assert.ok(raw.includes('name="file"'));
      if (scenario === "image-error") {
        response.writeHead(403);
        response.end(JSON.stringify({ message: "image upload rejected" }));
        return;
      }
      if (scenario === "proxy-image")
        assert.equal(request.headers["x-client-id"], "proxy-client");
      assert.equal(request.headers["x-opencode-provider-marker"], undefined);
      uploaded = true;
      response.end(JSON.stringify({ id: "fixture-image" }));
      return;
    }
    chatCalls++;
    assert.equal(url.href, `${apiBase}/chat/completions`);
    const body = JSON.parse(raw);
    if (scenario === "error") {
      response.writeHead(429);
      response.end(JSON.stringify({ message: "fixture quota exhausted" }));
      return;
    }
    if (scenario === "stream") {
      response.setHeader("Content-Type", "text/event-stream");
      const event = Buffer.from(
        "data: " +
          JSON.stringify({
            choices: [
              {
                index: 0,
                delta: { content: "Привет 👋" },
                finish_reason: "stop",
              },
            ],
          }) +
          "\n\n",
      );
      const split = event.indexOf(Buffer.from("П")) + 1;
      response.write(event.subarray(0, split));
      setTimeout(
        () =>
          response.end(
            Buffer.concat([event.subarray(split), Buffer.from("data: [DONE]")]),
          ),
        5,
      );
      return;
    }
    let message = { role: "assistant", content: "works" };
    let finishReason = "stop";
    if (scenario === "tool") {
      assert.equal(body.tools, undefined);
      const fn = body.functions[0];
      assert.equal(fn.parameters.additionalProperties, undefined);
      assert.equal(body.function_call.name, fn.name);
      lastToolAlias = fn.name;
      message = {
        role: "assistant",
        content: null,
        function_call: { name: fn.name, arguments: { value: "ok" } },
        functions_state_id: "fixture-state",
      };
      finishReason = "function_call";
    } else if (scenario === "tool-result") {
      assert.deepEqual(body.messages[1].function_call, {
        name: lastToolAlias,
        arguments: { value: "ok" },
      });
      assert.equal(body.messages[1].functions_state_id, "fixture-state");
      assert.deepEqual(body.messages[2], {
        role: "function",
        content: '{"ok":true}',
        name: lastToolAlias,
      });
    } else if (["image", "proxy-image"].includes(scenario)) {
      assert.ok(uploaded);
      assert.deepEqual(body.messages[0].attachments, ["fixture-image"]);
    }
    response.end(
      JSON.stringify({
        choices: [{ index: 0, message, finish_reason: finishReason }],
      }),
    );
  } catch (error) {
    fixtureErrors.push(error);
    response.writeHead(500);
    response.end(JSON.stringify({ message: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
// Keep all HTTP traffic inside this fixture while exercising bundled Axios and
// FormData. TLS certificate signatures are checked by the separate CA tests.
const originalHttpsRequest = https.request;
https.request = (options, callback) => {
  const target =
    "https://" +
    options.hostname +
    (options.port ? ":" + options.port : "") +
    options.path;
  return http.request(
    {
      ...options,
      protocol: "http:",
      hostname: "127.0.0.1",
      host: "127.0.0.1",
      port: server.address().port,
      agent: false,
      headers: { ...options.headers, "x-fixture-target": target },
    },
    callback,
  );
};
for (const key of [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "https_proxy",
  "http_proxy",
  "all_proxy",
])
  process.env[key] = "";
for (const key of ["NO_PROXY", "no_proxy"]) process.env[key] = "";
const send = (body) =>
  fetch("https://api.gigachat.local/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const messages = [{ role: "user", content: "test" }];
try {
  const normal = await send({ messages });
  assert.equal(normal.status, 200);
  assert.equal((await normal.json()).choices[0].message.content, "works");
  const models = await fetch("https://api.gigachat.local/v1/models");
  assert.equal(models.status, 200);
  assert.equal((await models.json()).data[0].id, "GigaChat");

  scenario = "tool";
  const tools = [
    {
      type: "function",
      function: {
        name: "mcp/server.probe",
        parameters: { type: "object", additionalProperties: false },
      },
    },
  ];
  const toolResponse = await send({
    messages,
    tools,
    tool_choice: { type: "function", function: { name: "mcp/server.probe" } },
  });
  assert.equal(toolResponse.status, 200);
  const completion = await toolResponse.json();
  const call = completion.choices[0].message.tool_calls[0];
  assert.equal(call.function.name, "mcp/server.probe");
  assert.deepEqual(JSON.parse(call.function.arguments), { value: "ok" });
  assert.equal(completion.choices[0].finish_reason, "tool_calls");
  scenario = "tool-result";
  const roundtrip = await send({
    messages: [
      ...messages,
      completion.choices[0].message,
      { role: "tool", tool_call_id: call.id, content: '{"ok":true}' },
    ],
    tools,
  });
  assert.equal(roundtrip.status, 200);
  await roundtrip.text();

  scenario = "stream";
  const streaming = await send({ messages, stream: true });
  assert.equal(streaming.status, 200);
  const sse = await streaming.text();
  assert.ok(sse.includes("Привет 👋"));
  assert.ok(sse.includes("data: [DONE]"));

  scenario = "image";
  const image = await send({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "image test" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,aW1hZ2U=" },
          },
        ],
      },
    ],
  });
  assert.equal(image.status, 200);
  await image.text();

  const imageBody = {
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
  };
  scenario = "proxy-image";
  apiBase = "https://corporate-fixture.invalid/api/v1";
  const customImage = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "x-opencode-provider-marker": "gigachat",
      "X-Client-ID": "proxy-client",
    },
    body: JSON.stringify(imageBody),
  });
  assert.equal(customImage.status, 200);
  await customImage.text();

  apiBase = "https://api.giga.chat/v1";
  scenario = "image-error";
  const beforeFailedUpload = chatCalls;
  const failedImage = await send(imageBody);
  assert.equal(failedImage.status, 403);
  await failedImage.text();
  assert.equal(chatCalls, beforeFailedUpload);

  scenario = "abort";
  const started = new Promise((resolve) => {
    abortStarted = resolve;
  });
  const closed = new Promise((resolve) => {
    abortClosed = resolve;
  });
  const controller = new AbortController();
  const abortRequest = fetch("https://api.gigachat.local/v1/models", {
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(abortRequest, { name: "AbortError" });
  await closed;

  scenario = "error";
  const rejected = await send({ messages });
  assert.equal(rejected.status, 429);
  assert.match(
    (await rejected.json()).error.message,
    /fixture quota exhausted/,
  );
  assert.equal(oauthCalls, 1);
  assert.deepEqual(fixtureErrors, []);
  console.log(
    `${process.argv[2] || "Standalone"} release: initialization, OAuth cache, chat, tool round trip, SSE, multipart/proxy uploads, cancellation and HTTP errors passed without node_modules.`,
  );
} finally {
  https.request = originalHttpsRequest;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

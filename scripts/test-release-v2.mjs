import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Release check for the V2 bundle.
 *
 * Copies only `dist/gigachat-plugin-v2.js` into a clean directory, stubs the
 * `@opencode/plugin` module the engine provides, runs the plugin against a
 * local fake GigaChat API and verifies the declared provider layout end to end:
 * provider registration, translated streaming, error mapping and port release.
 */
const root = process.cwd();
const bundlePath = path.join(root, "dist", "gigachat-plugin-v2.js");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const STUB = `export const Plugin = { define: (plugin) => plugin };
export const Provider = {
  ID: { make: (value) => String(value) },
  Info: { empty: (id) => ({ id, name: id, activation: "enabled", package: "" }) },
};
export const Model = {
  ID: { make: (value) => String(value) },
  Info: {
    default: (providerID, id) => ({
      id,
      modelID: id,
      providerID,
      name: id,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      variants: [],
      time: {},
      cost: [],
      status: "active",
      enabled: true,
      limit: { context: 1000, output: 100 },
    }),
  },
};
export const Integration = { ID: { make: (value) => String(value) } };
`;

const HARNESS = `
import { createServer } from "node:http";

const log = (...args) => console.error("[harness]", ...args);
const results = { errors: [] };

// Fake OAuth endpoint: the token exchange must stay inside the test.
const oauth = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    results.oauthAuthorization = String(request.headers.authorization);
    results.oauthBody = body;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ access_token: "test-token", expires_at: Math.floor(Date.now() / 1000) + 600 }));
  });
});
await new Promise((resolve) => oauth.listen(0, "127.0.0.1", resolve));
process.env.GIGACHAT_OAUTH_URL = "http://127.0.0.1:" + oauth.address().port + "/oauth";

// Fake GigaChat API: v1 contract, SSE when the request asks for a stream.
const upstream = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    results.upstreamAuthorization = request.headers.authorization;
    results.upstreamTools = results.upstreamTools ?? {};
    const requestKind = body.functions ? "tools" : body.stream ? "stream" : "plain";
    results.upstreamTools[requestKind] = body.functions ?? null;
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      // A function call proves both the alias for GigaChat and the restoration
      // of the original tool name on the way back to the client.
      const first = body.functions
        ? {
            id: "r1", created: 1, model: "GigaChat-2",
            choices: [{ index: 0, delta: { role: "assistant", function_call: { name: body.functions[0].name, arguments: { path: "x" } } } }],
          }
        : { id: "r1", created: 1, model: "GigaChat-2", choices: [{ index: 0, delta: { role: "assistant", content: "проверка" } }] };
      response.write("data: " + JSON.stringify(first) + "\\n\\n");
      response.write('data: {"id":"r1","created":1,"model":"GigaChat-2","choices":[{"index":0,"delta":{},"finish_reason":"function_call"}]}\\n\\n');
      response.end("data: [DONE]\\n\\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "r2", created: 2, model: "GigaChat-2",
      choices: [{ index: 0, message: { role: "assistant", content: "проверка" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
process.env.GIGACHAT_API_URL = "http://127.0.0.1:" + upstream.address().port;
process.env.GIGACHAT_CREDENTIALS = "dGVzdDp0ZXN0";
process.env.GIGACHAT_ENDPOINT_PORT = "45999";

const plugin = (await import("./gigachat-plugin-v2.js")).default;
results.pluginId = plugin.id;

let providerEntry = null;
let integrationMethod = null;
const ctx = {
  app: { name: "test", version: "2.0.0", channel: "test" },
  location: { directory: process.cwd(), project: { id: "test", canonical: process.cwd() } },
  options: {},
  provider: {
    transform: async (callback) => {
      const editor = {
        get: (id) => (id === "gigachat" && providerEntry ? { provider: providerEntry, models: new Map() } : undefined),
        add: (input) => { providerEntry = input.info; results.modelCount = input.models.length; },
        update: () => {},
        remove: () => {},
        models: { set: () => {}, update: () => {}, remove: () => {} },
      };
      callback(editor);
      return { dispose: async () => {} };
    },
  },
  integration: {
    transform: async (callback) => {
      const editor = {
        get: (id) => (id === "gigachat" ? { id } : undefined),
        update: () => {},
        remove: () => {},
        method: { update: (input) => { integrationMethod = input.method; }, list: () => [], remove: () => {} },
      };
      callback(editor);
      return { dispose: async () => {} };
    },
    connection: { active: async () => undefined, resolve: async () => undefined },
  },
  session: { hook: async () => ({ dispose: async () => {} }) },
};

const cleanup = await plugin.setup(ctx);
results.providerBaseURL = providerEntry?.settings?.baseURL;
results.providerPackage = providerEntry?.package;
results.integrationMethod = integrationMethod?.type;

const baseURL = results.providerBaseURL;
const response = await fetch(baseURL + "/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "GigaChat-2",
    stream: true,
    messages: [{ role: "user", content: "привет" }],
    tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } }],
  }),
});
results.status = response.status;
const text = await response.text();
results.streamBody = text;
results.bodySnippet = text.slice(0, 200);
results.streamed = text.includes("chat.completion.chunk") && text.includes("проверка");
results.doneFrame = text.includes("[DONE]");

const plain = await fetch(baseURL + "/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "GigaChat-2", stream: false, messages: [{ role: "user", content: "привет" }] }),
});
results.plainStatus = plain.status;
const payload = await plain.json();
results.plainContent = payload?.choices?.[0]?.message?.content;

// Streaming without tools: the content delta must survive the round trip.
const contentStream = await fetch(baseURL + "/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "GigaChat-2", stream: true, messages: [{ role: "user", content: "привет" }] }),
});
results.contentStreamBody = await contentStream.text();

await cleanup();
await new Promise((resolve) => upstream.close(resolve));
await new Promise((resolve) => oauth.close(resolve));

// The endpoint must release the fixed port when the plugin unloads.
const probe = createServer();
try {
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(45999, "127.0.0.1", resolve);
  });
  results.portReleased = true;
} catch (error) {
  results.portReleased = false;
  results.errors.push("port not released: " + error.message);
}
await new Promise((resolve) => probe.close(resolve));

console.log("HARNESS_RESULT " + JSON.stringify(results));
`;

const dir = await mkdtemp(path.join(tmpdir(), "gigachat-v2-"));
const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}`);
  if (!ok) failures.push(name);
};

try {
  const bundle = await readFile(bundlePath, "utf8");
  check("bundle has a version header", bundle.includes(`v${version}`));
  check("engine module stays unbundled", /from\s+"@opencode\/plugin"/.test(bundle));
  check("licenses are appended", bundle.includes("Third-party licenses"));

  await copyFile(bundlePath, path.join(dir, "gigachat-plugin-v2.js"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(path.join(dir, "run.mjs"), HARNESS);
  const stubDir = path.join(dir, "node_modules", "@opencode", "plugin");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    path.join(stubDir, "package.json"),
    JSON.stringify({ name: "@opencode/plugin", version: "2.0.0", type: "module", exports: { ".": "./index.js" } }),
  );
  await writeFile(path.join(stubDir, "index.js"), STUB);

  const child = spawn(process.execPath, ["run.mjs"], { cwd: dir, env: { ...process.env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolve) => child.on("close", resolve));

  if (exitCode !== 0) {
    console.log(stderr.trim());
    check("harness exits cleanly", false);
  } else {
    const line = stdout.split("\n").find((item) => item.startsWith("HARNESS_RESULT "));
    if (!line) {
      console.log(stdout.trim());
      check("harness reports results", false);
    } else {
      const result = JSON.parse(line.slice("HARNESS_RESULT ".length));
      check("plugin exports an id", result.pluginId === "opencode.gigachat");
      check("provider points at the local endpoint", result.providerBaseURL === "http://127.0.0.1:45999/v1");
      check("provider uses the compatible package", result.providerPackage === "@opencode/ai/providers/openai-compatible");
      check("model catalog is populated", result.modelCount === 6);
      check("env auth method is registered", result.integrationMethod === "env");
      check("streaming request returns 200", result.status === 200);
      check("stream body is a translated chunk", (result.bodySnippet ?? "").includes("chat.completion.chunk"));
      check("stream is translated to OpenAI chunks", (result.streamBody ?? "").includes('"object":"chat.completion.chunk"'));
      check("streamed content delta survives", (result.contentStreamBody ?? "").includes("проверка"));
      check("stream ends with [DONE]", result.doneFrame === true);
      check("non-streaming request returns 200", result.plainStatus === 200);
      check("non-streaming content is translated", result.plainContent === "проверка");
      check("tools reach GigaChat as functions", typeof result.upstreamTools?.tools?.[0]?.name === "string");
      check("tool names are aliased for the v1 API", result.upstreamTools?.tools?.[0]?.name === "tool_1");
      check("non-streaming request carries no tools", result.upstreamTools?.plain === null);
      check("tool call is restored for the client", (result.streamBody ?? "").includes('"tool_calls"') && (result.streamBody ?? "").includes('"read_file"'));
      check("function_call finish reason is mapped", (result.streamBody ?? "").includes('"finish_reason":"tool_calls"'));
      check("upstream gets the Bearer token", (result.upstreamAuthorization ?? "").startsWith("Bearer "));
      check("token exchange uses Basic auth", (result.oauthAuthorization ?? "").startsWith("Basic "));
      check("token request carries the scope", (result.oauthBody ?? "").includes("scope=GIGACHAT_API_PERS"));
      check("fixed port is released after unload", result.portReleased === true);
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nRelease check failed: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\nV2 release check passed");

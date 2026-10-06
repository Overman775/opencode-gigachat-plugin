import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { translateSseStream } from "./stream.js";
import { getToolAlias } from "./tools.js";

function event(delta: object, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

describe("SSE translation", () => {
  it("preserves Cyrillic and emoji split across UTF-8 network chunks, including the final line", async () => {
    const source = Buffer.from(event({ content: "Привет 👋" }) + "data:[DONE]");
    const chunks = Array.from(source, (byte) => Buffer.from([byte]));
    const result = await new Response(
      translateSseStream(Readable.from(chunks)),
    ).text();
    const line = result.split("\n")[0];
    expect(JSON.parse(line!.slice(6)).choices[0].delta.content).toBe(
      "Привет 👋",
    );
    expect(result).toContain("data: [DONE]\n\n");
    expect(result).not.toContain("�");
  });

  it("preserves tool names and call IDs across chunks, isolating concurrent streams", async () => {
    const alias = getToolAlias("mcp/server.tool");
    const body =
      event({
        function_call: { name: alias, arguments: { value: 1 } },
        functions_state_id: "state",
      }) +
      event(
        { function_call: { name: alias, arguments: { value: 2 } } },
        "function_call",
      );
    const run = async () => {
      const text = await new Response(
        translateSseStream(Readable.from([body])),
      ).text();
      return text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(6)));
    };
    const [first, second] = await Promise.all([run(), run()]);
    const call = first[0].choices[0].delta.tool_calls[0];
    expect(call.function.name).toBe("mcp/server.tool");
    expect(call.id).toBe(first[1].choices[0].delta.tool_calls[0].id);
    expect(call.id).not.toBe(second[0].choices[0].delta.tool_calls[0].id);
    expect(first[0].choices[0].delta.functions_state_id).toBe("state");
    expect(first[1].choices[0].finish_reason).toBe("tool_calls");
  });

  it("propagates upstream stream failures", async () => {
    const source = new PassThrough();
    const result = new Response(translateSseStream(source)).text();
    source.destroy(new Error("Upstream disconnected"));
    await expect(result).rejects.toThrow("Upstream disconnected");
  });

  it("preserves malformed server diagnostics without crashing the stream", async () => {
    const source = Readable.from([
      "data: not-json\n\ndata: null\n\ndata: [DONE]\n\n",
    ]);
    const text = await new Response(translateSseStream(source)).text();
    expect(text).toContain("data: not-json");
    expect(text).toContain("data: null");
    expect(text).toContain("data: [DONE]");
  });

  it("closes the upstream connection when the consumer cancels", async () => {
    const source = new PassThrough();
    await translateSseStream(source).getReader().cancel();
    expect(source.destroyed).toBe(true);
  });

  it("rejects when the source closes without an end event", async () => {
    const source = new PassThrough();
    const result = new Response(translateSseStream(source)).text();
    source.destroy();
    await expect(result).rejects.toThrow("closed before completion");
  });

  it("preserves error events and translates multiline JSON with CRLF separators", async () => {
    const source = Readable.from([
      'event: error\r\ndata: {"error":{"message":"quota"}}\r\n\r\n',
      'data: {"choices": [\r\ndata: {"delta":{"content":"ok"}}]}\r\n\r\n',
    ]);
    const text = await new Response(translateSseStream(source)).text();
    expect(text).toContain(
      'event: error\ndata: {"error":{"message":"quota"}}\n\n',
    );
    const completion = text
      .split("\n")
      .find((line) => line.includes('"chat.completion.chunk"'));
    expect(JSON.parse(completion!.slice(6)).choices[0].delta.content).toBe(
      "ok",
    );
  });

  it("pauses the source while a consumer is not reading", async () => {
    const source = new PassThrough();
    const reader = translateSseStream(source).getReader();
    source.write(event({ content: "first" }));
    source.write(event({ content: "second" }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(source.isPaused()).toBe(true);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "first",
    );
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "second",
    );
    await reader.cancel();
  });

  it("keeps completion IDs stable and ends a function call only on its final chunk", async () => {
    const alias = getToolAlias("completion_tool");
    const source = Readable.from([
      event({ function_call: { name: alias, arguments: {} } }),
      event(
        { function_call: { name: alias, arguments: { value: 1 } } },
        "function_call",
      ),
    ]);
    const text = await new Response(translateSseStream(source)).text();
    const chunks = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    expect(chunks[0].id).toBe(chunks[1].id);
    expect(chunks[0].choices[0].finish_reason).toBeNull();
    expect(chunks[1].choices[0].finish_reason).toBe("tool_calls");
  });
});

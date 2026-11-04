import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  extractTextToolCalls,
  TextToolCallFilter,
} from "./text-tool-calls.js";
import { translateGigaChatToOpenAi } from "./responses.js";
import { translateSseStream } from "./stream.js";

/** The shape GigaChat actually produced in the reported session. */
const imitationText = [
  "Согласны с таким распределением? Начну с первых шотов.",
  "",
  '[Assistant tool call]: edit({"path":"C:\\\\AI\\\\Razgon2d\\\\story\\\\shots.json","oldString":"\\"line\\": \\"sample text\\"","newString":"\\"line\\": \\"Дверь прокуренного кабинета.\\"","replaceAll":false})',
].join("\n");

function event(delta: object, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

async function streamChunks(body: string): Promise<any[]> {
  const text = await new Response(
    translateSseStream(Readable.from([body])),
  ).text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data:") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)));
}

describe("text tool call recovery", () => {
  it("extracts a written-out call and keeps the prose", () => {
    const result = extractTextToolCalls(imitationText);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.name).toBe("edit");
    const args = JSON.parse(result.calls[0]!.arguments);
    expect(args.path).toBe("C:\\AI\\Razgon2d\\story\\shots.json");
    expect(args.newString).toContain("Дверь прокуренного кабинета");
    expect(result.text).toBe(
      "Согласны с таким распределением? Начну с первых шотов.\n\n",
    );
    expect(result.text).not.toContain("Assistant tool call");
  });

  it("leaves prose that merely quotes the format", () => {
    const text =
      'The history format is [Assistant tool call]: name({...}) where the JSON may be invalid.';
    const result = extractTextToolCalls(text);
    expect(result.calls).toHaveLength(0);
    expect(result.text).toBe(text);
  });

  it("extracts several calls from one message", () => {
    const text = [
      "Two steps:",
      '[Assistant tool call]: read({"path":"a.txt"})',
      '[Assistant tool call]: shell({"command":"dir","timeout":30})',
    ].join("\n");
    const result = extractTextToolCalls(text);
    expect(result.calls.map((c) => c.name)).toEqual(["read", "shell"]);
    expect(JSON.parse(result.calls[1]!.arguments).timeout).toBe(30);
    expect(result.text).toBe("Two steps:\n");
  });

  it("recovers a call split across stream deltas and hides the marker", async () => {
    const marker = '[Assistant tool call]: read({"path":"a.txt"})';
    const body =
      event({ content: "Проверю файл.\n\n[Assist" }) +
      event({ content: "ant tool call]: re" }) +
      event({ content: 'ad({"path":"a.txt"})' }) +
      event({}, "stop");
    const chunks = await streamChunks(body + "data: [DONE]\n\n");
    const allContent = chunks
      .map((c) => c.choices[0].delta.content ?? "")
      .join("");
    expect(allContent).not.toContain("Assistant tool call");
    expect(allContent).toContain("Проверю файл.");
    const calls = chunks.flatMap((c) => c.choices[0].delta.tool_calls ?? []);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("read");
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ path: "a.txt" });
    const finish = chunks[chunks.length - 1].choices[0].finish_reason;
    expect(finish).toBe("tool_calls");
  });

  it("degrades an unfinished capture back to text at end of stream", () => {
    const filter = new TextToolCallFilter();
    const pushed = filter.push("text [Assistant tool call]: read({\"pat");
    expect(pushed.text).not.toContain("read({");
    const flushed = filter.flush();
    expect(flushed.calls).toHaveLength(0);
    expect(flushed.text + pushed.text).toContain("[Assistant tool call]: read({\"pat");
  });

  it("translates a non-streaming imitation into tool_calls", () => {
    const result = translateGigaChatToOpenAi({
      choices: [
        {
          message: { role: "assistant", content: imitationText },
          finish_reason: "stop",
        },
      ],
    });
    const choice = result.choices[0];
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message.tool_calls).toHaveLength(1);
    expect(choice.message.tool_calls[0].function.name).toBe("edit");
    expect(choice.message.content).not.toContain("Assistant tool call");
  });

  it("keeps structured function_call responses untouched", () => {
    const result = translateGigaChatToOpenAi({
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            function_call: { name: "tool_1", arguments: { path: "a" } },
          },
          finish_reason: "function_call",
        },
      ],
    });
    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.choices[0].message.tool_calls[0].function.name).toBe("tool_1");
  });
});

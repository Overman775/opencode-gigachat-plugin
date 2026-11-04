import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { translateStreamChunk } from "./responses.js";
import {
  recoveredToolCall,
  TextToolCallFilter,
} from "./text-tool-calls.js";

export function translateSseStream(
  source: Readable,
): ReadableStream<Uint8Array> {
  const decoder = new StringDecoder("utf8");
  const encoder = new TextEncoder();
  const toolCallIds = new Map<string, string>();
  const textFilter = new TextToolCallFilter();
  let recoveredCalls = false;
  const fallback = {
    id: `chatcmp-${randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
  };
  let buffer = "";
  let eventLines: string[] = [];
  let closed = false;

  return new ReadableStream({
    start(controller) {
      const emitRaw = (payload: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const emitEvent = () => {
        if (!eventLines.length || closed) return;
        const lines = eventLines;
        eventLines = [];
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        let output = `${lines.join("\n")}\n\n`;
        if (data === "[DONE]") {
          output = "data: [DONE]\n\n";
        } else if (data) {
          try {
            const payload = JSON.parse(data);
            if (payload && Array.isArray(payload.choices)) {
              const translated = translateStreamChunk(
                payload,
                toolCallIds,
                fallback,
              );
              // Recover tool calls the model wrote out as text instead of
              // emitting a structured function_call.
              const hasRealCalls = translated.choices.some(
                (c: any) => c.delta?.function_call || c.delta?.tool_calls,
              );
              if (!hasRealCalls) {
                const synthetic: any[] = [];
                for (const choice of translated.choices) {
                  const content = choice.delta?.content;
                  if (typeof content !== "string" || content === "") continue;
                  const result = textFilter.push(content);
                  choice.delta.content = result.text;
                  for (const call of result.calls) {
                    recoveredCalls = true;
                    synthetic.push(recoveredToolCall(call, synthetic.length));
                  }
                }
                if (synthetic.length > 0) {
                  translated.choices[0].delta.tool_calls = synthetic;
                  translated.choices[0].finish_reason = "tool_calls";
                } else if (
                  recoveredCalls &&
                  translated.choices[0]?.finish_reason === "stop"
                ) {
                  translated.choices[0].finish_reason = "tool_calls";
                }
              }
              output = `data: ${JSON.stringify(translated)}\n\n`;
            }
          } catch {
            // Preserve complete events for malformed JSON and server diagnostics.
          }
        }
        controller.enqueue(encoder.encode(output));
      };
      const consumeLines = () => {
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.replace(/\r$/, "");
          if (line === "") emitEvent();
          else eventLines.push(line);
        }
      };
      source.on("data", (chunk: Buffer | string) => {
        if (closed) return;
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        consumeLines();
        if ((controller.desiredSize ?? 0) <= 0) source.pause();
      });
      source.once("end", () => {
        if (closed) return;
        buffer += decoder.end();
        consumeLines();
        if (buffer) eventLines.push(buffer.replace(/\r$/, ""));
        emitEvent();
        // Release the text the filter still holds and emit any recovered call.
        const flushed = textFilter.flush();
        if (flushed.text || flushed.calls.length > 0) {
          const delta: any = { role: "assistant", content: flushed.text };
          if (flushed.calls.length > 0) {
            recoveredCalls = true;
            delta.tool_calls = flushed.calls.map((call, i) =>
              recoveredToolCall(call, i),
            );
          }
          emitRaw({
            id: fallback.id,
            object: "chat.completion.chunk",
            created: fallback.created,
            model: "GigaChat-2-Max",
            choices: [
              {
                index: 0,
                delta,
                finish_reason: recoveredCalls ? "tool_calls" : null,
              },
            ],
          });
        }
        closed = true;
        controller.close();
      });
      source.once("error", (error: Error) => {
        if (closed) return;
        closed = true;
        controller.error(error);
      });
      source.once("close", () => {
        if (closed) return;
        closed = true;
        controller.error(new Error("GigaChat stream closed before completion"));
      });
      if (source.destroyed) {
        closed = true;
        controller.error(new Error("GigaChat stream is already closed"));
      }
    },
    pull() {
      if (!closed) source.resume();
    },
    cancel() {
      closed = true;
      source.destroy();
    },
  });
}

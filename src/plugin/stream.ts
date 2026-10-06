import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { translateStreamChunk } from "./responses.js";

export function translateSseStream(
  source: Readable,
): ReadableStream<Uint8Array> {
  const decoder = new StringDecoder("utf8");
  const encoder = new TextEncoder();
  const toolCallIds = new Map<string, string>();
  const fallback = {
    id: `chatcmp-${randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
  };
  let buffer = "";
  let eventLines: string[] = [];
  let closed = false;

  return new ReadableStream({
    start(controller) {
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

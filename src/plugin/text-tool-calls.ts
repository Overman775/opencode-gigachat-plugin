import { randomUUID } from "node:crypto";

/**
 * Recovery for tool calls the model wrote out as plain text.
 *
 * OpenCode serializes compacted history with lines like
 * `[Assistant tool call]: edit({...})`. GigaChat sometimes imitates that
 * format in its own text instead of emitting a structured function_call,
 * so the call reaches the user as chat text and never executes. The parser
 * below turns such lines back into real tool calls; the streaming filter
 * holds back just enough text to keep the marker line out of the chat.
 */

export const TOOL_CALL_MARKER = "[Assistant tool call]: ";

export interface TextToolCall {
  name: string;
  /** Arguments as a JSON string, the shape OpenAI clients expect. */
  arguments: string;
}

export interface FilterResult {
  /** Text safe to show to the user right now. */
  text: string;
  /** Completed calls recovered from marker lines. */
  calls: TextToolCall[];
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Scans a JSON object starting at `start` (which must point at `{`),
 * respecting string literals and escapes. Returns the index just past the
 * closing brace, or -1 when the object is incomplete.
 */
function balancedJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Parses `name({...})` that follows the marker; null when it is not one. */
function parseCall(
  fragment: string,
): { call: TextToolCall; consumed: number } | null {
  const open = fragment.indexOf("(");
  if (open <= 0) return null;
  const name = fragment.slice(0, open).trim();
  if (!NAME_PATTERN.test(name)) return null;
  const bodyStart = open + 1;
  // Skip whitespace before the JSON body.
  let jsonStart = bodyStart;
  while (
    jsonStart < fragment.length &&
    /\s/.test(fragment[jsonStart] ?? "")
  ) {
    jsonStart += 1;
  }
  if (jsonStart >= fragment.length || fragment[jsonStart] !== "{") return null;
  const jsonEnd = balancedJsonEnd(fragment, jsonStart);
  if (jsonEnd < 0) return null;
  const after = fragment.slice(jsonEnd);
  const paren = after.match(/^\s*\)/);
  if (!paren) return null;
  const json = fragment.slice(jsonStart, jsonEnd);
  try {
    JSON.parse(json);
  } catch {
    return null;
  }
  return {
    call: { name, arguments: json },
    consumed: jsonEnd + paren[0].length,
  };
}

/**
 * Extracts marker lines from completed text. Occurrences whose arguments do
 * not parse as `name({json})` are left in place, so prose that merely quotes
 * the format survives.
 */
export function extractTextToolCalls(text: string): FilterResult {
  const calls: TextToolCall[] = [];
  let out = "";
  let cursor = 0;
  for (;;) {
    const at = text.indexOf(TOOL_CALL_MARKER, cursor);
    if (at < 0) break;
    const lineStart = text.lastIndexOf("\n", at) + 1;
    const parsed = parseCall(text.slice(at + TOOL_CALL_MARKER.length));
    if (!parsed) {
      out += text.slice(cursor, at + TOOL_CALL_MARKER.length);
      cursor = at + TOOL_CALL_MARKER.length;
      continue;
    }
    out += text.slice(cursor, lineStart);
    calls.push(parsed.call);
    cursor = at + TOOL_CALL_MARKER.length + parsed.consumed;
    // Drop the newline that terminated the marker line, when present.
    if (text[cursor] === "\n") cursor += 1;
    else if (text.slice(cursor, cursor + 2) === "\r\n") cursor += 2;
  }
  out += text.slice(cursor);
  return { text: out, calls };
}

/**
 * Incremental filter for streamed content. Holds back a short tail so a
 * marker split across deltas is still caught, and captures the call body
 * until its JSON closes.
 */
export class TextToolCallFilter {
  private hold = "";
  private capture: string | null = null;

  push(delta: string): FilterResult {
    if (delta) {
      if (this.capture !== null) this.capture += delta;
      else this.hold += delta;
    }
    return this.drain(false);
  }

  /** Releases everything still held; an unfinished capture degrades to text. */
  flush(): FilterResult {
    if (this.capture !== null) {
      this.hold += TOOL_CALL_MARKER + this.capture;
      this.capture = null;
    }
    const result = this.drain(true);
    const text = result.text + this.hold;
    this.hold = "";
    return { text, calls: result.calls };
  }

  private drain(final: boolean): FilterResult {
    let text = "";
    const calls: TextToolCall[] = [];
    for (;;) {
      if (this.capture !== null) {
        const parsed = parseCall(this.capture);
        if (!parsed) {
          if (!final) return { text, calls };
          // Incomplete or malformed at end of stream: keep as plain text.
          text += TOOL_CALL_MARKER + this.capture;
          this.capture = null;
          continue;
        }
        calls.push(parsed.call);
        this.hold = this.capture.slice(parsed.consumed);
        this.capture = null;
        continue;
      }
      const at = this.hold.indexOf(TOOL_CALL_MARKER);
      if (at >= 0) {
        text += this.hold.slice(0, at);
        this.capture = this.hold.slice(at + TOOL_CALL_MARKER.length);
        this.hold = "";
        continue;
      }
      if (final) {
        text += this.hold;
        this.hold = "";
        return { text, calls };
      }
      // Hold back only a suffix that could still grow into the marker, so
      // ordinary text keeps flowing without delay.
      const keep = Math.min(this.hold.length, TOOL_CALL_MARKER.length - 1);
      for (let k = keep; k > 0; k -= 1) {
        if (this.hold.endsWith(TOOL_CALL_MARKER.slice(0, k))) {
          const cut = this.hold.length - k;
          text += this.hold.slice(0, cut);
          this.hold = this.hold.slice(cut);
          return { text, calls };
        }
      }
      text += this.hold;
      this.hold = "";
      return { text, calls };
    }
  }
}

/** Builds an OpenAI-style tool_calls delta entry for a recovered call. */
export function recoveredToolCall(call: TextToolCall, index: number): any {
  return {
    index,
    id: `call_${randomUUID()}`,
    type: "function",
    function: { name: call.name, arguments: call.arguments },
  };
}

import { sanitizeError } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";
import type { AttachmentOptions } from "./attachments.js";
import { uploadBase64File } from "./attachments.js";
import { getToolAlias, parseArgumentsToObject } from "./tools.js";
export async function translateMessages(
  messages: any[],
  systemInstruction: string,
  token: string,
  verifySsl: boolean,
  caBundle: string,
  options: AttachmentOptions = {},
): Promise<any[]> {
  // 1. Separate system and non-system messages
  const systemMessages: any[] = [];
  const nonSystemMessages: any[] = [];
  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      systemMessages.push(msg);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  // 2. Concatenate system message contents
  let systemContent = "";
  for (const sysMsg of systemMessages) {
    if (typeof sysMsg.content === "string") {
      if (systemContent) systemContent += "\n";
      systemContent += sysMsg.content;
    } else if (Array.isArray(sysMsg.content)) {
      for (const part of sysMsg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          if (systemContent) systemContent += "\n";
          systemContent += part.text;
        }
      }
    }
  }

  // 3. Append Chain-of-Thought guidance if requested
  if (systemInstruction) {
    if (systemContent) {
      systemContent += systemInstruction;
    } else {
      systemContent = systemInstruction.trim();
    }
  }

  // 4. Assemble the final GigaChat messages array
  const gigaMessages: any[] = [];
  if (systemContent) {
    gigaMessages.push({
      role: "system",
      content: systemContent,
    });
  }

  // 5. Translate and append non-system messages.
  //
  // Pre-pass: build a map of tool_call_id -> function_name from assistant messages.
  // This is needed because OpenAI "tool" role messages carry only tool_call_id (no name),
  // but GigaChat "function" role messages require the function name (alias).
  const toolCallIdToName = new Map<string, string>();
  for (const msg of nonSystemMessages) {
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) {
          toolCallIdToName.set(tc.id, tc.function.name);
        }
      }
    }
  }

  for (const msg of nonSystemMessages) {
    const gigaMsg: any = { role: msg.role };

    // --- Content handling ---
    // CRITICAL: GigaChat rejects empty-string content ("") for assistant messages that have
    // a function_call. Pass null through as null (not as ""), or omit the field entirely.
    const hasFunctionCall = !!(
      (msg.tool_calls &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0) ||
      msg.function_call
    );

    if (msg.role === "tool" || msg.role === "function") {
      let contentStr = "";
      if (msg.content === null || msg.content === undefined) {
        contentStr = "{}";
      } else if (typeof msg.content === "string") {
        try {
          JSON.parse(msg.content);
          contentStr = msg.content;
        } catch (e) {
          contentStr = JSON.stringify(msg.content);
        }
      } else {
        contentStr = JSON.stringify(msg.content);
      }
      gigaMsg.content = contentStr;
    } else if (
      msg.content === null ||
      msg.content === undefined ||
      (msg.content === "" && hasFunctionCall)
    ) {
      // For assistant messages with tool_calls GigaChat expects content: null (not "")
      gigaMsg.content = hasFunctionCall ? null : "";
    } else if (typeof msg.content === "string") {
      gigaMsg.content = msg.content;
    } else if (Array.isArray(msg.content)) {
      let textContent = "";
      const attachments: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          if (textContent) textContent += "\n";
          textContent += part.text;
        } else if (part.type === "image_url") {
          const urlStr = part.image_url?.url || "";
          if (urlStr.startsWith("data:image/")) {
            try {
              logger.log(
                "Intercepted base64 image. Uploading to GigaChat files...",
              );
              const fileId = await uploadBase64File(
                urlStr,
                token,
                verifySsl,
                caBundle,
                options,
              );
              attachments.push(fileId);
            } catch (err: unknown) {
              const error = sanitizeError(err);
              logger.error("Failed to upload message image:", error.message);
              throw error;
            }
          } else {
            if (textContent) textContent += "\n";
            textContent += `[Image URL: ${urlStr}]`;
          }
        }
      }
      gigaMsg.content = textContent || (hasFunctionCall ? null : "");
      if (attachments.length > 0) {
        gigaMsg.attachments = attachments;
      }
    } else {
      gigaMsg.content = hasFunctionCall ? null : "";
    }

    // --- Role mapping ---
    if (msg.role === "tool") {
      gigaMsg.role = "function";
    }

    // --- function_call mapping (assistant -> GigaChat) ---
    // IMPORTANT: GigaChat v1 API expects arguments as an OBJECT, not a JSON string.
    if (
      msg.tool_calls &&
      Array.isArray(msg.tool_calls) &&
      msg.tool_calls.length > 0
    ) {
      gigaMsg.function_call = {
        name: getToolAlias(msg.tool_calls[0].function?.name),
        arguments: parseArgumentsToObject(
          msg.tool_calls[0].function?.arguments,
        ),
      };
    } else if (msg.function_call) {
      gigaMsg.function_call = {
        name: getToolAlias(msg.function_call.name),
        arguments: parseArgumentsToObject(msg.function_call.arguments),
      };
    }

    // --- functions_state_id passthrough ---
    // GigaChat uses this to maintain function call state across multi-turn conversations.
    if (msg.functions_state_id) {
      gigaMsg.functions_state_id = msg.functions_state_id;
    }

    // --- name field for function-result messages ---
    // OpenAI "tool" messages have tool_call_id but NO name field.
    // GigaChat "function" messages require the name (alias).
    // Resolve: msg.name (if present) OR look up by tool_call_id from the pre-pass map.
    if (msg.role === "tool" || msg.role === "function") {
      const resolvedName =
        msg.name ||
        (msg.tool_call_id ? toolCallIdToName.get(msg.tool_call_id) : undefined);
      if (resolvedName) {
        gigaMsg.name = getToolAlias(resolvedName);
      }
    } else if (msg.name) {
      gigaMsg.name = getToolAlias(msg.name);
    }

    gigaMessages.push(gigaMsg);
  }

  return gigaMessages;
}

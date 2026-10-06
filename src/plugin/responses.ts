import { randomUUID } from "node:crypto";
import { getOriginalToolName, stringifyArguments } from "./tools.js";
export function translateStreamChunk(
  sberJson: any,
  streamToolCallIds: Map<string, string>,
  fallback = {
    id: `chatcmp-${randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
  },
): any {
  return {
    id: sberJson.id || fallback.id,
    object: "chat.completion.chunk",
    created: sberJson.created ?? fallback.created,
    model: sberJson.model || "GigaChat-Max",
    choices: (sberJson.choices || []).map((c: any) => {
      const delta: any = {
        role: c.delta?.role,
        content: c.delta?.content || "",
      };
      if (c.delta?.reasoning_content) {
        delta.reasoning_content = c.delta.reasoning_content;
      }
      if (c.delta?.functions_state_id) {
        delta.functions_state_id = c.delta.functions_state_id;
      }

      let finishReason = c.finish_reason || null;
      if (finishReason === "function_call") {
        finishReason = "tool_calls";
      }

      if (c.delta?.function_call) {
        const originalName = getOriginalToolName(c.delta.function_call.name);
        const callKey = `${c.index ?? 0}:${originalName}`;
        let callId = streamToolCallIds.get(callKey);
        if (!callId) {
          callId = `call_${randomUUID()}`;
          streamToolCallIds.set(callKey, callId);
        }
        // GigaChat streams arguments as object; OpenAI clients expect JSON string
        delta.tool_calls = [
          {
            index: 0,
            id: callId,
            type: "function",
            function: {
              name: originalName,
              arguments: stringifyArguments(c.delta.function_call.arguments),
            },
          },
        ];
      } else if (c.delta?.tool_calls) {
        delta.tool_calls = c.delta.tool_calls;
      }

      return {
        index: c.index ?? 0,
        delta,
        finish_reason: finishReason,
      };
    }),
  };
}

export function translateGigaChatToOpenAi(sberResponse: any): any {
  return {
    id: sberResponse.id || `chatcmp-${randomUUID()}`,
    object: "chat.completion",
    created: sberResponse.created || Math.floor(Date.now() / 1000),
    model: sberResponse.model,
    choices: (sberResponse.choices || []).map((c: any) => {
      let finishReason = c.finish_reason || "stop";
      if (finishReason === "function_call") {
        finishReason = "tool_calls";
      }

      const choice: any = {
        index: c.index ?? 0,
        message: {
          role: c.message?.role || "assistant",
          content: c.message?.content || "",
        },
        finish_reason: finishReason,
      };

      if (c.message?.reasoning_content) {
        choice.message.reasoning_content = c.message.reasoning_content;
      }

      if (c.message?.function_call) {
        // GigaChat returns arguments as an object; OpenAI clients expect a JSON string
        choice.message.tool_calls = [
          {
            id: `call_${randomUUID()}`,
            type: "function",
            function: {
              name: getOriginalToolName(c.message.function_call.name),
              arguments: stringifyArguments(c.message.function_call.arguments),
            },
          },
        ];
        choice.finish_reason = "tool_calls";
        // Preserve functions_state_id so the caller can echo it back in the next turn
        if (c.message.functions_state_id) {
          choice.message.functions_state_id = c.message.functions_state_id;
        }
      } else if (c.message?.tool_calls) {
        choice.message.tool_calls = c.message.tool_calls;
        choice.finish_reason = "tool_calls";
      }

      return choice;
    }),
    usage: sberResponse.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

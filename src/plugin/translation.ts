import { translateMessages } from "./messages.js";
import { getToolAlias, sanitizeFunctionParameters } from "./tools.js";
export async function translateOpenAiToGigaChat(
  openAiBody: any,
  token: string,
  verifySsl: boolean,
  caBundle: string,
  options: AttachmentOptions = {},
): Promise<any> {
  let modelName = openAiBody.model || "GigaChat-Max";
  if (modelName === "GigaChat-2-Lite") {
    modelName = "GigaChat-2";
  }

  const gigaBody: any = {
    model: modelName,
    messages: [],
    stream: !!openAiBody.stream,
    temperature: openAiBody.temperature ?? 0.7,
    top_p: openAiBody.top_p ?? 1.0,
    max_tokens: openAiBody.max_tokens ?? 1024,
  };

  // Determine reasoning level
  let reasoningLevel: string | null = null;
  if (openAiBody.reasoning_effort) {
    reasoningLevel = openAiBody.reasoning_effort.toLowerCase();
  } else if (openAiBody.thinking && typeof openAiBody.thinking === "object") {
    reasoningLevel =
      openAiBody.thinking.budget_tokens > 1024 ? "high" : "medium";
  }

  const cotPrompt =
    reasoningLevel === "high"
      ? "\n[Системное руководство: Проанализируй задачу очень подробно, составь детальный пошаговый план решения и проведи глубокие рассуждения (Chain-of-Thought) перед тем, как выдать финальный ответ.]"
      : reasoningLevel === "medium"
        ? "\n[Системное руководство: Подумай пошагово перед тем, как выдать итоговый ответ.]"
        : "";

  gigaBody.messages = await translateMessages(
    openAiBody.messages || [],
    cotPrompt,
    token,
    verifySsl,
    caBundle,
    options,
  );

  // 2. Map Tools & Functions FIRST (before response_format, since they conflict)
  const hasTools =
    (openAiBody.tools &&
      Array.isArray(openAiBody.tools) &&
      openAiBody.tools.length > 0) ||
    (openAiBody.functions &&
      Array.isArray(openAiBody.functions) &&
      openAiBody.functions.length > 0);

  if (openAiBody.tools && Array.isArray(openAiBody.tools)) {
    gigaBody.functions = openAiBody.tools.map((t: any) => ({
      name: getToolAlias(t.function?.name),
      description: t.function?.description || "",
      // Sanitize parameters: remove additionalProperties, $schema etc. that GigaChat rejects
      parameters: sanitizeFunctionParameters(t.function?.parameters) || {
        type: "object",
        properties: {},
      },
    }));

    // Map tool choice to function_call
    if (typeof openAiBody.tool_choice === "string") {
      if (openAiBody.tool_choice === "none") {
        gigaBody.function_call = "none";
      } else if (openAiBody.tool_choice === "required") {
        gigaBody.function_call = "auto";
      } else {
        gigaBody.function_call = openAiBody.tool_choice;
      }
    } else if (
      openAiBody.tool_choice &&
      typeof openAiBody.tool_choice === "object"
    ) {
      if (openAiBody.tool_choice.function?.name) {
        gigaBody.function_call = {
          name: getToolAlias(openAiBody.tool_choice.function.name),
        };
      } else {
        gigaBody.function_call = "auto";
      }
    } else {
      gigaBody.function_call = "auto";
    }
  } else if (openAiBody.functions && Array.isArray(openAiBody.functions)) {
    gigaBody.functions = openAiBody.functions.map((f: any) => ({
      name: getToolAlias(f.name),
      description: f.description || "",
      parameters: sanitizeFunctionParameters(f.parameters) || {
        type: "object",
        properties: {},
      },
    }));
    if (openAiBody.function_call) {
      if (typeof openAiBody.function_call === "string") {
        gigaBody.function_call = openAiBody.function_call;
      } else if (typeof openAiBody.function_call === "object") {
        gigaBody.function_call = {
          name: getToolAlias(openAiBody.function_call.name),
        };
      }
    }
  }

  // 3. Map Structured Outputs (JSON Schema).
  // NOTE: GigaChat does NOT support response_format together with functions.
  // If tools/functions are present, skip response_format to avoid HTTP 400.
  if (openAiBody.response_format && !hasTools) {
    if (openAiBody.response_format.type === "json_object") {
      gigaBody.response_format = { type: "json" };
    } else if (openAiBody.response_format.type === "json_schema") {
      const openAiSchema = openAiBody.response_format.json_schema?.schema;
      if (openAiSchema) {
        gigaBody.response_format = {
          type: "json_schema",
          schema: sanitizeFunctionParameters(openAiSchema),
          strict:
            openAiBody.response_format.json_schema?.strict !== undefined
              ? !!openAiBody.response_format.json_schema.strict
              : undefined,
        };
      } else {
        gigaBody.response_format = { type: "json" };
      }
    }
  }

  // Map stop sequence if defined
  if (openAiBody.stop) {
    gigaBody.stop = openAiBody.stop;
  }

  // 4. Map custom fields (excluding reasoning_effort to avoid GigaChat API 400 Bad Request)
  if (openAiBody.repetition_penalty) {
    gigaBody.repetition_penalty = openAiBody.repetition_penalty;
  }

  return gigaBody;
}
import type { AttachmentOptions } from "./attachments.js";

import axios from "axios";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import { GIGACHAT_COMPLETIONS_URL, DEFAULT_CA_BUNDLE_FILE } from "../constants.js";
import { GigaCodeAuthManager, sanitizeError } from "../gigacode/auth.js";
import { getHttpsAgent, shouldVerifySsl, BUILTIN_CA_BUNDLE } from "../gigacode/certs.js";
import { logger } from "../gigacode/logger.js";

// Tool Name Sanitization and Mapping (to satisfy GigaChat's strict alphanumeric/letter-only requirements)
const toolNameMap = new Map<string, string>();
const originalToAliasMap = new Map<string, string>();
let toolCounter = 0;

export function getToolAlias(originalName: string | undefined | null): string {
  if (!originalName) return "";
  
  if (originalToAliasMap.has(originalName)) {
    return originalToAliasMap.get(originalName)!;
  }
  
  toolCounter++;
  const alias = `tool_${toolCounter}`;
  toolNameMap.set(alias, originalName);
  originalToAliasMap.set(originalName, alias);
  return alias;
}

export function getOriginalToolName(alias: string | undefined | null): string {
  if (!alias) return "";
  return toolNameMap.get(alias) || alias;
}

/**
 * Sanitize a JSON Schema object for GigaChat compatibility.
 * GigaChat rejects: additionalProperties, $schema, nullable (use anyOf instead).
 * Arguments within function_call must be sent as objects, not JSON strings.
 */
function sanitizeFunctionParameters(params: any): any {
  if (!params || typeof params !== "object") return params;
  const out: any = {};
  for (const key of Object.keys(params)) {
    // Drop fields GigaChat API rejects
    if (key === "additionalProperties" || key === "$schema" || key === "nullable") continue;
    const val = params[key];
    if (key === "properties" && typeof val === "object") {
      out[key] = {};
      for (const propKey of Object.keys(val)) {
        out[key][propKey] = sanitizeFunctionParameters(val[propKey]);
      }
    } else if (Array.isArray(val)) {
      out[key] = val.map((item: any) =>
        typeof item === "object" ? sanitizeFunctionParameters(item) : item
      );
    } else if (typeof val === "object") {
      out[key] = sanitizeFunctionParameters(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Parse function call arguments into an object.
 * GigaChat v1 API expects arguments as Map<String, Object>, not a JSON string.
 */
function parseArgumentsToObject(args: any): any {
  if (args === null || args === undefined) return {};
  if (typeof args === "object") return args;
  if (typeof args === "string") {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return {};
}

/**
 * Ensure function call arguments are a JSON string for the OpenAI response format.
 * OpenAI clients expect arguments as a JSON string.
 */
function stringifyArguments(args: any): string {
  if (typeof args === "string") return args;
  try { return JSON.stringify(args); } catch { return "{}"; }
}

// ============================================================================
// 1. OpenAI to GigaChat Payload Translation Logic
// ============================================================================

export async function translateOpenAiToGigaChat(
  openAiBody: any,
  token: string,
  verifySsl: boolean,
  caBundle: string
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
    max_tokens: openAiBody.max_tokens ?? 1024
  };

  // Determine reasoning level
  let reasoningLevel: string | null = null;
  if (openAiBody.reasoning_effort) {
    reasoningLevel = openAiBody.reasoning_effort.toLowerCase();
  } else if (openAiBody.thinking && typeof openAiBody.thinking === "object") {
    reasoningLevel = openAiBody.thinking.budget_tokens > 1024 ? "high" : "medium";
  }

  const cotPrompt = reasoningLevel === "high"
    ? "\n[Системное руководство: Проанализируй задачу очень подробно, составь детальный пошаговый план решения и проведи глубокие рассуждения (Chain-of-Thought) перед тем, как выдать финальный ответ.]"
    : (reasoningLevel === "medium" ? "\n[Системное руководство: Подумай пошагово перед тем, как выдать итоговый ответ.]" : "");

  // 1. Separate system and non-system messages
  const systemMessages: any[] = [];
  const nonSystemMessages: any[] = [];
  for (const msg of openAiBody.messages || []) {
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
  if (cotPrompt) {
    if (systemContent) {
      systemContent += cotPrompt;
    } else {
      systemContent = cotPrompt.trim();
    }
  }

  // 4. Assemble the final GigaChat messages array
  const gigaMessages: any[] = [];
  if (systemContent) {
    gigaMessages.push({
      role: "system",
      content: systemContent
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
      (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) ||
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
    } else if (msg.content === null || msg.content === undefined || (msg.content === "" && hasFunctionCall)) {
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
              logger.log("Intercepted base64 image. Uploading to GigaChat files...");
              const fileId = await uploadBase64File(urlStr, token, verifySsl, caBundle);
              attachments.push(fileId);
            } catch (err: any) {
              logger.error("Failed to upload message image:", err.message);
              if (textContent) textContent += "\n";
              textContent += "[Image Upload Failed]";
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
    if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      gigaMsg.function_call = {
        name: getToolAlias(msg.tool_calls[0].function?.name),
        arguments: parseArgumentsToObject(msg.tool_calls[0].function?.arguments)
      };
    } else if (msg.function_call) {
      gigaMsg.function_call = {
        name: getToolAlias(msg.function_call.name),
        arguments: parseArgumentsToObject(msg.function_call.arguments)
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


  gigaBody.messages = gigaMessages;

  // 2. Map Tools & Functions FIRST (before response_format, since they conflict)
  const hasTools = (openAiBody.tools && Array.isArray(openAiBody.tools) && openAiBody.tools.length > 0) ||
                   (openAiBody.functions && Array.isArray(openAiBody.functions) && openAiBody.functions.length > 0);

  if (openAiBody.tools && Array.isArray(openAiBody.tools)) {
    gigaBody.functions = openAiBody.tools.map((t: any) => ({
      name: getToolAlias(t.function?.name),
      description: t.function?.description || "",
      // Sanitize parameters: remove additionalProperties, $schema etc. that GigaChat rejects
      parameters: sanitizeFunctionParameters(t.function?.parameters) || { type: "object", properties: {} }
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
    } else if (openAiBody.tool_choice && typeof openAiBody.tool_choice === "object") {
      if (openAiBody.tool_choice.function?.name) {
        gigaBody.function_call = {
          name: getToolAlias(openAiBody.tool_choice.function.name)
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
      parameters: sanitizeFunctionParameters(f.parameters) || { type: "object", properties: {} }
    }));
    if (openAiBody.function_call) {
      if (typeof openAiBody.function_call === "string") {
        gigaBody.function_call = openAiBody.function_call;
      } else if (typeof openAiBody.function_call === "object") {
        gigaBody.function_call = {
          name: getToolAlias(openAiBody.function_call.name)
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
          strict: openAiBody.response_format.json_schema?.strict !== undefined
            ? !!openAiBody.response_format.json_schema.strict
            : undefined
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

// Uploads base64 image data to GigaChat /files endpoint and returns file_id
async function uploadBase64File(
  base64DataUrl: string,
  token: string,
  verifySsl: boolean,
  caBundle: string
): Promise<string> {
  const matches = base64DataUrl.match(/^data:([A-Za-z0-9\-+.\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 data URL format");
  }

  const mimeType = matches[1];
  const dataString = matches[2];
  if (!mimeType || !dataString) {
    throw new Error("Invalid base64 data URL parts");
  }

  const buffer = Buffer.from(dataString, "base64");

  let ext = "png";
  if (mimeType.includes("jpeg")) ext = "jpg";
  else if (mimeType.includes("webp")) ext = "webp";

  const tempFileName = `upload_${Date.now()}.${ext}`;
  const url = "https://ngw.devices.sberbank.ru:9443/api/v2/files";
  
  const form = new FormData();
  form.append("file", buffer, {
    filename: tempFileName,
    contentType: mimeType
  });
  form.append("purpose", "general");

  const headers = {
    ...form.getHeaders(),
    "Authorization": `Bearer ${token}`,
    "RqUID": uuidv4()
  };

  const httpsAgent = getHttpsAgent(verifySsl, caBundle);

  try {
    const response = await axios.post(url, form, {
      headers,
      httpsAgent,
      timeout: 30000
    });

    return response.data.id;
  } catch (err: unknown) {
    throw sanitizeError(err);
  }
}

// ============================================================================
// 2. Global Fetch Interceptor for Protocol Translation
// ============================================================================

const gigaHosts = new Set<string>([
  "api.gigachat.local",
  "ngw.devices.sberbank.ru",
  "ngw.devices.sberbank.ru:9443",
  "gigachat.devices.sberbank.ru"
]);

export function registerGigaEndpoint(url: string): void {
  if (!url) return;
  try {
    let hostVal = "";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      hostVal = new URL(url).host;
    } else {
      hostVal = new URL("https://" + url).host;
    }
    if (hostVal) {
      gigaHosts.add(hostVal);
      logger.log(`Registered custom GigaChat host: ${hostVal}`);
    }
  } catch (e) {
    const cleaned = url.replace(/https?:\/\//, "").split("/")[0];
    if (cleaned) {
      gigaHosts.add(cleaned);
      logger.log(`Registered custom GigaChat host (fallback): ${cleaned}`);
    }
  }
}

function extractBodyText(body: BodyInit | null | undefined): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  // For other types (ReadableStream, FormData, etc.), return empty string
  // to avoid "[object ReadableStream]" garbage
  return "";
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  if (typeof (headers as any).forEach === "function") {
    (headers as Headers).forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = value;
    }
    return out;
  }

  return { ...(headers as Record<string, string>) };
}

function removeHeaderCaseInsensitive(headers: Record<string, string>, headerName: string): void {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === headerName.toLowerCase());
  if (existingKey) {
    delete headers[existingKey];
  }
}

function translateStreamChunk(sberJson: any, streamToolCallIds: Map<string, string>): any {
  return {
    id: sberJson.id || `chatcmp-${uuidv4()}`,
    object: "chat.completion.chunk",
    created: sberJson.created || Math.floor(Date.now() / 1000),
    model: sberJson.model || "GigaChat-Max",
    choices: (sberJson.choices || []).map((c: any) => {
      const delta: any = {
        role: c.delta?.role,
        content: c.delta?.content || ""
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
          callId = `call_${uuidv4()}`;
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
              arguments: stringifyArguments(c.delta.function_call.arguments)
            }
          }
        ];
        finishReason = "tool_calls";
      } else if (c.delta?.tool_calls) {
        delta.tool_calls = c.delta.tool_calls;
      }

      return {
        index: c.index ?? 0,
        delta,
        finish_reason: finishReason
      };
    })
  };
}

export function setupGlobalFetchInterceptor(authManager: GigaCodeAuthManager): void {
  const originalFetch = globalThis.fetch;

  (globalThis as any).fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let requestUrl = "";
    let method = "GET";
    let bodyText = "";

    if (typeof input === "string") {
      requestUrl = input;
      method = init?.method || "GET";
      bodyText = extractBodyText(init?.body);
    } else if (input instanceof URL) {
      requestUrl = input.toString();
      method = init?.method || "GET";
      bodyText = extractBodyText(init?.body);
    } else {
      requestUrl = input.url;
      method = init?.method || input.method || "GET";
      if (init?.body) {
        bodyText = extractBodyText(init.body);
      } else {
        try {
          const cloned = input.clone();
          bodyText = await cloned.text();
        } catch (e) {
          bodyText = "";
        }
      }
    }

    let requestHost = "";
    try {
      if (requestUrl.startsWith("http://") || requestUrl.startsWith("https://")) {
        requestHost = new URL(requestUrl).host;
      } else {
        requestHost = new URL("https://" + requestUrl).host;
      }
    } catch (e) {}

    let hasMarker = false;
    const inputHeaders = typeof input === "string" || input instanceof URL ? undefined : input.headers;
    const requestHeaders = init?.headers || inputHeaders;
    if (requestHeaders) {
      if (typeof (requestHeaders as any).get === "function") {
        const headersInstance = requestHeaders as any;
        const markerVal = headersInstance.get("x-opencode-provider-marker");
        if (markerVal === "gigacode" || markerVal === "gigachat") {
          hasMarker = true;
          try {
            headersInstance.delete("x-opencode-provider-marker");
          } catch (e) {}
        }
      } else if (Array.isArray(requestHeaders)) {
        const headersArray = requestHeaders as [string, string][];
        const index = headersArray.findIndex(
          ([key]) => key.toLowerCase() === "x-opencode-provider-marker"
        );
        if (index >= 0) {
          const val = headersArray[index]?.[1];
          if (val === "gigacode" || val === "gigachat") {
            hasMarker = true;
          }
          headersArray.splice(index, 1);
        }
      } else {
        const headersRecord = requestHeaders as Record<string, string>;
        const markerKey = Object.keys(headersRecord).find(
          k => k.toLowerCase() === "x-opencode-provider-marker"
        );
        if (markerKey) {
          const val = headersRecord[markerKey];
          if (val === "gigacode" || val === "gigachat") {
            hasMarker = true;
          }
          delete headersRecord[markerKey];
        }
      }
    }

    const isKnownGigaHost = !!requestHost && gigaHosts.has(requestHost);
    const isGigaRequest = hasMarker || isKnownGigaHost;
    
    if (isGigaRequest) {
      const isChat = requestUrl.includes("/chat/completions");
      const isFiles = requestUrl.includes("/files");
      
      let targetUrl = requestUrl;
      if (requestHost === "api.gigachat.local") {
        if (isChat) targetUrl = GIGACHAT_COMPLETIONS_URL;
        else if (isFiles) targetUrl = "https://ngw.devices.sberbank.ru:9443/api/v2/files";
        else targetUrl = requestUrl.replace("api.gigachat.local/v1", "ngw.devices.sberbank.ru:9443/api/v2");
      }

      logger.log(`Intercepting ${method} request to: ${requestUrl} -> ${targetUrl}`);

      try {
        const { token } = await authManager.getAccessToken();
        const verifySsl = typeof authManager.getVerifySsl === "function" ? authManager.getVerifySsl() : shouldVerifySsl();
        const caBundle = typeof authManager.getCaBundle === "function" ? authManager.getCaBundle() : (process.env.GIGACHAT_CA_BUNDLE_FILE || DEFAULT_CA_BUNDLE_FILE);
        const httpsAgent = getHttpsAgent(verifySsl, caBundle);

        const sberHeaders: Record<string, string> = {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "RqUID": uuidv4()
        };

        // If it is a JSON Chat Completions request, translate payload
        if (isChat) {
          sberHeaders["Content-Type"] = "application/json";
          
          let openAiBody: any = {};
          if (bodyText) {
            openAiBody = JSON.parse(bodyText);
          }
          const gigaBody = await translateOpenAiToGigaChat(openAiBody, token, verifySsl, caBundle);

          logger.log("Forwarding translated request to GigaChat API completions...");
          logger.log("Translated GigaChat Request Body:", JSON.stringify(gigaBody));

          if (gigaBody.stream) {
            const sberResponse = await axios.post(targetUrl, gigaBody, {
              headers: sberHeaders,
              httpsAgent,
              responseType: "stream",
              timeout: 60000
            });

            const stream = sberResponse.data;
            let buffer = "";
            const streamToolCallIds = new Map<string, string>();

            const translatedStream = new ReadableStream({
              start(controller) {
                stream.on("data", (chunk: Buffer) => {
                  buffer += chunk.toString("utf8");
                  const lines = buffer.split("\n");
                  
                  buffer = lines.pop() || "";

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    
                    if (trimmed.startsWith("data: ")) {
                      const dataText = trimmed.slice(6);
                      if (dataText === "[DONE]") {
                        controller.enqueue(Buffer.from("data: [DONE]\n\n", "utf8"));
                      } else {
                        try {
                          const sberJson = JSON.parse(dataText);
                          const openAiJson = translateStreamChunk(sberJson, streamToolCallIds);
                          controller.enqueue(Buffer.from(`data: ${JSON.stringify(openAiJson)}\n\n`, "utf8"));
                        } catch (err) {
                          controller.enqueue(Buffer.from(`${line}\n`, "utf8"));
                        }
                      }
                    } else {
                      controller.enqueue(Buffer.from(`${line}\n`, "utf8"));
                    }
                  }
                });

                stream.on("end", () => {
                  if (buffer.trim()) {
                    const trimmed = buffer.trim();
                    if (trimmed.startsWith("data: ")) {
                      const dataText = trimmed.slice(6);
                      if (dataText === "[DONE]") {
                        controller.enqueue(Buffer.from("data: [DONE]\n\n", "utf8"));
                      } else {
                        try {
                          const sberJson = JSON.parse(dataText);
                          const openAiJson = translateStreamChunk(sberJson, streamToolCallIds);
                          controller.enqueue(Buffer.from(`data: ${JSON.stringify(openAiJson)}\n\n`, "utf8"));
                        } catch (err) {
                          controller.enqueue(Buffer.from(`${buffer}\n`, "utf8"));
                        }
                      }
                    } else {
                      controller.enqueue(Buffer.from(`${buffer}\n`, "utf8"));
                    }
                  }
                  controller.close();
                });

                stream.on("error", (err: any) => {
                  controller.error(err);
                });
              }
            });

            return new Response(translatedStream, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
              }
            });
          } else {
            const sberResponse = await axios.post(targetUrl, gigaBody, {
              headers: sberHeaders,
              httpsAgent,
              timeout: 60000
            });

            const openAiResponse = translateGigaChatToOpenAi(sberResponse.data);

            return new Response(JSON.stringify(openAiResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
        } else {
          // If it is binary / files API or metadata request, forward it directly without JSON parsing
          logger.log("Direct proxying GigaChat API call...");
          
          Object.assign(sberHeaders, headersToRecord(inputHeaders));
          Object.assign(sberHeaders, headersToRecord(init?.headers));
          // Remove Authorization header from user input to prefer our clean OAuth token
          removeHeaderCaseInsensitive(sberHeaders, "authorization");
          removeHeaderCaseInsensitive(sberHeaders, "x-opencode-provider-marker");
          sberHeaders["Authorization"] = `Bearer ${token}`;

          const response = await axios({
            url: targetUrl,
            method: method as any,
            headers: sberHeaders,
            data: init?.body || bodyText,
            httpsAgent,
            responseType: "arraybuffer",
            timeout: 60000
          });

          const responseHeaders = new Headers();
          for (const key of Object.keys(response.headers)) {
            const val = response.headers[key];
            if (val !== undefined) {
              responseHeaders.append(key, Array.isArray(val) ? val.join(", ") : String(val));
            }
          }

          return new Response(response.data, {
            status: response.status,
            headers: responseHeaders
          });
        }
      } catch (err: unknown) {
        let sberErrorMessage = "";
        if (axios.isAxiosError(err) && err.response?.data) {
          try {
            const rawBody = err.response.data;
            let errBody = "";
            if (rawBody && typeof rawBody.on === "function") {
              errBody = await new Promise<string>((resolve) => {
                let data = "";
                rawBody.on("data", (chunk: any) => {
                  data += chunk.toString("utf8");
                });
                rawBody.on("end", () => resolve(data));
                rawBody.on("error", () => resolve(""));
                setTimeout(() => resolve(data), 2000);
              });
            } else if (rawBody instanceof ArrayBuffer || rawBody instanceof Buffer) {
              errBody = new TextDecoder().decode(rawBody);
            } else if (typeof rawBody === "string") {
              errBody = rawBody;
            } else {
              errBody = JSON.stringify(rawBody);
            }
            logger.error("Sberbank API Error details:", errBody);
            
            const dataObj = JSON.parse(errBody);
            sberErrorMessage = dataObj.message || dataObj.error?.message || "";
          } catch (e) {}
        }
        const cleanErr = sanitizeError(err);
        logger.error("Interception translation failed:", cleanErr.message);
        
        const status = (cleanErr as any).status || 500;
        if (status === 429) {
          authManager.blockActiveAccount("HTTP 429 Rate Limited");
        } else if (status === 403) {
          authManager.blockActiveAccount("HTTP 403 Quota/Billing Exhausted");
        }

        const errMsg = sberErrorMessage 
          ? `GigaChat Translation Proxy Error: ${cleanErr.message} (${sberErrorMessage})`
          : `GigaChat Translation Proxy Error: ${cleanErr.message}`;

        const errorPayload = {
          error: {
            message: errMsg,
            type: "api_error",
            code: status
          }
        };

        return new Response(JSON.stringify(errorPayload), {
          status,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return originalFetch.apply(this, arguments as any);
  };
}

export function translateGigaChatToOpenAi(sberResponse: any): any {
  return {
    id: sberResponse.id || `chatcmp-${uuidv4()}`,
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
          content: c.message?.content || ""
        },
        finish_reason: finishReason
      };

      if (c.message?.reasoning_content) {
        choice.message.reasoning_content = c.message.reasoning_content;
      }

      if (c.message?.function_call) {
        // GigaChat returns arguments as an object; OpenAI clients expect a JSON string
        choice.message.tool_calls = [
          {
            id: `call_${uuidv4()}`,
            type: "function",
            function: {
              name: getOriginalToolName(c.message.function_call.name),
              arguments: stringifyArguments(c.message.function_call.arguments)
            }
          }
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
      total_tokens: 0
    }
  };
}

export function validateMessagePayload(content: string): void {
  const payloadBytes = Buffer.byteLength(content, "utf8");
  const limitBytes = 400 * 1024; // 400 KB warning threshold
  
  if (payloadBytes > limitBytes) {
    logger.warn(
      `WARNING: Content size (${Math.round(payloadBytes / 1024)} KB) is large. ` +
      "GigaChat models will fail if combined content exceeds the 128K token context window."
    );
  }
}

export function transformRequestOptions(
  options: any,
  token: string,
  verifySsl: boolean,
  caBundlePath?: string
): any {
  options.headers = {
    ...options.headers,
    "Authorization": `Bearer ${token}`,
    "RqUID": uuidv4()
  };

  options.httpsAgent = getHttpsAgent(verifySsl, caBundlePath || DEFAULT_CA_BUNDLE_FILE);
  return options;
}

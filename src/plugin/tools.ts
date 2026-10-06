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
export function sanitizeFunctionParameters(params: any): any {
  if (!params || typeof params !== "object") return params;
  if (Array.isArray(params)) return params.map(sanitizeFunctionParameters);
  const out: any = {};
  for (const key of Object.keys(params)) {
    // Drop fields GigaChat API rejects
    if (
      key === "additionalProperties" ||
      key === "$schema" ||
      key === "nullable"
    )
      continue;
    const val = params[key];
    if (key === "properties" && val !== null && typeof val === "object") {
      out[key] = {};
      for (const propKey of Object.keys(val)) {
        out[key][propKey] = sanitizeFunctionParameters(val[propKey]);
      }
    } else if (Array.isArray(val)) {
      out[key] = val.map((item: any) =>
        typeof item === "object" ? sanitizeFunctionParameters(item) : item,
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
export function parseArgumentsToObject(args: any): any {
  if (args === null || args === undefined) return {};
  if (typeof args === "object") return args;
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Ensure function call arguments are a JSON string for the OpenAI response format.
 * OpenAI clients expect arguments as a JSON string.
 */
export function stringifyArguments(args: any): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args ?? {}) ?? "{}";
  } catch {
    return "{}";
  }
}

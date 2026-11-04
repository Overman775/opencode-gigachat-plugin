import { describe, it, expect } from "vitest";
import { sanitizeFunctionParameters } from "./tools.js";

/**
 * Keys GigaChat rejects anywhere in a tool schema. `sanitizeFunctionParameters`
 * has to remove them at every nesting level, together with `type` unions such
 * as `["string", "null"]` that OpenCode 2.x emits for optional arguments.
 */
const FORBIDDEN_KEYS = ["additionalProperties", "$schema", "nullable", "format"];

/** Values that hold data rather than a schema, so keyword checks do not apply. */
const DATA_KEYS = ["enum", "const", "default", "examples"];

/** Maps whose keys are names, not keywords, and whose values are schemas. */
const SCHEMA_MAPS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
];

/** Collects everything GigaChat would answer 422 about. */
function collectViolations(node: unknown, path = "schema"): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) =>
      collectViolations(item, `${path}[${index}]`),
    );
  }
  if (!node || typeof node !== "object") return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = `${path}.${key}`;
    // An argument may legitimately be called `format` or `nullable`; only the
    // schema keywords are rejected, so names inside these maps are left alone.
    if (SCHEMA_MAPS.includes(key) && value && typeof value === "object") {
      for (const [name, schema] of Object.entries(
        value as Record<string, unknown>,
      )) {
        found.push(...collectViolations(schema, `${here}.${name}`));
      }
      continue;
    }
    if (DATA_KEYS.includes(key)) continue;
    if (FORBIDDEN_KEYS.includes(key)) {
      found.push(`${here} is rejected by GigaChat`);
    }
    if (key === "type" && Array.isArray(value)) {
      found.push(`${here} is a type union`);
    }
    found.push(...collectViolations(value, here));
  }
  return found;
}

/** Roughly what OpenCode 2.x sends for the tools of an agent session. */
const openCodeSchemas: Record<string, any> = {
  plan: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      planId: { type: ["string", "null"], description: "Identifier of the plan" },
      status: {
        type: ["string", "null"],
        enum: ["pending", "in_progress", "completed", "cancelled"],
      },
      updatedAt: { type: "string", format: "date-time" },
      items: {
        type: "array",
        additionalProperties: false,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: ["string", "null"] },
            tags: {
              type: "array",
              items: { type: ["string", "null"] },
            },
            meta: { type: ["null"], description: "Only null is allowed here" },
          },
          required: ["id"],
        },
      },
    },
    required: ["planId"],
  },
  read: {
    type: "object",
    additionalProperties: false,
    properties: {
      filePath: { type: "string", format: "uri" },
      offset: { type: ["integer", "null"] },
      limit: { type: ["integer", "null"] },
      includeLineNumbers: { type: ["boolean", "null"], nullable: true },
    },
    required: ["filePath"],
  },
  webfetch: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      format: { type: ["string", "null"], enum: ["markdown", "text", "html"] },
      timeout: { type: ["number", "null"], description: "Seconds" },
    },
    required: ["url"],
  },
};

/** Wraps a schema fragment the way OpenCode buries it in a tool definition. */
const placements: Array<[string, (fragment: any) => any]> = [
  ["at the top level", (fragment) => fragment],
  ["as a property", (fragment) => ({ type: "object", properties: { value: fragment } })],
  [
    "as array items",
    (fragment) => ({ type: "object", properties: { list: { type: "array", items: fragment } } }),
  ],
  [
    "inside a nested object",
    (fragment) => ({
      type: "object",
      properties: { outer: { type: "object", properties: { inner: fragment } } },
    }),
  ],
  [
    "inside anyOf",
    (fragment) => ({ type: "object", properties: { choice: { anyOf: [fragment] } } }),
  ],
  ["inside allOf", (fragment) => ({ allOf: [fragment] })],
];

/** Fragments OpenCode and JSON Schema authors produce, all rejected by GigaChat. */
const hostileFragments: Array<[string, any]> = [
  ['type: ["string", "null"]', { type: ["string", "null"] }],
  ['type: ["null", "integer"]', { type: ["null", "integer"] }],
  ['type: ["null"]', { type: ["null"] }],
  ['type: ["string", "number", "null"]', { type: ["string", "number", "null"] }],
  ['format: "date-time"', { type: "string", format: "date-time" }],
  ["format next to a union", { type: ["string", "null"], format: "uuid" }],
  ["nullable", { type: ["string", "null"], nullable: true }],
  [
    "additionalProperties and $schema",
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: { id: { type: ["string", "null"] } },
    },
  ],
];

describe("tool schema guard", () => {
  it("accepts the schemas OpenCode 2.x generates", () => {
    for (const [name, schema] of Object.entries(openCodeSchemas)) {
      expect(collectViolations(sanitizeFunctionParameters(schema)), name).toEqual(
        [],
      );
    }
  });

  it("catches the unfixed schema, so the guard is not vacuous", () => {
    const violations = collectViolations(openCodeSchemas.plan);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join("\n")).toContain("schema.properties.planId.type");
  });

  it("removes rejectable constructs wherever they sit", () => {
    for (const [placementName, place] of placements) {
      for (const [fragmentName, fragment] of hostileFragments) {
        const raw = place(fragment);
        const where = `${fragmentName} ${placementName}`;
        expect(collectViolations(raw).length, `raw ${where}`).toBeGreaterThan(0);
        expect(
          collectViolations(sanitizeFunctionParameters(raw)),
          `sanitized ${where}`,
        ).toEqual([]);
      }
    }
  });

  it("keeps the parts of a schema GigaChat accepts", () => {
    const sanitized = sanitizeFunctionParameters({
      type: "object",
      properties: {
        count: { type: "integer", minimum: 0, maximum: 10 },
        kind: { type: "string", enum: ["a", "b"] },
        pairs: { type: "array", enum: [["a", "b"]] },
        nothing: { properties: null },
        format: { type: "string", enum: ["markdown", "text"] },
      },
      required: ["count"],
    });

    expect(sanitized).toEqual({
      type: "object",
      properties: {
        count: { type: "integer", minimum: 0, maximum: 10 },
        kind: { type: "string", enum: ["a", "b"] },
        pairs: { type: "array", enum: [["a", "b"]] },
        nothing: { properties: null },
        // Only the schema keyword is rejected; an argument may be named `format`.
        format: { type: "string", enum: ["markdown", "text"] },
      },
      required: ["count"],
    });
    expect(collectViolations(sanitized)).toEqual([]);
  });
});

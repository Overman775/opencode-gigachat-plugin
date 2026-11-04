import { describe, it, expect } from "vitest";
import { sanitizeFunctionParameters } from "./tools.js";

describe("sanitizeFunctionParameters", () => {
  it("collapses a type union to its first non-null member", () => {
    expect(
      sanitizeFunctionParameters({
        type: "object",
        properties: {
          planId: { type: ["string", "null"], description: "Plan id" },
          count: { type: ["null", "integer"] },
          anything: { type: ["null"] },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan id" },
        count: { type: "integer" },
        anything: { type: "string" },
      },
    });
  });

  it("drops format and the other fields GigaChat rejects, at every depth", () => {
    expect(
      sanitizeFunctionParameters({
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        type: "object",
        properties: {
          due: { type: "string", format: "date-time", nullable: true },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { id: { type: "string", format: "uuid" } },
            },
          },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        due: { type: "string" },
        items: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" } } },
        },
      },
    });
  });

  it("keeps array enum values, null properties and plain type strings", () => {
    expect(
      sanitizeFunctionParameters({
        type: "string",
        enum: [[1, 2]],
        properties: null,
      }),
    ).toEqual({ type: "string", enum: [[1, 2]], properties: null });
  });
});

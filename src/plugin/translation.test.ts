import { default as axios } from "axios";
import { describe, it, expect, vi } from "vitest";
import {
  translateOpenAiToGigaChat,
  transformRequestOptions,
  getToolAlias,
  translateGigaChatToOpenAi,
} from "./request.js";
import { BUILTIN_CA_BUNDLE } from "../gigacode/certs.js";
import { sanitizeFunctionParameters, stringifyArguments } from "./tools.js";

describe("GigaChat Request Translator", () => {
  it("handles nullable schema fields and nested arrays without corrupting their shape", () => {
    expect(
      sanitizeFunctionParameters({
        properties: null,
        enum: [[1, 2]],
        additionalProperties: false,
      }),
    ).toEqual({ properties: null, enum: [[1, 2]] });
    expect(stringifyArguments(undefined)).toBe("{}");
    expect(stringifyArguments(null)).toBe("{}");
  });

  it("rejects an upload response without a usable file ID", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: {} });
    try {
      await expect(
        translateOpenAiToGigaChat(
          {
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: "data:image/png;base64,aW1hZ2U=" },
                  },
                ],
              },
            ],
          },
          "token",
          true,
          "ca",
        ),
      ).rejects.toThrow("No file ID returned");
    } finally {
      post.mockRestore();
    }
  });

  it("should translate basic OpenAI chat completion request to GigaChat format", async () => {
    const openAiRequest = {
      model: "GigaChat-Max",
      messages: [{ role: "user", content: "Hello world" }],
      temperature: 0.8,
      stream: true,
      max_tokens: 512,
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );

    expect(gigaRequest.model).toBe("GigaChat-Max");
    expect(gigaRequest.messages).toHaveLength(1);
    expect(gigaRequest.messages[0]).toEqual({
      role: "user",
      content: "Hello world",
    });
    expect(gigaRequest.temperature).toBe(0.8);
    expect(gigaRequest.stream).toBe(true);
    expect(gigaRequest.max_tokens).toBe(512);
  });

  it("should fall back to GigaChat-Max model name if undefined", async () => {
    const openAiRequest = {
      messages: [{ role: "user", content: "Test model name fallback" }],
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );
    expect(gigaRequest.model).toBe("GigaChat-Max");
  });

  it("should map GigaChat-2-Lite model to GigaChat-2", async () => {
    const openAiRequest = {
      model: "GigaChat-2-Lite",
      messages: [{ role: "user", content: "Test model name mapping" }],
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );
    expect(gigaRequest.model).toBe("GigaChat-2");
  });

  it("should translate reasoning_effort parameter by injecting a system instruction", async () => {
    const openAiRequest = {
      messages: [{ role: "user", content: "Thinking test" }],
      reasoning_effort: "HIGH",
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );
    expect(gigaRequest.reasoning_effort).toBeUndefined();
    expect(gigaRequest.messages).toHaveLength(2);
    expect(gigaRequest.messages[0].role).toBe("system");
    expect(gigaRequest.messages[0].content).toContain("Chain-of-Thought");
  });

  it("should translate thinking budget block by injecting a system instruction", async () => {
    const openAiRequestMedium = {
      messages: [{ role: "user", content: "Thinking test" }],
      thinking: { budget_tokens: 512 },
    };
    const openAiRequestHigh = {
      messages: [{ role: "user", content: "Thinking test" }],
      thinking: { budget_tokens: 2048 },
    };

    const gigaRequestMedium = await translateOpenAiToGigaChat(
      openAiRequestMedium,
      "mock-token",
      true,
      "mock-ca",
    );
    expect(gigaRequestMedium.reasoning_effort).toBeUndefined();
    expect(gigaRequestMedium.messages[0].content).toContain("Подумай пошагово");

    const gigaRequestHigh = await translateOpenAiToGigaChat(
      openAiRequestHigh,
      "mock-token",
      true,
      "mock-ca",
    );
    expect(gigaRequestHigh.reasoning_effort).toBeUndefined();
    expect(gigaRequestHigh.messages[0].content).toContain("Chain-of-Thought");
  });

  it("should map json_schema response format to GigaChat JSON schema", async () => {
    const openAiRequest = {
      messages: [{ role: "user", content: "JSON schema test" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: {
            type: "object",
            properties: {
              result: { type: "string" },
            },
          },
        },
      },
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );
    // GigaChat uses type "json_schema" (not "json") when a schema is provided
    expect(gigaRequest.response_format.type).toBe("json_schema");
    expect(gigaRequest.response_format.schema.type).toBe("object");
    expect(gigaRequest.response_format.schema.properties.result.type).toBe(
      "string",
    );
  });

  it("should carry over tool usage history and map developer role", async () => {
    const openAiRequest = {
      messages: [
        { role: "developer", content: "System directives" },
        { role: "user", content: "Call a tool please" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location":"Moscow"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          name: "get_weather",
          content: '{"temp": 20}',
        },
      ],
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );

    expect(gigaRequest.messages).toHaveLength(4);
    // Developer mapped to system
    expect(gigaRequest.messages[0].role).toBe("system");
    // Assistant message tool_calls carried over to function_call
    expect(gigaRequest.messages[2].role).toBe("assistant");
    expect(gigaRequest.messages[2].content).toBeNull();
    expect(gigaRequest.messages[2].function_call).toBeDefined();
    expect(gigaRequest.messages[2].function_call.name).toBe(
      getToolAlias("get_weather"),
    );
    // GigaChat v1 API requires arguments as an object (Map<String,Object>), not a JSON string
    expect(gigaRequest.messages[2].function_call.arguments).toEqual({
      location: "Moscow",
    });
    // Tool message fields carried over
    expect(gigaRequest.messages[3].role).toBe("function");
    expect(gigaRequest.messages[3].name).toBe(getToolAlias("get_weather"));
    expect(gigaRequest.messages[3].content).toBe('{"temp": 20}');
  });

  it("should carry over stop sequences and map object tool_choice", async () => {
    const openAiRequest = {
      messages: [{ role: "user", content: "Test stop and tool choice" }],
      stop: ["\n", "###"],
      tools: [
        {
          type: "function",
          function: { name: "test_fn", parameters: {} },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "test_fn" },
      },
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );

    expect(gigaRequest.stop).toEqual(["\n", "###"]);
    // Object tool_choice mapped to function_call object
    expect(gigaRequest.function_call).toEqual({
      name: getToolAlias("test_fn"),
    });
  });

  it("should remove nullable from nested JSON schemas sent to GigaChat", async () => {
    const openAiRequest = {
      messages: [{ role: "user", content: "Use a nullable schema" }],
      tools: [
        {
          type: "function",
          function: {
            name: "nullable_tool",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                maybeText: {
                  type: "string",
                  nullable: true,
                },
              },
            },
          },
        },
      ],
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );

    expect(
      gigaRequest.functions[0].parameters.additionalProperties,
    ).toBeUndefined();
    expect(
      gigaRequest.functions[0].parameters.properties.maybeText.nullable,
    ).toBeUndefined();
  });

  it("should merge multiple system/developer messages and place the merged message at index 0", async () => {
    const openAiRequest = {
      messages: [
        { role: "user", content: "Hello" },
        { role: "developer", content: "Instruction 1" },
        { role: "user", content: "How are you?" },
        { role: "system", content: "Instruction 2" },
      ],
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );

    expect(gigaRequest.messages).toHaveLength(3); // 1 merged system, 2 user messages
    expect(gigaRequest.messages[0]).toEqual({
      role: "system",
      content: "Instruction 1\nInstruction 2",
    });
    expect(gigaRequest.messages[1]).toEqual({
      role: "user",
      content: "Hello",
    });
    expect(gigaRequest.messages[2]).toEqual({
      role: "user",
      content: "How are you?",
    });
  });

  it("should translate array content to flat string content and attachments list", async () => {
    const mockPost = vi.spyOn(axios, "post").mockResolvedValue({
      data: { id: "test-file-id" },
    } as any);

    const openAiRequest = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this image:" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ],
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      false,
      "mock-ca",
    );
    expect(gigaRequest.messages).toHaveLength(1);
    expect(gigaRequest.messages[0].role).toBe("user");
    expect(gigaRequest.messages[0].content).toContain("Analyze this image:");
    expect(gigaRequest.messages[0].attachments).toBeDefined();
    expect(gigaRequest.messages[0].attachments).toEqual(["test-file-id"]);

    mockPost.mockRestore();
  });

  it("should map reasoning_content from GigaChat response to OpenAI response structure", () => {
    const sberResponse = {
      id: "test-id",
      model: "GigaChat-Max",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Response content",
            reasoning_content: "Reasoning content",
          },
          finish_reason: "stop",
        },
      ],
    };

    const openAiResponse = translateGigaChatToOpenAi(sberResponse);
    expect(openAiResponse.choices[0].message.reasoning_content).toBe(
      "Reasoning content",
    );
  });

  it("should inject authorization headers and mTLS agent in request options", () => {
    const options: any = { headers: {} };
    const transformed = transformRequestOptions(
      options,
      "test-jwt",
      true,
      "nonexistent-ca.pem",
    );

    expect(transformed.headers.Authorization).toBe("Bearer test-jwt");
    expect(transformed.headers.RqUID).toBeDefined();
    expect(transformed.httpsAgent).toBeDefined();
    const firstCert =
      BUILTIN_CA_BUNDLE.split("-----END CERTIFICATE-----")[0] +
      "-----END CERTIFICATE-----";
    expect(transformed.httpsAgent.options.ca).toContain(firstCert);
  });
  it("should ensure function/tool messages serialize their content as valid JSON strings", async () => {
    const openAiRequest = {
      model: "GigaChat-Max",
      messages: [
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: { name: "test_tool", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "some text content",
        },
      ],
    };

    const gigaRequest = await translateOpenAiToGigaChat(
      openAiRequest,
      "mock-token",
      true,
      "mock-ca",
    );

    // The assistant message content should be null since it has tool_calls
    expect(gigaRequest.messages[1].content).toBeNull();
    // The tool message should be translated to a function message with name, and content should be serialized to a valid JSON string
    expect(gigaRequest.messages[2].role).toBe("function");
    expect(gigaRequest.messages[2].name).toBe(getToolAlias("test_tool"));
    expect(gigaRequest.messages[2].content).toBe(
      JSON.stringify("some text content"),
    );

    // If the tool output is already a valid JSON string, it should be kept as-is
    const openAiRequestJson = {
      model: "GigaChat-Max",
      messages: [
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: { name: "test_tool", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"result":"success"}',
        },
      ],
    };

    const gigaRequestJson = await translateOpenAiToGigaChat(
      openAiRequestJson,
      "mock-token",
      true,
      "mock-ca",
    );
    expect(gigaRequestJson.messages[2].content).toBe('{"result":"success"}');
  });
});

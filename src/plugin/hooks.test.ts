import type { Model, Provider, UserMessage } from "@opencode-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GigaCodeAuthManager } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";
import { createAuthHook } from "./auth-hooks.js";
import { createPluginHooks } from "./hooks.js";

function fixture(
  providerID = "GigaChat (Sberbank)",
  options: Record<string, unknown> = {},
) {
  const modalities = {
    text: true,
    audio: false,
    image: false,
    video: false,
    pdf: false,
  };
  const model: Model = {
    id: "GigaChat",
    providerID,
    name: "GigaChat",
    api: {
      id: "GigaChat",
      url: "https://api.gigachat.local/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: modalities,
      output: modalities,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 32000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  };
  const info: Provider = {
    id: providerID,
    name: providerID,
    source: "config",
    env: [],
    options,
    models: { GigaChat: model },
  };
  const message: UserMessage = {
    id: "message",
    sessionID: "session",
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID, modelID: "GigaChat" },
  };
  return {
    input: {
      sessionID: "session",
      agent: "build",
      model,
      provider: { source: "config" as const, info, options },
      message,
    },
    output: {
      temperature: 0.7,
      topP: 1,
      topK: 1,
      maxOutputTokens: undefined,
      options: { headers: { existing: "keep" } },
    },
  };
}

beforeEach(() => {
  vi.stubEnv("GIGACHAT_CREDENTIALS", "");
  vi.stubEnv("GIGACHAT_SCOPE", "");
  vi.spyOn(logger, "log").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("OpenCode hooks", () => {
  it("loads the GigaChat configuration without using another provider's credentials", async () => {
    const manager = new GigaCodeAuthManager();
    const hooks = createPluginHooks(manager);
    await hooks.config!({
      provider: {
        other: { options: { credentials: "unrelated" } },
        gigachat: {
          options: {
            credentials: "configured",
            scope: "GIGACHAT_API_B2B",
            verifySsl: false,
            caBundlePath: "/custom/ca.pem",
          },
        },
      },
    });
    expect(manager.getActiveAccount()?.credentials).toBe("configured");
    expect(manager.getActiveAccount()?.scope).toBe("GIGACHAT_API_B2B");
    expect(manager.getVerifySsl()).toBe(false);
    expect(manager.getCaBundle()).toBe("/custom/ca.pem");
  });

  it("applies TLS configuration while preserving credentials and scope from the environment", async () => {
    vi.stubEnv("GIGACHAT_CREDENTIALS", "environment-key");
    vi.stubEnv("GIGACHAT_SCOPE", "GIGACHAT_API_CORP");
    const manager = new GigaCodeAuthManager();
    await createPluginHooks(manager).config!({
      provider: {
        gigachat: { options: { verifySSL: false, caBundle: "/env/ca.pem" } },
      },
    });
    expect(manager.getActiveAccount()?.credentials).toBe("environment-key");
    expect(manager.getActiveAccount()?.scope).toBe("GIGACHAT_API_CORP");
    expect(manager.getVerifySsl()).toBe(false);
    expect(manager.getCaBundle()).toBe("/env/ca.pem");
  });

  it("does not request tokens or alter parameters for another provider", async () => {
    const manager = new GigaCodeAuthManager();
    const getToken = vi.spyOn(manager, "getAccessToken");
    const { input, output } = fixture("other");
    const before = structuredClone(output);
    await createPluginHooks(manager)["chat.params"]!(input, output);
    expect(getToken).not.toHaveBeenCalled();
    expect(output).toEqual(before);
  });

  it("configures credentials and adds the provider marker while preserving other headers", async () => {
    const manager = new GigaCodeAuthManager();
    vi.spyOn(manager, "getAccessToken").mockImplementation(async () => {
      const account = manager.getActiveAccount();
      if (!account) throw new Error("Missing credentials");
      return { token: "token", account };
    });
    const { input, output } = fixture("gigachat", {
      credentials: "inline-key",
      verifySSL: false,
    });
    await createPluginHooks(manager)["chat.params"]!(input, output);
    expect(manager.getActiveAccount()?.credentials).toBe("inline-key");
    expect(output.options.headers).toEqual({
      existing: "keep",
      "x-opencode-provider-marker": "gigachat",
    });
    expect(manager.getAccessToken).toHaveBeenCalledOnce();
  });

  it("surfaces authorization failures to OpenCode", async () => {
    const manager = new GigaCodeAuthManager();
    vi.spyOn(manager, "getAccessToken").mockRejectedValue(
      new Error("OAuth unavailable"),
    );
    const { input, output } = fixture();
    await expect(
      createPluginHooks(manager)["chat.params"]!(input, output),
    ).rejects.toThrow("OAuth unavailable");
  });

  it("warns about large GigaChat text in bytes and ignores other providers", async () => {
    const { input } = fixture();
    const hooks = createPluginHooks(new GigaCodeAuthManager());
    const output = {
      message: input.message,
      parts: [
        {
          id: "part",
          sessionID: "session",
          messageID: "message",
          type: "text" as const,
          text: "я".repeat(205000),
        },
      ],
    };
    await hooks["chat.message"]!(
      {
        sessionID: "session",
        model: { providerID: "other", modelID: "other" },
      },
      output,
    );
    expect(logger.warn).not.toHaveBeenCalled();
    await hooks["chat.message"]!(
      { sessionID: "session", model: input.message.model },
      output,
    );
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("OpenCode authentication", () => {
  it("loads a stored API key into the active manager and returns flat provider options", async () => {
    const manager = new GigaCodeAuthManager();
    const hook = createAuthHook(manager);
    const { input } = fixture();
    const options = await hook.loader!(
      async () => ({
        type: "api",
        key: "stored-key",
        metadata: { scope: "GIGACHAT_API_B2B" },
      }),
      input.provider.info,
    );
    expect(options).toEqual({
      credentials: "stored-key",
      scope: "GIGACHAT_API_B2B",
    });
    expect(manager.getActiveAccount()?.credentials).toBe("stored-key");
    expect(manager.getActiveAccount()?.scope).toBe("GIGACHAT_API_B2B");
  });

  it("falls back gracefully when the auth store fails", async () => {
    const manager = new GigaCodeAuthManager();
    const { input } = fixture();
    const result = await createAuthHook(manager).loader!(async () => {
      throw new Error("Store unavailable");
    }, input.provider.info);
    expect(result).toEqual({});
    expect(manager.getActiveAccount()).toBeNull();
  });

  it("lets OpenCode collect and store the API key together with scope metadata", () => {
    const method = createAuthHook(new GigaCodeAuthManager()).methods[0];
    expect(method?.type).toBe("api");
    if (method?.type !== "api")
      throw new Error("Missing API authentication method");
    expect(method.authorize).toBeUndefined();
    expect(method.prompts?.map((prompt) => prompt.key)).toEqual(["scope"]);
    expect(method.prompts?.[0]).toMatchObject({
      type: "select",
      options: [
        { value: "GIGACHAT_API_PERS" },
        { value: "GIGACHAT_API_B2B" },
        { value: "GIGACHAT_API_CORP" },
      ],
    });
  });
});

import { Plugin, Provider } from "@opencode/plugin";
import { pathToFileURL } from "node:url";
import { logger } from "../gigacode/logger.js";
import { configureProvider } from "../plugin/provider.js";
import { validateMessagePayload } from "../plugin/validation.js";
import { INTEGRATION_ID, LEGACY_PROVIDER_ID, V2_PROVIDER_ID } from "./constants.js";
import { DEFAULT_IMAGE_MODEL, generateImage } from "./image.js";
import type { ImageGenerationResult } from "./image.js";
import { GIGACHAT_MODELS } from "./models.js";
import { createProviderInfo, mergeModelInfos } from "./provider.js";
import { authManager, accountLimiter, ensureEndpoint, lastDirectory, releaseEndpoint, rememberContext, retainEndpoint, refreshCredentialsFromConnection } from "./runtime.js";

const IMAGE_TOOL_NAME = "gigachat_generate_image";

/**
 * OpenCode V2 entry point.
 *
 * V1 patched `globalThis.fetch`, which V2 never uses for provider traffic.
 * The port therefore registers a provider whose `baseURL` points at a local
 * HTTP endpoint owned by this plugin; OpenCode performs an ordinary request to
 * it and the plugin keeps ownership of TLS and of both format translations.
 */
export const GigachatV2Plugin = Plugin.define({
  id: "opencode.gigachat",
  async setup(ctx) {
    logger.log(`[GigaCode-V2] setup for ${ctx.location.directory}`);
    rememberContext(ctx);
    const endpoint = await ensureEndpoint();
    retainEndpoint();
    configureProviderOptions(ctx.options);

    const providerRegistration = await ctx.provider.transform((editor) => {
      const legacy = editor.get(LEGACY_PROVIDER_ID);
      if (legacy) {
        // Credentials (`credentials`, `scope`, `verifySSL`, `caBundle`) keep coming
        // from the V1 provider options, so existing configuration keeps working.
        configureProviderOptions(legacy.provider.settings);
        // Verified on OpenCode 2.1.4: for a provider declared in `opencode.json`
        // neither `editor.update` nor `editor.remove` survives, because the
        // configuration is re-materialized after plugin transforms run.
      }

      const providerID = Provider.ID.make(V2_PROVIDER_ID);
      const existing = editor.get(V2_PROVIDER_ID);
      if (existing) {
        // Declared by the user with a fixed `baseURL`, so the entry stays theirs;
        // only the model catalog is completed.
        editor.models.set(V2_PROVIDER_ID, mergeModelInfos(providerID, existing.models));
        return;
      }

      editor.add({
        info: createProviderInfo(providerID, endpoint.baseURL),
        models: mergeModelInfos(providerID, new Map()),
      });
    });

    // Auth methods belong to an integration, and OpenCode creates integrations
    // only for providers declared in configuration. Verified on 2.1.4: a custom
    // `key` method with a form (scope select) is replaced by the platform's
    // generic key entry, while an `env` method does survive. Scope for a key
    // login therefore comes from GIGACHAT_SCOPE, not from a prompt.
    let integrationRegistration: { dispose(): Promise<void> } | null = null;
    try {
      integrationRegistration = await ctx.integration.transform((editor) => {
        if (!editor.get(INTEGRATION_ID)) return;
        editor.method.update({
          integrationID: INTEGRATION_ID,
          method: { type: "env", names: ["GIGACHAT_CREDENTIALS"] },
        });
      });
    } catch (error) {
      logger.warn(
        "[GigaCode-V2] Could not register auth methods:",
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      await ctx.session.hook("prompt", (event) => {
        validateMessagePayload(event.prompt.text);
      });
    } catch (error) {
      logger.warn(
        "[GigaCode-V2] Prompt validation hook is unavailable:",
        error instanceof Error ? error.message : String(error),
      );
    }

    // `ctx.setup` runs once per location, so the tool is registered only once.
    let toolRegistration: { dispose(): Promise<void> } | null = null;
    try {
      toolRegistration = await ctx.tool.transform((editor) => {
        if (editor.list().some((tool) => tool.name === IMAGE_TOOL_NAME)) return;
        editor.add({
          name: IMAGE_TOOL_NAME,
          description:
            "Generate an image with GigaChat (built-in text2image function) and save it to a file. " +
            "Use it when the user asks to draw or generate a picture.",
          input: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "What to draw, in natural language",
              },
              path: {
                type: "string",
                description:
                  "Where to save the .jpg file. Relative paths are resolved against the session directory.",
              },
              model: {
                type: "string",
                enum: GIGACHAT_MODELS.map((model) => model.id),
                description: `GigaChat model that draws the image (default ${DEFAULT_IMAGE_MODEL})`,
              },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
          output: {
            type: "object",
            properties: {
              path: { type: "string" },
              fileId: { type: "string" },
            },
            required: ["path", "fileId"],
            additionalProperties: false,
          },
          execute: async (raw) => {
            const input = (raw ?? {}) as Record<string, unknown>;
            const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
            if (!prompt) {
              return { content: "Image generation needs a non-empty `prompt`.", metadata: { error: true } };
            }
            await refreshCredentialsFromConnection();
            const { token, account } = await authManager.getAccessToken();
            // The image request also counts against the account's single
            // in-flight slot, so it queues behind a chat completion.
            await accountLimiter.acquire(account.id);
            let result: ImageGenerationResult;
            try {
              result = await generateImage(
                {
                  prompt,
                  model: typeof input.model === "string" ? input.model : undefined,
                  path: typeof input.path === "string" ? input.path : undefined,
                  directory: lastDirectory(),
                },
                {
                  token,
                  verifySsl: authManager.getVerifySsl(),
                  caBundle: authManager.getCaBundle(),
                },
              );
            } finally {
              accountLimiter.release(account.id);
            }
            return {
              output: { path: result.path, fileId: result.fileId },
              content: [
                {
                  type: "text" as const,
                  text: `Изображение сохранено: ${result.path}`,
                },
                {
                  type: "file" as const,
                  uri: pathToFileURL(result.path).href,
                  mime: "image/jpeg",
                  name: result.path.split(/[\\/]/).pop() ?? "image.jpg",
                },
              ],
              metadata: { path: result.path, fileId: result.fileId },
            };
          },
        });
      });
    } catch (error) {
      logger.warn(
        "[GigaCode-V2] Could not register the image tool:",
        error instanceof Error ? error.message : String(error),
      );
    }

    // Picks up a key stored by `opencode auth login` before the first request.
    await refreshCredentialsFromConnection();
    logger.log(
      `[GigaCode-V2] Endpoint ${endpoint.baseURL}; key sources: stored connection, GIGACHAT_CREDENTIALS, provider options.`,
    );

    return async () => {
      await providerRegistration.dispose();
      if (integrationRegistration) await integrationRegistration.dispose();
      if (toolRegistration) await toolRegistration.dispose();
      await releaseEndpoint();
      logger.log("[GigaCode-V2] registrations disposed");
    };
  },
});

/** Provider options (`credentials`, `scope`, `verifySSL`, `caBundle`) kept from V1. */
function configureProviderOptions(options: unknown): void {
  if (!options || typeof options !== "object") return;
  configureProvider(authManager, options as Record<string, unknown>);
}

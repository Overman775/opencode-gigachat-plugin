import type { Hooks } from "@opencode-ai/plugin";
import { sanitizeError } from "../gigacode/auth.js";
import type { GigaCodeAuthManager } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";
import { createAuthHook } from "./auth-hooks.js";
import { configureProvider, isGigaProvider } from "./provider.js";
import { validateMessagePayload } from "./validation.js";

export function createPluginHooks(authManager: GigaCodeAuthManager): Hooks {
  return {
    auth: createAuthHook(authManager),
    config: async (config) => {
      const providers = config.provider || {};
      const key = Object.keys(providers).find(isGigaProvider);
      const options = key ? providers[key]?.options : undefined;
      if (options) configureProvider(authManager, options);
    },
    "chat.params": async ({ model, provider }, output) => {
      if (!isGigaProvider(model.providerID)) return;
      logger.log(`chat.params hook triggered for model: ${model.id}`);
      configureProvider(authManager, provider.options || {});
      output.options ||= {};
      output.options.headers ||= {};
      output.options.headers["x-opencode-provider-marker"] = "gigachat";
      try {
        const { account } = await authManager.getAccessToken();
        logger.log(`Plugin session active for account: ${account.name}`);
      } catch (error) {
        const cleanError = sanitizeError(error);
        logger.error("Failed to check active account session:", cleanError.message);
        throw cleanError;
      }
    },
    "chat.message": async ({ model }, { parts }) => {
      if (!isGigaProvider(model?.providerID)) return;
      for (const part of parts) {
        if (part.type === "text") validateMessagePayload(part.text);
      }
    },
    "tool.execute.before": async ({ tool, callID }) => {
      logger.log(`Executing tool: ${tool} (Call ID: ${callID})`);
    },
  };
}

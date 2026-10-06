import type { AuthHook } from "@opencode-ai/plugin";
import { GigaCodeAuthManager, sanitizeError } from "../gigacode/auth.js";
import { logger } from "../gigacode/logger.js";

export function createAuthHook(authManager: GigaCodeAuthManager): AuthHook {
  return {
    provider: "GigaChat (Sberbank)",
    async loader(auth) {
      try {
        const info = await auth();
        if (info?.type === "api") {
          const scope = info.metadata?.scope;
          authManager.setCredentials(info.key, scope);
          return { credentials: info.key, scope };
        }
      } catch (error) {
        logger.error(
          "Failed to load credentials via OpenCode standard loader:",
          sanitizeError(error).message,
        );
      }
      return {};
    },
    methods: [
      {
        type: "api",
        label: "GigaChat (Sberbank)",
        prompts: [
          {
            type: "select",
            key: "scope",
            message: "API Scope:",
            options: [
              {
                label: "Personal (GIGACHAT_API_PERS)",
                value: "GIGACHAT_API_PERS",
                hint: "For individual developer accounts",
              },
              {
                label: "B2B (GIGACHAT_API_B2B)",
                value: "GIGACHAT_API_B2B",
                hint: "For B2B developer accounts",
              },
              {
                label: "Corporate (GIGACHAT_API_CORP)",
                value: "GIGACHAT_API_CORP",
                hint: "For corporate developer accounts",
              },
            ],
          },
        ],
        // OpenCode collects the API key as a password and stores it together
        // with prompt metadata. Its custom authorize callback receives only
        // the prompt fields, so defining one here would lose the key.
      },
    ],
  };
}

import type { Plugin } from "@opencode-ai/plugin";
import { GigaCodeAuthManager } from "./gigacode/auth.js";
import { setupGlobalFetchInterceptor, validateMessagePayload, registerGigaEndpoint } from "./plugin/request.js";
import { logger } from "./gigacode/logger.js";

const authManager = new GigaCodeAuthManager();

// Setup global fetch interceptor immediately on plugin load
setupGlobalFetchInterceptor(authManager);

export function isGigaProvider(providerID: string | undefined): boolean {
  if (!providerID) return false;
  const id = providerID.toLowerCase();
  return (
    id === "gigachat" ||
    id === "gigacode" ||
    id.includes("gigachat") ||
    id.includes("gigacode") ||
    id.includes("sberbank") ||
    id.includes("сбербанк")
  );
}

export const GigaCodeConnectorPlugin: Plugin = async (ctx) => {
  logger.setClient(ctx.client);
  logger.log("GigaCodeConnectorPlugin function executed!", { ctx });
  return {
    auth: {
      provider: "GigaChat (Sberbank)",
      async loader(auth, provider) {
        try {
          const authInfo = await auth();
          if (authInfo && authInfo.type === "api") {
            const credentials = authInfo.key;
            const scope = authInfo.metadata?.scope;
            return {
              options: {
                credentials,
                scope
              }
            };
          }
        } catch (e: any) {
          logger.error("Failed to load credentials via OpenCode standard loader:", e.message);
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
                { label: "Personal (GIGACHAT_API_PERS)", value: "GIGACHAT_API_PERS", hint: "For individual developer accounts" },
                { label: "B2B (GIGACHAT_API_B2B)", value: "GIGACHAT_API_B2B", hint: "For B2B developer accounts" },
                { label: "Corporate (GIGACHAT_API_CORP)", value: "GIGACHAT_API_CORP", hint: "For corporate developer accounts" }
              ]
            }
          ],
          async authorize(inputs) {
            const credentials = inputs?.key || "";
            const scope = inputs?.scope || "GIGACHAT_API_PERS";
            try {
              const testAuthManager = new GigaCodeAuthManager();
              testAuthManager.setCredentials(credentials, scope);
              await testAuthManager.getAccessToken();
              return {
                type: "success",
                key: credentials,
                metadata: { scope }
              };
            } catch (err: any) {
              logger.error("Authorization check failed:", err.message);
              return { type: "failed" };
            }
          }
        }
      ]
    },

    // Load global configuration at startup
    config: async (config) => {
      const providers = (config as any).provider || {};
      const gigaKey = Object.keys(providers).find(k => isGigaProvider(k));
      const gigaProvider = gigaKey ? providers[gigaKey] : undefined;
      if (gigaProvider && gigaProvider.options) {
        const options = gigaProvider.options;
        if (typeof options.credentials === "string" && options.credentials) {
          const verifySsl = options.verifySSL !== undefined ? options.verifySSL : options.verifySsl;
          const caBundle = options.caBundle || options.caBundlePath;
          authManager.setCredentials(options.credentials, options.scope, verifySsl, caBundle);
          logger.log("Credentials successfully loaded from global config hook.");
        }
        if (typeof options.baseURL === "string" && options.baseURL) {
          registerGigaEndpoint(options.baseURL);
        }
      }
    },

    // Modify request config with correct tokens, mTLS Agents, and payloads
    "chat.params": async ({ model, provider }, output) => {
      logger.log(`chat.params hook triggered for model: ${(model as any).modelID || (model as any).id || "unknown"}`);
      if (!isGigaProvider(model.providerID)) {
        return;
      }

      const configOptions = provider?.options;

      // Cache the custom baseURL if defined
      if (configOptions && typeof configOptions.baseURL === "string") {
        registerGigaEndpoint(configOptions.baseURL);
      }

      // Inject provider marker header into output options (used during fetch)
      if (output) {
        if (!output.options) {
          output.options = {};
        }
        if (!output.options.headers) {
          output.options.headers = {};
        }
        output.options.headers["x-opencode-provider-marker"] = "gigachat";
      }

      // Configure auth manager credentials if passed inline in opencode.json options
      if (configOptions && typeof configOptions.credentials === "string") {
        const verifySsl = configOptions.verifySSL !== undefined ? configOptions.verifySSL : configOptions.verifySsl;
        const caBundle = configOptions.caBundle || configOptions.caBundlePath;
        authManager.setCredentials(configOptions.credentials, configOptions.scope, verifySsl, caBundle);
      }

      // Check if standard options has token, if not verify active session
      try {
        const { token, account } = await authManager.getAccessToken();
        logger.log(`Plugin session active for account: ${account.name}`);
      } catch (err: any) {
        logger.error("Failed to check active account session:", err.message);
        throw err;
      }
    },

    // Check message payload lengths prior to API calls
    "chat.message": async ({ model }, { parts }) => {
      if (!model || !isGigaProvider(model.providerID)) {
        return;
      }

      for (const part of parts) {
        if (part.type === "text") {
          const textVal = (part as any).text;
          if (typeof textVal === "string") {
            validateMessagePayload(textVal);
          }
        }
      }
    },

    // Hook called before executing a tool to track tool cascades
    "tool.execute.before": async ({ tool, callID }) => {
      logger.log(`Executing tool: ${tool} (Call ID: ${callID})`);
    }
  };
};

export default GigaCodeConnectorPlugin;

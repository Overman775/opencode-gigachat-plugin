import type { Plugin } from "@opencode-ai/plugin";
import { GigaCodeAuthManager } from "./gigacode/auth.js";
import { logger } from "./gigacode/logger.js";
import { createPluginHooks, setupGlobalFetchInterceptor } from "./plugin/index.js";

export { isGigaProvider } from "./plugin/index.js";

const authManager = new GigaCodeAuthManager();
setupGlobalFetchInterceptor(authManager);

export const GigaCodeConnectorPlugin: Plugin = async ({ client }) => {
  logger.setClient(client);
  logger.log("GigaCodeConnectorPlugin initialized.");
  return createPluginHooks(authManager);
};

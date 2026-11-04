import type { GigaCodeAuthManager } from "../gigacode/auth.js";
import { registerGigaEndpoint } from "./routing.js";

export function isGigaProvider(providerID: string | undefined): boolean {
  if (!providerID) return false;
  return /gigachat|gigacode|sberbank|сбербанк/i.test(providerID);
}

export function configureProvider(
  authManager: GigaCodeAuthManager,
  options: Record<string, unknown>,
): void {
  if (typeof options.baseURL === "string" && options.baseURL) registerGigaEndpoint(options.baseURL);
  const verifySsl = options.verifySSL !== undefined ? options.verifySSL : options.verifySsl;
  const caBundle = options.caBundle || options.caBundlePath;

  // `accounts` is the V2 addition: several keys in one provider, rotated on quota errors.
  if (Array.isArray(options.accounts) && options.accounts.length > 0) {
    authManager.setAccounts(
      options.accounts as readonly Record<string, unknown>[],
      typeof verifySsl === "boolean" ? verifySsl : undefined,
      typeof caBundle === "string" ? caBundle : undefined,
    );
    return;
  }

  const inlineCredentials = typeof options.credentials === "string";
  const account = authManager.getActiveAccount();
  const credentials = inlineCredentials ? (options.credentials as string) : account?.credentials;
  if (credentials === undefined) return;
  const scope =
    typeof options.scope === "string"
      ? options.scope
      : inlineCredentials
        ? undefined
        : account?.scope;
  authManager.setCredentials(
    credentials,
    scope,
    typeof verifySsl === "boolean" ? verifySsl : undefined,
    typeof caBundle === "string" ? caBundle : undefined,
  );
}

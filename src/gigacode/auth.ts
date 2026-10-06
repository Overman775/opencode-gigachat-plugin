import { randomUUID } from "node:crypto";
import { default as axios } from "axios";

import {
  GIGACHAT_OAUTH_URL,
  DEFAULT_CA_BUNDLE_FILE,
  REFRESH_BUFFER_SECONDS,
} from "../constants.js";
import { getHttpsAgent, shouldVerifySsl } from "./certs.js";
import { logger } from "./logger.js";

export interface GigaAccount {
  id: string;
  name: string;
  credentials: string; // Base64(Client_ID:Client_Secret)
  scope: "GIGACHAT_API_PERS" | "GIGACHAT_API_B2B" | "GIGACHAT_API_CORP";
  isBlocked?: boolean;
}

interface TokenCache {
  accessToken: string;
  expiresAtSeconds: number;
}

export interface SanitizedError extends Error {
  status?: number;
}

export function sanitizeError(err: unknown): SanitizedError {
  if (!err) return new Error("Unknown error");
  if (axios.isAxiosError(err)) {
    for (const config of [err.config, err.response?.config]) {
      if (!config) continue;
      for (const key of Object.keys(config.headers ?? {})) {
        if (key.toLowerCase() === "authorization") delete config.headers[key];
      }
      delete config.auth;
    }
  }

  if (err instanceof Error) {
    const cleanError: SanitizedError = new Error(err.message);
    cleanError.name = err.name;
    if (err.stack) {
      cleanError.stack = err.stack;
    }
    if (axios.isAxiosError(err) && err.response?.status) {
      cleanError.status = err.response.status;
    } else if ("status" in err && typeof err.status === "number") {
      cleanError.status = err.status;
    }
    return cleanError;
  }

  return new Error(String(err));
}

export class GigaCodeAuthManager {
  private credentialsValue: string | null = null;
  private scopeValue: GigaAccount["scope"] = "GIGACHAT_API_PERS";
  private verifySslValue: boolean | undefined = undefined;
  private caBundleValue: string | undefined = undefined;
  private tokenCache: TokenCache | null = null;
  private refreshPromise: Promise<TokenCache> | null = null;
  private credentialsVersion = 0;

  constructor() {
    // Check fallback to environment variables on init
    if (process.env.GIGACHAT_CREDENTIALS) {
      this.setCredentials(
        process.env.GIGACHAT_CREDENTIALS,
        process.env.GIGACHAT_SCOPE,
      );
      logger.log("Loaded GigaChat credentials from environment variables.");
    }
  }

  public setCredentials(
    credentials: string,
    scope?: string,
    verifySsl?: boolean,
    caBundle?: string,
  ) {
    const cleanCredentials = credentials ? credentials.trim() : "";
    let cleanScope: GigaAccount["scope"] = "GIGACHAT_API_PERS";
    if (scope) {
      const trimmedScope = scope.trim();
      if (
        trimmedScope === "GIGACHAT_API_B2B" ||
        trimmedScope === "GIGACHAT_API_CORP" ||
        trimmedScope === "GIGACHAT_API_PERS"
      ) {
        cleanScope = trimmedScope;
      }
    }

    if (
      this.credentialsValue !== cleanCredentials ||
      this.scopeValue !== cleanScope ||
      this.verifySslValue !== verifySsl ||
      this.caBundleValue !== caBundle
    ) {
      this.credentialsValue = cleanCredentials;
      this.scopeValue = cleanScope;
      this.verifySslValue = verifySsl;
      this.caBundleValue = caBundle;
      // Invalidate cache and promises since credentials have changed
      this.tokenCache = null;
      this.refreshPromise = null;
      this.credentialsVersion++;
      logger.log("Dynamic credentials configured from OpenCode options.");
    }
  }

  public getVerifySsl(): boolean {
    if (this.verifySslValue !== undefined) {
      return this.verifySslValue;
    }
    return shouldVerifySsl();
  }

  public getCaBundle(): string {
    return (
      this.caBundleValue ||
      process.env.GIGACHAT_CA_BUNDLE_FILE ||
      DEFAULT_CA_BUNDLE_FILE
    );
  }

  public getActiveAccount(): GigaAccount | null {
    if (!this.credentialsValue) {
      // Recheck environment variables in case they were set dynamically after initialization
      if (process.env.GIGACHAT_CREDENTIALS) {
        this.setCredentials(
          process.env.GIGACHAT_CREDENTIALS,
          process.env.GIGACHAT_SCOPE,
        );
      }
    }

    if (!this.credentialsValue) {
      return null;
    }

    return {
      id: "default-gigacode-account",
      name: "GigaChat Account",
      credentials: this.credentialsValue,
      scope: this.scopeValue,
    };
  }

  public blockActiveAccount(reason: string) {
    logger.warn(`Active account warning / rate-limit encountered: ${reason}`);
  }

  public async getAccessToken(): Promise<{
    token: string;
    account: GigaAccount;
  }> {
    // A configuration change may overlap an OAuth request. Only the current
    // configuration can populate the cache or return a token to its callers.
    for (;;) {
      const account = this.getActiveAccount();
      const version = this.credentialsVersion;
      if (!account) {
        throw new Error(
          "GigaChat credentials are not configured. " +
            "Sign in with 'opencode providers login --provider \"GigaChat (Sberbank)\"', " +
            "or set the GIGACHAT_CREDENTIALS environment variable.",
        );
      }

      const currentSeconds = Date.now() / 1000;

      if (
        this.tokenCache &&
        currentSeconds <
          this.tokenCache.expiresAtSeconds - REFRESH_BUFFER_SECONDS
      ) {
        return { token: this.tokenCache.accessToken, account };
      }

      if (!this.refreshPromise) {
        const refresh = this.fetchToken(account)
          .then((cache) => {
            if (version === this.credentialsVersion) this.tokenCache = cache;
            return cache;
          })
          .finally(() => {
            if (this.refreshPromise === refresh) this.refreshPromise = null;
          });
        this.refreshPromise = refresh;
      }

      try {
        const cache = await this.refreshPromise;
        if (version !== this.credentialsVersion) continue;
        return { token: cache.accessToken, account };
      } catch (err: unknown) {
        if (version !== this.credentialsVersion) continue;
        throw sanitizeError(err);
      }
    }
  }

  private async fetchToken(account: GigaAccount): Promise<TokenCache> {
    const url = GIGACHAT_OAUTH_URL;
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${account.credentials}`,
      RqUID: randomUUID(),
    };
    const body = new URLSearchParams({ scope: account.scope }).toString();

    const caBundle = this.getCaBundle();
    const verifySsl = this.getVerifySsl();
    const httpsAgent = getHttpsAgent(verifySsl, caBundle);

    try {
      logger.log(`Exchanging token for account: ${account.name}...`);
      interface OAuthResponse {
        access_token?: string;
        expires_at?: number;
        tok?: string;
        exp?: number;
      }
      const response = await axios.post<OAuthResponse>(url, body, {
        headers,
        httpsAgent,
        timeout: 10000,
      });

      const token = response.data.access_token || response.data.tok;
      if (typeof token !== "string" || !token.trim()) {
        throw new Error("No token returned in auth response");
      }
      // Auto-detect units: values > 1e12 are milliseconds, otherwise seconds
      const expiresAtRaw =
        response.data.expires_at !== undefined
          ? response.data.expires_at
          : response.data.exp || 0;
      const expiresAtSeconds =
        expiresAtRaw > 1e12 ? expiresAtRaw / 1000 : expiresAtRaw;
      return {
        accessToken: token,
        expiresAtSeconds,
      };
    } catch (err: unknown) {
      logger.error(
        `Token exchange failed for ${account.name}:`,
        err instanceof Error ? err.message : String(err),
      );
      throw sanitizeError(err);
    }
  }
}

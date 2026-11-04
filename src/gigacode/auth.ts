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

/**
 * Reads the human-readable reason from a GigaChat error body.
 * Streams and other unparsed payloads yield nothing; `plugin/errors.ts` handles those.
 */
function serverMessageOf(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  // The API returns untyped payloads, so the shape is probed field by field.
  const data = err.response?.data as
    | string
    | { message?: unknown; error?: unknown; error_description?: unknown }
    | undefined;
  if (typeof data === "string") return data.trim().slice(0, 300) || undefined;
  if (!data || typeof data !== "object") return undefined;
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object") {
    const nested = data.error as { message?: unknown };
    if (typeof nested.message === "string") return nested.message;
  }
  if (typeof data.error_description === "string") return data.error_description;
  return undefined;
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
    // Keep the API's own explanation: "Request failed with status code 400" alone
    // is not actionable, while "(Can't decode 'Authorization' header)" is.
    const serverMessage = serverMessageOf(err);
    const cleanError: SanitizedError = new Error(
      serverMessage ? `${err.message} (${serverMessage})` : err.message,
    );
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

/** Credentials may hold several keys separated by newlines, commas or semicolons. */
const CREDENTIAL_SEPARATORS = /[\n\r;,]+/;

/** A rate-limited account stays out of rotation for this long before it is retried. */
const BLOCKED_COOLDOWN_MS = 60_000;

function normalizeScope(scope: string | undefined): GigaAccount["scope"] {
  const trimmed = scope?.trim();
  if (
    trimmed === "GIGACHAT_API_B2B" ||
    trimmed === "GIGACHAT_API_CORP" ||
    trimmed === "GIGACHAT_API_PERS"
  ) {
    return trimmed;
  }
  return "GIGACHAT_API_PERS";
}

/** Splits one credentials string into accounts, keeping the order the user wrote. */
export function accountsFromCredentials(
  credentials: string,
  scope?: string,
  namePrefix = "GigaChat Account",
): GigaAccount[] {
  return credentials
    .split(CREDENTIAL_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((value, index, list) => ({
      id: `gigachat-account-${index + 1}`,
      name: list.length > 1 ? `${namePrefix} ${index + 1}` : namePrefix,
      credentials: value,
      scope: normalizeScope(scope),
    }));
}

function accountsFromEnvironment(): GigaAccount[] {
  const credentials = process.env.GIGACHAT_CREDENTIALS;
  if (!credentials) return [];
  return accountsFromCredentials(credentials, process.env.GIGACHAT_SCOPE);
}

export class GigaCodeAuthManager {
  private accounts: GigaAccount[] = [];
  private activeIndex = 0;
  private verifySslValue: boolean | undefined = undefined;
  private caBundleValue: string | undefined = undefined;
  private tokenCaches = new Map<string, TokenCache>();
  private refreshPromises = new Map<string, Promise<TokenCache>>();
  private blockedUntil = new Map<string, number>();
  private accountsSignature = "";
  private accountsVersion = 0;

  constructor() {
    // Check fallback to environment variables on init
    const fromEnvironment = accountsFromEnvironment();
    if (fromEnvironment.length > 0) {
      this.applyAccounts(fromEnvironment);
      logger.log(
        `Loaded ${fromEnvironment.length} GigaChat account(s) from environment variables.`,
      );
    }
  }

  /** Replaces the account list accepted from the environment. */
  public setCredentials(
    credentials: string,
    scope?: string,
    verifySsl?: boolean,
    caBundle?: string,
  ) {
    this.applyAccounts(
      credentials ? accountsFromCredentials(credentials, scope) : [],
      verifySsl,
      caBundle,
    );
  }

  /** Replaces the account list from explicit entries (provider option `accounts`). */
  public setAccounts(
    accounts: readonly { credentials?: unknown; scope?: unknown; name?: unknown }[],
    verifySsl?: boolean,
    caBundle?: string,
  ) {
    const normalized: GigaAccount[] = [];
    for (const entry of accounts) {
      if (!entry || typeof entry.credentials !== "string") continue;
      const parts = accountsFromCredentials(
        entry.credentials,
        typeof entry.scope === "string" ? entry.scope : undefined,
        typeof entry.name === "string" ? entry.name : "GigaChat Account",
      );
      for (const account of parts) {
        account.id = `gigachat-account-${normalized.length + 1}`;
        normalized.push(account);
      }
    }
    this.applyAccounts(normalized, verifySsl, caBundle);
  }

  private applyAccounts(
    next: GigaAccount[],
    verifySsl?: boolean,
    caBundle?: string,
  ): void {
    const signature = `${verifySsl ?? "auto"}#${caBundle ?? ""}#${next
      .map((account) => `${account.credentials}|${account.scope}`)
      .join("||")}`;
    if (signature === this.accountsSignature) return;

    this.accountsSignature = signature;
    this.accounts = next;
    this.activeIndex = 0;
    this.verifySslValue = verifySsl;
    this.caBundleValue = caBundle;
    // Invalidate caches and promises since accounts have changed.
    this.tokenCaches.clear();
    this.refreshPromises.clear();
    this.blockedUntil.clear();
    this.accountsVersion++;
    logger.log(`Dynamic credentials configured for ${next.length} account(s).`);
  }

  /** Account list currently in rotation. */
  public getAccounts(): readonly GigaAccount[] {
    if (this.accounts.length === 0) {
      const fromEnvironment = accountsFromEnvironment();
      if (fromEnvironment.length > 0) this.applyAccounts(fromEnvironment);
    }
    return this.accounts;
  }

  public getActiveIndex(): number {
    return this.activeIndex;
  }

  /**
   * Moves to the next account after the current one failed with 401/403/429.
   * Returns true when a different account became active, so the caller can retry.
   */
  public rotateAccount(reason: string): boolean {
    const accounts = this.getAccounts();
    if (accounts.length < 2) {
      logger.warn(
        `Account error (${reason}); only one account is configured, so the request keeps using it.`,
      );
      return false;
    }

    const current = accounts[this.activeIndex];
    if (current) this.blockedUntil.set(current.id, Date.now() + BLOCKED_COOLDOWN_MS);

    const now = Date.now();
    for (let step = 1; step <= accounts.length; step++) {
      const candidate = (this.activeIndex + step) % accounts.length;
      const account = accounts[candidate];
      if (!account) continue;
      const blocked = this.blockedUntil.get(account.id);
      if (blocked !== undefined && blocked > now) continue;
      this.activeIndex = candidate;
      logger.warn(
        `Rotated to account "${account.name}" after: ${reason} (${step} of ${accounts.length})`,
      );
      return true;
    }

    // Every account is cooling down; fall back to the next one anyway.
    const fallback = (this.activeIndex + 1) % accounts.length;
    const account = accounts[fallback];
    if (account) this.blockedUntil.delete(account.id);
    this.activeIndex = fallback;
    logger.warn(
      `Every account is rate limited; reusing "${account?.name ?? "account"}" for: ${reason}`,
    );
    return true;
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
    const accounts = this.getAccounts();
    return accounts[this.activeIndex] ?? accounts[0] ?? null;
  }

  /**
   * Kept for the endpoint's quota callback: warns and rotates when possible.
   */
  public blockActiveAccount(reason: string) {
    this.rotateAccount(reason);
  }

  public async getAccessToken(): Promise<{
    token: string;
    account: GigaAccount;
  }> {
    // A configuration change may overlap an OAuth request. Only the current
    // configuration can populate the cache or return a token to its callers.
    for (;;) {
      const account = this.getActiveAccount();
      const version = this.accountsVersion;
      if (!account) {
        throw new Error(
          "GigaChat credentials are not configured. " +
            "Set the GIGACHAT_CREDENTIALS environment variable, or sign in to the provider.",
        );
      }

      const currentSeconds = Date.now() / 1000;
      const cached = this.tokenCaches.get(account.id);

      if (
        cached &&
        currentSeconds < cached.expiresAtSeconds - REFRESH_BUFFER_SECONDS
      ) {
        return { token: cached.accessToken, account };
      }

      let refresh = this.refreshPromises.get(account.id);
      if (!refresh) {
        refresh = this.fetchToken(account)
          .then((cache) => {
            if (version === this.accountsVersion) {
              this.tokenCaches.set(account.id, cache);
            }
            return cache;
          })
          .finally(() => {
            if (this.refreshPromises.get(account.id) === refresh) {
              this.refreshPromises.delete(account.id);
            }
          });
        this.refreshPromises.set(account.id, refresh);
      }

      try {
        const cache = await refresh;
        if (version !== this.accountsVersion) continue;
        // Rotation may have happened while the token was being fetched.
        if (this.getActiveAccount()?.id !== account.id) continue;
        return { token: cache.accessToken, account };
      } catch (err: unknown) {
        if (version !== this.accountsVersion) continue;
        throw sanitizeError(err);
      }
    }
  }

  private async fetchToken(account: GigaAccount): Promise<TokenCache> {
    // Overridable for corporate proxies and offline release checks.
    const url = process.env.GIGACHAT_OAUTH_URL || GIGACHAT_OAUTH_URL;
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

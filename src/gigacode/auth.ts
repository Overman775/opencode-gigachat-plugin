import axios from "axios";
import { v4 as uuidv4 } from "uuid";

import { 
  GIGACHAT_OAUTH_URL, 
  DEFAULT_CA_BUNDLE_FILE, 
  REFRESH_BUFFER_SECONDS 
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

export function sanitizeError(err: unknown): Error {
  if (!err) return new Error("Unknown error");
  
  if (err instanceof Error) {
    const cleanError = new Error(err.message);
    cleanError.name = err.name;
    if (err.stack) {
      cleanError.stack = err.stack;
    }
    if (axios.isAxiosError(err) && err.response?.status) {
      (cleanError as any).status = err.response.status;
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
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    // Check fallback to environment variables on init
    if (process.env.GIGACHAT_CREDENTIALS) {
      this.credentialsValue = process.env.GIGACHAT_CREDENTIALS;
      const envScope = process.env.GIGACHAT_SCOPE;
      if (envScope === "GIGACHAT_API_B2B" || envScope === "GIGACHAT_API_CORP" || envScope === "GIGACHAT_API_PERS") {
        this.scopeValue = envScope;
      }
      logger.log("Loaded GigaChat credentials from environment variables.");
    }
  }

  public setCredentials(credentials: string, scope?: string, verifySsl?: boolean, caBundle?: string) {
    const cleanCredentials = credentials ? credentials.trim() : "";
    let cleanScope: GigaAccount["scope"] = "GIGACHAT_API_PERS";
    if (scope) {
      const trimmedScope = scope.trim();
      if (trimmedScope === "GIGACHAT_API_B2B" || trimmedScope === "GIGACHAT_API_CORP" || trimmedScope === "GIGACHAT_API_PERS") {
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
    return this.caBundleValue || process.env.GIGACHAT_CA_BUNDLE_FILE || DEFAULT_CA_BUNDLE_FILE;
  }

  public getActiveAccount(): GigaAccount | null {
    if (!this.credentialsValue) {
      // Recheck environment variables in case they were set dynamically after initialization
      if (process.env.GIGACHAT_CREDENTIALS) {
        this.credentialsValue = process.env.GIGACHAT_CREDENTIALS;
        const envScope = process.env.GIGACHAT_SCOPE;
        if (envScope === "GIGACHAT_API_B2B" || envScope === "GIGACHAT_API_CORP" || envScope === "GIGACHAT_API_PERS") {
          this.scopeValue = envScope;
        }
      }
    }

    if (!this.credentialsValue) {
      return null;
    }

    return {
      id: "default-gigacode-account",
      name: "GigaChat Account",
      credentials: this.credentialsValue,
      scope: this.scopeValue
    };
  }

  public blockActiveAccount(reason: string) {
    logger.warn(`Active account warning / rate-limit encountered: ${reason}`);
  }

  public async getAccessToken(): Promise<{ token: string; account: GigaAccount }> {
    const account = this.getActiveAccount();
    if (!account) {
      throw new Error(
        "GigaChat credentials are not configured. " +
        "Please provide 'credentials' in your 'opencode.json' under provider.gigachat.options, " +
        "or set the GIGACHAT_CREDENTIALS environment variable."
      );
    }

    const currentSeconds = Date.now() / 1000;

    if (this.tokenCache && currentSeconds < (this.tokenCache.expiresAtSeconds - REFRESH_BUFFER_SECONDS)) {
      return { token: this.tokenCache.accessToken, account };
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.fetchToken(account).finally(() => {
        this.refreshPromise = null;
      });
    }

    try {
      const token = await this.refreshPromise;
      return { token, account };
    } catch (err: unknown) {
      throw sanitizeError(err);
    }
  }

  private async fetchToken(account: GigaAccount): Promise<string> {
    const url = GIGACHAT_OAUTH_URL;
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Authorization": `Basic ${account.credentials}`,
      "RqUID": uuidv4()
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
        timeout: 10000
      });

      const token = response.data.access_token || response.data.tok;
      if (!token) {
        throw new Error("No token returned in auth response");
      }
      // Auto-detect units: values > 1e12 are milliseconds, otherwise seconds
      const expiresAtRaw = response.data.expires_at !== undefined ? response.data.expires_at : (response.data.exp || 0);
      const expiresAtSeconds = expiresAtRaw > 1e12 ? expiresAtRaw / 1000 : expiresAtRaw;
      this.tokenCache = {
        accessToken: token,
        expiresAtSeconds
      };

      return token;
    } catch (err: unknown) {
      logger.error(`Token exchange failed for ${account.name}:`, err instanceof Error ? err.message : String(err));
      throw sanitizeError(err);
    }
  }
}

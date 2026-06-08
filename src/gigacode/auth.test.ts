import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { GigaCodeAuthManager } from "./auth.js";
import axios from "axios";

vi.mock("axios");

describe("GigaCodeAuthManager", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GIGACHAT_CREDENTIALS;
    delete process.env.GIGACHAT_SCOPE;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should initialize with no credentials if environment variable is not present", () => {
    const authManager = new GigaCodeAuthManager();
    expect(authManager.getActiveAccount()).toBeNull();
  });

  it("should initialize with credentials from environment variable if present", () => {
    process.env.GIGACHAT_CREDENTIALS = "env-base64-creds";
    process.env.GIGACHAT_SCOPE = "GIGACHAT_API_B2B";

    const authManager = new GigaCodeAuthManager();
    const account = authManager.getActiveAccount();
    
    expect(account).not.toBeNull();
    expect(account?.credentials).toBe("env-base64-creds");
    expect(account?.scope).toBe("GIGACHAT_API_B2B");
  });

  it("should set credentials dynamically via setCredentials", () => {
    const authManager = new GigaCodeAuthManager();
    expect(authManager.getActiveAccount()).toBeNull();

    authManager.setCredentials("dynamic-creds", "GIGACHAT_API_CORP");
    const account = authManager.getActiveAccount();

    expect(account).not.toBeNull();
    expect(account?.credentials).toBe("dynamic-creds");
    expect(account?.scope).toBe("GIGACHAT_API_CORP");
  });

  it("should throw error on getAccessToken if credentials are not configured", async () => {
    const authManager = new GigaCodeAuthManager();
    await expect(authManager.getAccessToken()).rejects.toThrow("GigaChat credentials are not configured");
  });

  it("should fetch token and cache it", async () => {
    const authManager = new GigaCodeAuthManager();
    authManager.setCredentials("mock-credentials", "GIGACHAT_API_PERS");

    const mockResponse = {
      data: {
        access_token: "mocked-access-token",
        expires_at: Date.now() + 1000 * 3600 // 1 hour in ms
      }
    };
    vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

    const result1 = await authManager.getAccessToken();
    expect(result1.token).toBe("mocked-access-token");
    expect(result1.account.credentials).toBe("mock-credentials");

    // Next call should be cached (axios.post only called once)
    const result2 = await authManager.getAccessToken();
    expect(result2.token).toBe("mocked-access-token");
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("should invalidate cache and refetch if credentials change", async () => {
    const authManager = new GigaCodeAuthManager();
    
    // First credentials
    authManager.setCredentials("creds-1", "GIGACHAT_API_PERS");
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "token-1",
        expires_at: Date.now() + 1000 * 3600
      }
    });

    const res1 = await authManager.getAccessToken();
    expect(res1.token).toBe("token-1");

    // Change credentials
    authManager.setCredentials("creds-2", "GIGACHAT_API_PERS");
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "token-2",
        expires_at: Date.now() + 1000 * 3600
      }
    });

    const res2 = await authManager.getAccessToken();
    expect(res2.token).toBe("token-2");
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});

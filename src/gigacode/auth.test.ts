import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { GigaCodeAuthManager } from "./auth.js";
import { default as axios } from "axios";

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
    vi.useRealTimers();
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
    await expect(authManager.getAccessToken()).rejects.toThrow(
      "GigaChat credentials are not configured",
    );
  });

  it("should fetch token and cache it", async () => {
    const authManager = new GigaCodeAuthManager();
    authManager.setCredentials("mock-credentials", "GIGACHAT_API_PERS");

    const mockResponse = {
      data: {
        access_token: "mocked-access-token",
        expires_at: Date.now() + 1000 * 3600, // 1 hour in ms
      },
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
        expires_at: Date.now() + 1000 * 3600,
      },
    });

    const res1 = await authManager.getAccessToken();
    expect(res1.token).toBe("token-1");

    // Change credentials
    authManager.setCredentials("creds-2", "GIGACHAT_API_PERS");
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "token-2",
        expires_at: Date.now() + 1000 * 3600,
      },
    });

    const res2 = await authManager.getAccessToken();
    expect(res2.token).toBe("token-2");
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it("shares one OAuth request between concurrent callers", async () => {
    const manager = new GigaCodeAuthManager();
    manager.setCredentials("test-credentials");
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: "shared-token", expires_at: Date.now() + 3600000 },
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => manager.getAccessToken()),
    );
    expect(results.map((result) => result.token)).toEqual(
      Array(10).fill("shared-token"),
    );
    expect(axios.post).toHaveBeenCalledOnce();
  });

  it("refreshes before expiration when the server timestamp is in seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const manager = new GigaCodeAuthManager();
    manager.setCredentials("test-credentials");
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: "first", expires_at: Date.now() / 1000 + 301 },
    });
    expect((await manager.getAccessToken()).token).toBe("first");
    await vi.advanceTimersByTimeAsync(2000);
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: "refreshed", expires_at: Date.now() / 1000 + 3600 },
    });
    expect((await manager.getAccessToken()).token).toBe("refreshed");
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it("allows another token request after a failed refresh", async () => {
    const manager = new GigaCodeAuthManager();
    manager.setCredentials("test-credentials");
    vi.mocked(axios.post).mockRejectedValueOnce(
      new Error("Connection interrupted"),
    );
    await expect(manager.getAccessToken()).rejects.toThrow(
      "Connection interrupted",
    );
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: "retry-token", expires_at: Date.now() + 3600000 },
    });
    expect((await manager.getAccessToken()).token).toBe("retry-token");
  });

  it.each(["success", "failure"])(
    "keeps a new credential refresh active when the obsolete request ends with %s",
    async (outcome) => {
      let resolveOld!: (value: {
        data: { access_token: string; expires_at: number };
      }) => void;
      let rejectOld!: (error: Error) => void;
      let resolveNew!: typeof resolveOld;
      vi.mocked(axios.post)
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              resolveOld = resolve;
              rejectOld = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveNew = resolve;
            }),
        );
      const manager = new GigaCodeAuthManager();
      manager.setCredentials("old-key");
      const oldCaller = manager.getAccessToken();
      manager.setCredentials("new-key", "GIGACHAT_API_CORP");
      const newCaller = manager.getAccessToken();
      if (outcome === "success") {
        resolveOld({
          data: { access_token: "old-token", expires_at: Date.now() + 3600000 },
        });
      } else {
        rejectOld(new Error("Obsolete credentials failed"));
      }
      // Let the obsolete request settle before another caller joins the new one.
      await new Promise((resolve) => setImmediate(resolve));
      const thirdCaller = manager.getAccessToken();
      expect(axios.post).toHaveBeenCalledTimes(2);
      resolveNew({
        data: { access_token: "new-token", expires_at: Date.now() + 3600000 },
      });
      for (const result of await Promise.all([
        oldCaller,
        newCaller,
        thirdCaller,
      ])) {
        expect(result.token).toBe("new-token");
        expect(result.account.credentials).toBe("new-key");
        expect(result.account.scope).toBe("GIGACHAT_API_CORP");
      }
      expect((await manager.getAccessToken()).token).toBe("new-token");
      expect(axios.post).toHaveBeenCalledTimes(2);
    },
  );

  it("cannot overwrite the new token cache with a late response for old credentials", async () => {
    let resolveOld!: (value: {
      data: { access_token: string; expires_at: number };
    }) => void;
    vi.mocked(axios.post)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({
        data: { access_token: "new-token", expires_at: Date.now() + 3600000 },
      });
    const manager = new GigaCodeAuthManager();
    manager.setCredentials("old-key");
    const oldCaller = manager.getAccessToken();
    manager.setCredentials("new-key");
    expect((await manager.getAccessToken()).token).toBe("new-token");
    resolveOld({
      data: { access_token: "old-token", expires_at: Date.now() + 3600000 },
    });
    expect((await oldCaller).token).toBe("new-token");
    expect((await manager.getAccessToken()).token).toBe("new-token");
  });
});

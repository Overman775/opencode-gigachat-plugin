import { describe, expect, it } from "vitest";
import { resolveGigaRoute } from "./routing.js";

describe("GigaChat API routing", () => {
  it.each([
    ["/v1/chat/completions", "/v1/chat/completions", true],
    ["/v1/files", "/v1/files", false],
    ["/v1/models?limit=10", "/v1/models?limit=10", false],
    ["/v1/chat/completions/count", "/v1/chat/completions/count", false],
  ])("routes the virtual host %s to the public API", (path, target, isChat) => {
    expect(
      resolveGigaRoute(`https://api.gigachat.local${path}`, false),
    ).toEqual({
      targetUrl: `https://api.giga.chat${target}`,
      isChat,
    });
  });

  it.each([
    "https://api.giga.chat/v1/chat/completions",
    "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
  ])("recognizes an official endpoint without a marker: %s", (targetUrl) => {
    expect(resolveGigaRoute(targetUrl, false)).toEqual({
      targetUrl,
      isChat: true,
    });
  });

  it("does not treat a chat path in the query string as a chat request", () => {
    expect(
      resolveGigaRoute(
        "https://api.giga.chat/v1/models?next=/chat/completions",
        false,
      ),
    ).toEqual({
      targetUrl: "https://api.giga.chat/v1/models?next=/chat/completions",
      isChat: false,
    });
  });
});

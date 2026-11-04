import { describe, expect, it } from "vitest";

import { GIGACHAT_MODELS, createModelInfos } from "./models.js";

const EXPECTED_IDS = [
  "GigaChat-2",
  "GigaChat-2-Pro",
  "GigaChat-2-Max",
  "GigaChat-3-Lightning",
  "GigaChat-3-Pro",
  "GigaChat-3-Ultra",
];

describe("GigaChat model catalog", () => {
  it("lists both supported generations with stable ids", () => {
    expect(GIGACHAT_MODELS.map((model) => model.id)).toEqual(EXPECTED_IDS);
  });

  it("keeps GigaChat-2-Lite out of the catalog", () => {
    expect(GIGACHAT_MODELS.some((model) => model.id === "GigaChat-2-Lite")).toBe(false);
  });

  it("declares GigaChat-3-Lightning as text-only", () => {
    const lightning = GIGACHAT_MODELS.find((model) => model.id === "GigaChat-3-Lightning");
    expect(lightning?.input).toEqual(["text"]);
  });

  it("declares image input for the multimodal models", () => {
    const multimodal = GIGACHAT_MODELS.filter((model) => model.input.includes("image")).map(
      (model) => model.id,
    );
    expect(multimodal).toEqual([
      "GigaChat-2-Pro",
      "GigaChat-2-Max",
      "GigaChat-3-Pro",
      "GigaChat-3-Ultra",
    ]);
  });

  it("declares audio input for the models that accept it", () => {
    const audio = GIGACHAT_MODELS.filter((model) => model.input.includes("audio")).map(
      (model) => model.id,
    );
    expect(audio).toEqual([
      "GigaChat-2-Pro",
      "GigaChat-2-Max",
      "GigaChat-3-Pro",
      "GigaChat-3-Ultra",
    ]);
  });

  it("builds OpenCode model infos with tools and limits", () => {
    const infos = createModelInfos("gigachat" as never);
    expect(infos).toHaveLength(EXPECTED_IDS.length);
    for (const info of infos) {
      expect(info.capabilities.tools).toBe(true);
      expect(info.limit.context).toBe(128000);
      expect(info.limit.output).toBeGreaterThan(0);
    }
  });
});

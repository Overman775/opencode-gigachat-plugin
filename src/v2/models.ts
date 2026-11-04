import { Model } from "@opencode/plugin";
import type { Provider } from "@opencode/plugin";

/**
 * GigaChat model catalog.
 *
 * Mirrors the model list documented for the V1 plugin
 * (`docs/CONFIGURATION.md`) so existing users keep the same model IDs, and
 * adds the GigaChat 3 generation returned by `GET /v1/models`.
 * `GigaChat-2-Lite` is not listed: it is an alias, not a separate model, and
 * the request translator rewrites it to `GigaChat-2` before the Sber API call.
 *
 * Capabilities were verified against the live API:
 * - tools work on every listed model;
 * - image input works on GigaChat-2-Pro/Max and GigaChat-3-Pro/Ultra;
 * - audio input works on the same four models (GigaChat-2 and
 *   GigaChat-3-Lightning answer HTTP 422 "Model does not support audio");
 * - `GigaChat-3-Lightning` rejects images (Sber returns HTTP 500), so it is
 *   declared as text-only.
 * Context limits are deliberately conservative (128k): Sber documents 128k for
 * GigaChat-2 and GigaChat-3-Ultra, while the API-served 3-Pro/3-Lightning
 * limits are not published. Understating the window only makes OpenCode
 * compact earlier, so it is the safe default.
 */
export interface GigaChatModelDefinition {
  readonly id: string;
  readonly name: string;
  readonly context: number;
  readonly output: number;
  readonly input: readonly ("text" | "image" | "audio")[];
}

export const GIGACHAT_MODELS: readonly GigaChatModelDefinition[] = [
  { id: "GigaChat-2", name: "GigaChat 2 (Text)", context: 128000, output: 4096, input: ["text"] },
  { id: "GigaChat-2-Pro", name: "GigaChat 2 Pro (Multimodal)", context: 128000, output: 8192, input: ["text", "image", "audio"] },
  { id: "GigaChat-2-Max", name: "GigaChat 2 Max (Reasoning)", context: 128000, output: 8192, input: ["text", "image", "audio"] },
  { id: "GigaChat-3-Lightning", name: "GigaChat 3 Lightning (Fast)", context: 128000, output: 8192, input: ["text"] },
  { id: "GigaChat-3-Pro", name: "GigaChat 3 Pro (Multimodal)", context: 128000, output: 8192, input: ["text", "image", "audio"] },
  { id: "GigaChat-3-Ultra", name: "GigaChat 3 Ultra (Flagship)", context: 128000, output: 8192, input: ["text", "image", "audio"] },
];

export function createModelInfo(
  providerID: Provider.ID,
  definition: GigaChatModelDefinition,
): Model.Info {
  const modelID = Model.ID.make(definition.id);
  const base = Model.Info.default(providerID, modelID);
  return {
    ...base,
    id: modelID,
    modelID,
    providerID,
    name: definition.name,
    capabilities: {
      ...base.capabilities,
      tools: true,
      input: [...definition.input],
      output: ["text"],
    },
    limit: {
      ...base.limit,
      context: definition.context,
      output: definition.output,
    },
  };
}

export function createModelInfos(providerID: Provider.ID): Model.Info[] {
  return GIGACHAT_MODELS.map((definition) => createModelInfo(providerID, definition));
}

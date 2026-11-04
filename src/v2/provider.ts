import { Integration, Model, Provider } from "@opencode/plugin";
import { RUNTIME_PACKAGE } from "./constants.js";
import { createModelInfos } from "./models.js";

/** Provider entry that sends OpenCode to the plugin's own local endpoint. */
export function createProviderInfo(providerID: Provider.ID, baseURL: string): Provider.Info {
  const base = Provider.Info.empty(providerID);
  return {
    ...base,
    id: providerID,
    name: "GigaChat (Sberbank)",
    activation: "enabled",
    package: RUNTIME_PACKAGE,
    // Linking the provider to an integration is what makes its auth methods
    // discoverable, so `/connect` can offer the GigaChat key form.
    integrationID: Integration.ID.make(String(providerID)),
    settings: { ...(base.settings ?? {}), baseURL },
  };
}

/**
 * Catalog models, keeping models that only exist in the user's configuration.
 * Catalog entries win for the IDs they define.
 */
export function mergeModelInfos(
  providerID: Provider.ID,
  existing: ReadonlyMap<string, Model.Info>,
): Model.Info[] {
  const merged = new Map<string, Model.Info>(existing);
  for (const model of createModelInfos(providerID)) merged.set(model.id, model);
  return [...merged.values()];
}

import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const bundle = await readFile("dist/gigachat-plugin.js", "utf8");
assert.ok(bundle.includes(`OpenCode GigaChat plugin v${version}`));
assert.ok(bundle.includes(await readFile("LICENSE", "utf8")));
assert.ok(bundle.includes("Third-party licenses"));
assert.ok(bundle.includes("axios@"));
assert.ok(bundle.includes("form-data@"));
await assert.rejects(readFile("dist/gigachat-plugin.zip"), { code: "ENOENT" });

// Copy only the installable plugin. The fixture must not find dependencies in
// the repo, dist/, or node_modules/ when it imports and exercises the bundle.
const isolated = await mkdtemp(join(tmpdir(), "gigachat-release-"));
try {
  await copyFile("dist/gigachat-plugin.js", join(isolated, "gigachat-plugin.js"));
  await writeFile(join(isolated, "package.json"), '{"type":"module"}\n');
  const runner = join(isolated, "verify.mjs");
  await copyFile("scripts/fixtures/release-check.mjs", runner);
  const result = spawnSync(process.execPath, [runner, "Standalone"], {
    cwd: isolated,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      NODE_PATH: "",
      GIGACHAT_CREDENTIALS: "",
      GIGACHAT_DEBUG: "false",
      OPENCODE_DEBUG: "false",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Release check failed:\n${result.stderr || result.stdout}`);
  }
  process.stdout.write(result.stdout);
} finally {
  await rm(isolated, { recursive: true, force: true });
}

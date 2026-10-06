import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";

// Test the actual downloadable assets outside the repo. Neither format may
// resolve missing modules from dist/ or the project's node_modules/.
const isolated = await mkdtemp(join(tmpdir(), "gigachat-release-"));
try {
  const entries = unzipSync(await readFile("dist/gigachat-plugin.zip"));
  const names = Object.keys(entries);
  assert.deepEqual(
    names.filter((name) => !name.includes("/") && name.endsWith(".js")),
    ["gigachat-plugin.js"],
  );
  assert.ok(names.includes("README.md"));
  assert.ok(names.includes("README.en.md"));
  assert.ok(names.includes("LICENSE"));
  assert.ok(names.includes("docs/ARCHITECTURE.md"));
  assert.ok(!names.includes("INSTALL.md"));
  for (const readme of ["README.md", "README.en.md"]) {
    assert.equal(
      Buffer.from(entries[readme]).toString(),
      await readFile(readme, "utf8"),
    );
    for (const match of Buffer.from(entries[readme])
      .toString()
      .matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (!target.startsWith("#") && !target.includes("://")) {
        assert.ok(
          names.includes(target),
          `Missing README link target: ${target}`,
        );
      }
    }
  }
  assert.ok(names.includes("gigachat-plugin/vendor/THIRD_PARTY_NOTICES.txt"));
  assert.ok(
    names.every(
      (name) => !name.includes("node_modules") && !name.includes(".test."),
    ),
  );

  for (const format of ["Standalone", "Modular ZIP"]) {
    const directory = join(isolated, format);
    await mkdir(directory);
    if (format === "Standalone") {
      await copyFile(
        "dist/gigachat-plugin.js",
        join(directory, "gigachat-plugin.js"),
      );
    } else {
      for (const [name, bytes] of Object.entries(entries)) {
        const path = resolve(directory, name);
        assert.ok(
          path.startsWith(directory + sep),
          `Invalid archive path: ${name}`,
        );
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }
    }
    await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
    const runner = join(directory, "verify.mjs");
    await copyFile("scripts/fixtures/release-check.mjs", runner);
    const result = spawnSync(process.execPath, [runner, format], {
      cwd: directory,
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
      throw new Error(
        `${format} release check failed:\n${result.stderr || result.stdout}`,
      );
    }
    process.stdout.write(result.stdout);
  }
} finally {
  await rm(isolated, { recursive: true, force: true });
}

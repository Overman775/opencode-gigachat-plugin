import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";
import { zipSync } from "fflate";

const dependencies = ["axios", "form-data"];
const sourceRoot = resolve("src");
const releaseRoot = resolve("dist/release");
const moduleRoot = join(releaseRoot, "gigachat-plugin");
const slash = (path) => path.split(sep).join("/");

async function listFiles(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

export async function buildModularRelease(version) {
  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(moduleRoot, { recursive: true });
  const sources = (await listFiles(sourceRoot)).filter(
    (file) =>
      file.endsWith(".ts") &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".d.ts"),
  );

  // Preserve the source module layout. Runtime packages are redirected to the
  // bundled vendor entries, so extracting the ZIP never requires npm install.
  await build({
    entryPoints: sources,
    outbase: sourceRoot,
    outdir: moduleRoot,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: false,
    charset: "utf8",
    plugins: [
      {
        name: "preserve-plugin-modules",
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, (args) => {
            if (args.kind === "entry-point") return;
            return { path: args.path, external: true };
          });
          builder.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.kind === "entry-point") return;
            if (dependencies.includes(args.path)) {
              const directory = join(
                moduleRoot,
                relative(sourceRoot, dirname(args.importer)),
              );
              const vendor = join(moduleRoot, "vendor", `${args.path}.js`);
              const path = slash(relative(directory, vendor));
              return {
                path: path.startsWith(".") ? path : `./${path}`,
                external: true,
              };
            }
            if (isBuiltin(args.path))
              return { path: args.path, external: true };
            return {
              errors: [{ text: `Unpackaged runtime dependency: ${args.path}` }],
            };
          });
        },
      },
    ],
  });

  const vendor = await build({
    entryPoints: dependencies.map((name) => ({
      in: `vendor:${name}`,
      out: name,
    })),
    outdir: join(moduleRoot, "vendor"),
    bundle: true,
    splitting: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: false,
    charset: "utf8",
    metafile: true,
    chunkNames: "shared/[name]-[hash]",
    banner: {
      js: '// Bundled dependencies. Plugin logic lives in the parent modules.\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
    },
    plugins: [
      {
        name: "vendor-entries",
        setup(builder) {
          builder.onResolve({ filter: /^vendor:/ }, (args) => ({
            path: args.path.slice(7),
            namespace: "vendor",
          }));
          builder.onLoad({ filter: /.*/, namespace: "vendor" }, (args) => ({
            contents: `export { default } from "${args.path}";`,
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });

  // Include the licenses of every package actually used by the vendor build.
  const packages = new Set(
    Object.keys(vendor.metafile.inputs).flatMap((file) => {
      const match = slash(file).match(
        /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//,
      );
      return match ? [match[1]] : [];
    }),
  );
  const notices = [];
  for (const name of [...packages].sort()) {
    const directory = join("node_modules", name);
    const metadata = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    const license = (await readdir(directory)).find((file) =>
      /^licen[cs]e(?:[.-]|$)/i.test(file),
    );
    let text;
    if (license) {
      text = await readFile(join(directory, license), "utf8");
    } else {
      // Some npm packages ship their full license only in the README.
      const readme = (await readdir(directory)).find((file) =>
        /^readme(?:\.|$)/i.test(file),
      );
      const content = readme
        ? await readFile(join(directory, readme), "utf8")
        : "";
      text = content.match(/(?:^|\n)License\r?\n-+\r?\n([\s\S]*)/)?.[1];
      if (!text)
        throw new Error(`Missing license for bundled dependency: ${name}`);
    }
    notices.push(`${name}@${metadata.version}\n${text}`);
  }
  await writeFile(
    join(moduleRoot, "vendor/THIRD_PARTY_NOTICES.txt"),
    notices.join("\n\n"),
  );
  await copyFile("LICENSE", join(moduleRoot, "LICENSE"));
  await writeFile(
    join(moduleRoot, "package.json"),
    `${JSON.stringify({ type: "module", version }, null, 2)}\n`,
  );
  await writeFile(
    join(releaseRoot, "gigachat-plugin.js"),
    `/**
 * OpenCode GigaChat plugin v${version}.
 * Keep this entry file beside the gigachat-plugin/ folder from the same ZIP.
 * Request translation: gigachat-plugin/plugin/translation.js
 * HTTP interception: gigachat-plugin/plugin/interceptor.js
 * OpenCode hooks: gigachat-plugin/plugin/hooks.js
 */
export { default, GigaCodeConnectorPlugin } from "./gigachat-plugin/index.js";
`,
  );
  for (const readme of ["README.md", "README.en.md", "LICENSE"]) {
    await copyFile(readme, join(releaseRoot, readme));
  }
  for (const document of await listFiles("docs")) {
    const destination = join(releaseRoot, document);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(document, destination);
  }

  const entries = {};
  for (const file of await listFiles(releaseRoot)) {
    entries[slash(relative(releaseRoot, file))] = await readFile(file);
  }
  await writeFile(
    "dist/gigachat-plugin.zip",
    zipSync(entries, {
      level: 9,
      mtime: new Date(1980, 0, 1),
    }),
  );
  console.log(
    `Modular release: dist/gigachat-plugin.zip (${sources.length} readable modules).`,
  );
}

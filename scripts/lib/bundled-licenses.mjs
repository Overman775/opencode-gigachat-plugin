import { readdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export async function bundledLicenses(inputs) {
  const packages = new Set();
  for (const input of inputs) {
    const parts = input.split(sep).join("/").split("/");
    const marker = parts.lastIndexOf("node_modules");
    if (marker < 0) continue;
    const scoped = parts[marker + 1].startsWith("@");
    packages.add(resolve(parts.slice(0, marker + (scoped ? 3 : 2)).join("/")));
  }

  const notices = [];
  for (const directory of packages) {
    const metadata = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    const files = (await readdir(directory)).sort();
    const license = files.find((file) => /^licen[cs]e(?:[.-]|$)/i.test(file));
    let text;
    if (license) {
      text = await readFile(join(directory, license), "utf8");
    } else {
      // Some npm packages include their license only in the README.
      const readme = files.find((file) => /^readme(?:\.|$)/i.test(file));
      const content = readme
        ? await readFile(join(directory, readme), "utf8")
        : "";
      text = content.match(/(?:^|\n)License\r?\n-+\r?\n([\s\S]*)/)?.[1];
      if (!text) {
        throw new Error(`Missing license for bundled dependency: ${metadata.name}`);
      }
    }
    notices.push(`${metadata.name}@${metadata.version}\n${text}`);
  }
  return notices.sort().join("\n\n");
}

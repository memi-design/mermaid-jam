import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pluginDir = resolve(root, "plugin");
const manifestPath = resolve(pluginDir, "manifest.json");
const codePath = resolve(pluginDir, "code.js");
const uiPath = resolve(pluginDir, "ui.html");
const requiredFiles = [
  "README.md",
  "PUBLISHING.md",
  "PRIVACY.md",
  "CHANGELOG.md",
  "community-assets/icon.png",
  "community-assets/cover.png",
];

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const code = await readFile(codePath, "utf8");
const ui = await readFile(uiPath, "utf8");
const failures = [];
const warnings = [];

assert(manifest.name === "🧜‍♀️🍓 Mermaid Jam", "manifest.name must be 🧜‍♀️🍓 Mermaid Jam.");
assert(manifest.api === "1.0.0", "manifest.api must be 1.0.0.");
assert(JSON.stringify(manifest.editorType) === JSON.stringify(["figma", "figjam"]), "manifest.editorType must be ['figma', 'figjam'].");
assert(manifest.documentAccess === "dynamic-page", "manifest.documentAccess must be dynamic-page.");
assert(manifest.main === "code.js", "manifest.main must point to code.js.");
assert(manifest.ui === "ui.html", "manifest.ui must point to ui.html.");
assert(JSON.stringify(manifest.networkAccess?.allowedDomains) === JSON.stringify(["none"]), "manifest.networkAccess.allowedDomains must be ['none'].");
assert(!("enableProposedApi" in manifest), "manifest must not enable proposed API.");
assert(!("enablePrivatePluginApi" in manifest), "manifest must not enable private plugin API.");
assert(!/\bimport\s*(?:\(|[{"*\w])/.test(code), "plugin/code.js contains import syntax rejected by Figma plugin sandbox.");
assert(!/<script[^>]+src=/.test(ui), "plugin/ui.html must inline all scripts.");
assert(!/Ollama|api\/generate|localhost:11434|127\.0\.0\.1:11434/i.test(`${code}\n${ui}`), "built plugin must not include removed Ollama/network code.");

const [codeStats, uiStats] = await Promise.all([stat(codePath), stat(uiPath)]);
for (const file of requiredFiles) {
  try {
    await stat(resolve(root, file));
  } catch {
    failures.push(`Missing publish support file: ${file}.`);
  }
}
if (codeStats.size > 500_000) warnings.push(`plugin/code.js is ${formatBytes(codeStats.size)}. Keep an eye on bundle size.`);
if (uiStats.size > 1_000_000) warnings.push(`plugin/ui.html is ${formatBytes(uiStats.size)}. Keep an eye on bundle size.`);
if (!/^\d+$/.test(String(manifest.id ?? ""))) {
  warnings.push("manifest.id is not a Figma-assigned numeric ID. Figma can assign one during first publish, or replace it with the ID from Create new plugin before submitting updates.");
}

if (failures.length > 0) {
  console.error(`Publish validation failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(`Publish validation warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`);
}
console.log("Publish validation OK");

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function formatBytes(bytes) {
  return `${Math.round(bytes / 1024)} KiB`;
}

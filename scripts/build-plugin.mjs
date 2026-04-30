import { build } from "vite";
import react from "@vitejs/plugin-react";
import { access, copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(rootDir, "plugin");
const tempRoot = await mkdtemp(join(tmpdir(), "mermaidjam-plugin-"));
const uiOutDir = join(tempRoot, "ui");

await build({
  configFile: false,
  root: rootDir,
  publicDir: false,
  build: {
    target: "es2017",
    minify: false,
    sourcemap: false,
    emptyOutDir: false,
    outDir,
    lib: {
      entry: resolve(rootDir, "src/plugin/main/index.ts"),
      formats: ["iife"],
      name: "MermaidJamPluginMain",
      fileName: () => "code.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

const bareMainOutput = join(outDir, "code");
try {
  await access(bareMainOutput);
  await rm(join(outDir, "code.js"), { force: true });
  await rename(bareMainOutput, join(outDir, "code.js"));
} catch {
  // Vite emitted code.js directly.
}
await assertNoMainImportTokens();

await build({
  configFile: false,
  root: resolve(rootDir, "src/plugin/ui"),
  publicDir: false,
  plugins: [react()],
  build: {
    target: "es2017",
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    outDir: uiOutDir,
    rollupOptions: {
      input: resolve(rootDir, "src/plugin/ui/index.html"),
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

await copyFile(resolve(rootDir, "plugin/manifest.json"), join(outDir, "manifest.json"));
const html = await readFile(join(uiOutDir, "index.html"), "utf-8");
await writeFile(join(outDir, "ui.html"), await inlineAssets(html, uiOutDir), "utf-8");
await writeBuildMeta();
await rm(tempRoot, { recursive: true, force: true });

async function inlineAssets(html, baseDir) {
  let result = html;
  const inlineScripts = [];

  for (const match of [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)]) {
    const source = await readFile(join(baseDir, match[1]), "utf-8");
    inlineScripts.push(`<script>\n${escapeInlineScript(source)}\n</script>`);
    result = result.replace(match[0], "");
  }

  for (const match of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)]) {
    const source = await readFile(join(baseDir, match[1]), "utf-8");
    result = result.replace(match[0], () => `<style>\n${source}\n</style>`);
  }

  if (inlineScripts.length > 0) {
    result = result.replace("</body>", () => `${inlineScripts.join("\n")}\n  </body>`);
  }

  return result;
}

function escapeInlineScript(source) {
  return source
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "\\x3C!--");
}

async function writeBuildMeta() {
  const [manifest, code, ui] = await Promise.all([
    asset("manifest.json"),
    asset("code.js"),
    asset("ui.html"),
  ]);
  const bundleHash = sha256(JSON.stringify([manifest.sha256, code.sha256, ui.sha256]));
  await writeFile(
    join(outDir, "build-meta.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), bundleHash, manifest, code, ui }, null, 2) + "\n",
    "utf-8",
  );
}

async function assertNoMainImportTokens() {
  const codePath = join(outDir, "code.js");
  const source = await readFile(codePath, "utf-8");
  if (/\bimport\s*(?:\(|[{"*\w])/.test(source)) {
    throw new Error("plugin/code.js contains an import token that Figma's plugin sandbox may reject.");
  }
}

async function asset(name) {
  const buffer = await readFile(join(outDir, name));
  return { path: join(outDir, name), bytes: buffer.byteLength, sha256: sha256(buffer) };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath !== import.meta.url) {
  // This script is intentionally side-effectful when imported by npm scripts.
}

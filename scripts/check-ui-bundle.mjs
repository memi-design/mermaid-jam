import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const uiPath = resolve("plugin/ui.html");
const html = await readFile(uiPath, "utf-8");
const openScripts = html.match(/^\s*<script>\s*$/gm) ?? [];
const closeScripts = html.match(/^\s*<\/script>\s*$/gm) ?? [];

if (openScripts.length !== 1 || closeScripts.length !== 1) {
  throw new Error(`Expected exactly one top-level inline script, got ${openScripts.length} open and ${closeScripts.length} close tags.`);
}

if (html.includes('/assets/index.js')) {
  throw new Error("ui.html still references a Vite asset instead of an inline bundle.");
}

const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.indexOf("</script>");
const scriptBody = html.slice(scriptStart, scriptEnd);
const rootIndex = html.indexOf('<div id="root"></div>');
const scriptIndex = html.indexOf("<script>");
if (rootIndex < 0) {
  throw new Error("ui.html is missing the React root element.");
}
if (scriptIndex < rootIndex) {
  throw new Error("Inline script appears before the React root element and will run too early.");
}
if (/<script[^>]+src=/.test(scriptBody) || /<\/script>/i.test(scriptBody)) {
  throw new Error("Inline script contains unescaped script markup.");
}

console.log("ui.html bundle integrity OK");

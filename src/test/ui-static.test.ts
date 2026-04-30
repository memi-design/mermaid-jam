/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("plugin UI static structure", () => {
  it("removes Copy Clean and clipboard code while keeping generate/update actions", () => {
    const source = readFileSync(new URL("../plugin/ui/main.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../plugin/ui/styles.css", import.meta.url), "utf8");

    expect(source).toContain("Generate");
    expect(source).toContain("Update");
    expect(source).toContain("Revise");
    expect(source).toContain("logEntries");
    expect(styles).toContain(".log-body");
    expect(source).not.toContain("Copy Clean");
    expect(source).not.toContain("Ollama");
    expect(source).not.toContain("AI Settings");
    expect(source).not.toContain("navigator.clipboard");
    expect(source).not.toContain("execCommand");
    expect(styles).toContain("grid-template-columns: 1fr 1fr;");
  });

  it("keeps the manifest local-only with no network access", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../plugin/manifest.json", import.meta.url), "utf8")) as {
      networkAccess?: { allowedDomains?: string[]; reasoning?: string };
    };

    expect(manifest.networkAccess?.allowedDomains).toEqual(["none"]);
    expect(manifest.networkAccess?.reasoning).toBeUndefined();
  });

  it("keeps the generated main script free of import tokens rejected by Figma", () => {
    const code = readFileSync(new URL("../../plugin/code.js", import.meta.url), "utf8");

    expect(code).not.toMatch(/\bimport\s*(?:\(|[{"*\w])/);
  });
});

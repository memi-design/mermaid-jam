import { parseMermaidJamSource, serializeMermaidJamSource } from "../parser/mermaidJam";
import type { DiagramStyleOptions } from "./types";

const defaultStyle: DiagramStyleOptions = {
  theme: "minimal",
  density: "compact",
  fontSize: 24,
  colorLayers: 3,
  layoutPreset: "compact",
  routingMode: "elbow",
  semanticMode: "auto",
  semanticRules: [],
  manualLayout: "preserve",
  journeyView: "clean",
};
const MAX_REVISE_LINES = 700;
const MAX_LABEL_LENGTH = 120;

export type ReviseResult =
  | { ok: true; source: string; changed: boolean; message: string }
  | { ok: false; source: string; message: string };

export function reviseSource(source: string, style: DiagramStyleOptions = defaultStyle): ReviseResult {
  if (source.split(/\r\n?|\n/).length > MAX_REVISE_LINES) {
    return {
      ok: false,
      source,
      message: `Source is too large to safely revise locally. Split it into diagrams under ${MAX_REVISE_LINES} lines.`,
    };
  }

  const prepared = runRevisions(source);
  const conflict = findConflictingNodeDeclaration(prepared);
  if (conflict) {
    return { ok: false, source, message: conflict };
  }

  const parsedPrepared = parseMermaidJamSource(prepared, style);
  const revised = parsedPrepared.ok ? serializeMermaidJamSource(parsedPrepared.diagram) : prepared;
  const parsed = parseMermaidJamSource(revised, style);
  if (!parsed.ok) {
    return {
      ok: false,
      source,
      message: parsed.diagnostics[0]?.message ?? "Could not revise this into supported Mermaid.",
    };
  }

  const clean = `${serializeMermaidJamSource(parsed.diagram)}\n`;
  return {
    ok: true,
    source: clean,
    changed: clean.trim() !== source.trim(),
    message: clean.trim() === source.trim() ? "Source is already clean." : "Revised into clean Mermaid.",
  };
}

function runRevisions(source: string): string {
  const unfenced = stripFence(source);
  const lines = unfenced
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeCharacters(line).trimEnd())
    .filter((line) => !/^\s*```/.test(line));

  const normalizedLines = dedupeStatements(lines).map(simplifyLongLabelsInLine);
  const body = normalizeCommonFlowSyntax(normalizedLines.join("\n").trim());
  if (!body) return "";
  if (hasKnownHeader(body)) return body;
  return `flowchart TD\n${body}`;
}

function stripFence(source: string): string {
  const trimmed = source.trim();
  const match = /^```[A-Za-z0-9_-]*[ \t]*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return match ? match[1] : trimmed;
}

function normalizeCharacters(line: string): string {
  return line
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\t/g, "  ");
}

function dedupeStatements(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!previousBlank) result.push("");
      previousBlank = true;
      continue;
    }
    previousBlank = false;
    const key = normalizeStatementKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function normalizeStatementKey(statement: string): string {
  return normalizeCommonFlowSyntax(statement).replace(/\s+/g, " ").trim().toLowerCase();
}

function hasKnownHeader(body: string): boolean {
  return /^\s*(---|flowchart\b|graph\b|journey\b|sequenceDiagram\b|stateDiagram(?:-v2)?\b|mindmap\b|timeline\b|#|-|\*)/i.test(body);
}

function normalizeCommonFlowSyntax(source: string): string {
  return source
    .replace(/\s*[→➜➡]\s*/g, " --> ")
    .replace(/\s*=>\s*/g, " --> ")
    .replace(/\s+-{1,2}>\s*/g, " --> ")
    .replace(/^\s*(td|top down)\s*$/im, "flowchart TD")
    .replace(/^\s*(tb|top bottom)\s*$/im, "flowchart TB")
    .replace(/^\s*(lr|left right|left to right)\s*$/im, "flowchart LR")
    .replace(/^\s*(rl|right left|right to left)\s*$/im, "flowchart RL");
}

function simplifyLongLabelsInLine(line: string): string {
  return line.replace(/(\(\(|\[|\(|\{)([^\])}]+)(\)\)|\]|\)|\})/g, (match, open: string, label: string, close: string) => {
    const cleaned = simplifyLabel(label.replace(/^['"]|['"]$/g, ""));
    return `${open}${quoteIfNeeded(cleaned, open)}${close}`;
  });
}

function simplifyLabel(label: string): string {
  const compact = label
    .replace(/\b(in order to|that are|that is|the user|user will|user should)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= MAX_LABEL_LENGTH) return compact;
  const hardStop = compact.slice(0, MAX_LABEL_LENGTH - 3);
  const wordSafe = hardStop.replace(/\s+\S*$/, "").trim();
  return `${wordSafe || hardStop}...`;
}

function quoteIfNeeded(label: string, open: string): string {
  if (open === "(" || open === "((") return label;
  return /[\[\]{}()|]/.test(label) ? `"${label.replace(/"/g, "'")}"` : label;
}

function findConflictingNodeDeclaration(source: string): string | null {
  const labelsById = new Map<string, string>();
  for (const line of source.split("\n")) {
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*(\(\(|\[|\(|\{|>)(.*?)(\)\)|\]|\)|\})\s*$/.exec(line.trim());
    if (!match) continue;
    const id = match[1];
    const label = match[3].replace(/^['"]|['"]$/g, "").trim();
    const existing = labelsById.get(id);
    if (existing && existing.toLowerCase() !== label.toLowerCase()) {
      return `Node ${id} has conflicting labels: "${existing}" and "${label}". Rename one node ID before revising.`;
    }
    labelsById.set(id, label);
  }
  return null;
}

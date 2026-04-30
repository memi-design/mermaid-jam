import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseMermaidJamSource, serializeMermaidJamSource } from "../../parser/mermaidJam";
import { createSourceHash } from "../../shared/hash";
import { reviseSource } from "../../shared/reviser";
import type {
  DensityName,
  Diagnostic,
  JourneyViewMode,
  LayoutPresetName,
  MainToUiMessage,
  ManualLayoutMode,
  RoutingMode,
  SemanticCategory,
  SemanticMode,
  SemanticRule,
  UiToMainMessage,
} from "../../shared/types";
import "./styles.css";

const densities: Array<{ value: DensityName; label: string }> = [
  { value: "compact", label: "Tight" },
  { value: "comfy", label: "Balanced" },
  { value: "spacious", label: "Wide" },
];

const layoutPresets: Array<{ value: LayoutPresetName; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "readable", label: "Readable" },
  { value: "presentation", label: "Presentation" },
  { value: "print", label: "Print" },
  { value: "wide-map", label: "Wide Map" },
  { value: "deep-tree", label: "Deep Tree" },
];

const routingModes: Array<{ value: RoutingMode; label: string }> = [
  { value: "direct", label: "Direct" },
  { value: "elbow", label: "Elbow" },
  { value: "avoid-nodes", label: "Avoid Nodes" },
  { value: "more-spacing", label: "More Spacing" },
  { value: "loop-friendly", label: "Loop Friendly" },
];

const semanticModes: Array<{ value: SemanticMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "custom", label: "Custom" },
  { value: "depth", label: "Depth Only" },
];

const journeyViews: Array<{ value: JourneyViewMode; label: string }> = [
  { value: "clean", label: "Clean" },
  { value: "scores", label: "Scores" },
  { value: "insights", label: "Insights" },
];

const semanticCategories = new Set<SemanticCategory>(["error", "warning", "success", "backend", "auth", "payment", "data", "external", "screen", "user", "decision", "note"]);

function App() {
  const [source, setSource] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [density, setDensity] = useState<DensityName>("compact");
  const [fontSize, setFontSize] = useState(24);
  const [colorLayers, setColorLayers] = useState(3);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetName>("compact");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("elbow");
  const [semanticMode, setSemanticMode] = useState<SemanticMode>("auto");
  const [semanticRulesText, setSemanticRulesText] = useState("");
  const [manualLayout, setManualLayout] = useState<ManualLayoutMode>("preserve");
  const [journeyView, setJourneyView] = useState<JourneyViewMode>("clean");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");

  const semanticRules = useMemo(() => parseSemanticRulesText(semanticRulesText), [semanticRulesText]);
  const styleOptions = useMemo(() => ({
    theme: "minimal" as const,
    density,
    fontSize,
    colorLayers,
    layoutPreset,
    routingMode,
    semanticMode,
    semanticRules,
    manualLayout,
    journeyView,
  }), [density, fontSize, colorLayers, layoutPreset, routingMode, semanticMode, semanticRules, manualLayout, journeyView]);
  const parseResult = useMemo(() => parseMermaidJamSource(source, styleOptions), [source, styleOptions]);
  const parsedTitle = parseResult.ok ? parseResult.diagram.title ?? "" : "";
  const normalizedSectionTitle = sectionTitle.trim();
  const diagramForRender = parseResult.ok
    ? { ...parseResult.diagram, title: normalizedSectionTitle || undefined }
    : null;
  const diagnostics = parseResult.diagnostics;
  const cleanSource = parseResult.ok
    ? serializeMermaidJamSource({ ...parseResult.diagram, title: normalizedSectionTitle || undefined })
    : parseResult.cleanSource;
  const canonicalSource = source.trim();
  const sourceHash = useMemo(() => createSourceHash(canonicalSource), [canonicalSource]);
  const canRender = parseResult.ok && source.trim().length > 0;
  const summary = source.trim() ? summarize(parseResult) : "Paste Mermaid or markdown";
  const logEntries = useMemo(() => createLogEntries(runtimeError, diagnostics, source.trim().length > 0 && parseResult.ok), [runtimeError, diagnostics, source, parseResult.ok]);
  const logSummary = summarizeLogs(logEntries);

  useEffect(() => {
    const stored = readLocal("mermaidjam.semanticRules");
    if (stored) setSemanticRulesText(stored);
  }, []);

  useEffect(() => {
    writeLocal("mermaidjam.semanticRules", semanticRulesText);
  }, [semanticRulesText]);

  useEffect(() => {
    if (!titleEdited && parsedTitle && sectionTitle !== parsedTitle) {
      setSectionTitle(parsedTitle);
    }
  }, [parsedTitle, sectionTitle, titleEdited]);

  useEffect(() => {
    if (logEntries.some((entry) => entry.level === "error")) {
      setLogOpen(true);
    }
  }, [logEntries]);

  useEffect(() => {
    window.onmessage = (event: MessageEvent<{ pluginMessage?: MainToUiMessage }>) => {
      const message = event.data.pluginMessage;
      if (!message) return;
      switch (message.type) {
        case "ready":
          break;
        case "render-success":
          setRuntimeError("");
          break;
        case "render-error":
          setRuntimeError(message.message);
          break;
        case "selection-source":
          setSource(message.source);
          setSectionTitle(message.metadata.title ?? "");
          setTitleEdited(false);
          setDensity(message.metadata.style.density);
          setFontSize(message.metadata.style.fontSize ?? 24);
          setColorLayers(message.metadata.style.colorLayers ?? 3);
          setLayoutPreset(message.metadata.style.layoutPreset ?? "compact");
          setRoutingMode(message.metadata.style.routingMode ?? "elbow");
          setSemanticMode(message.metadata.style.semanticMode ?? "auto");
          setSemanticRulesText(formatSemanticRulesText(message.metadata.style.semanticRules ?? []));
          setManualLayout(message.metadata.style.manualLayout ?? "preserve");
          setJourneyView(message.metadata.style.journeyView ?? "clean");
          setRuntimeError("");
          break;
        case "selection-source-error":
          setRuntimeError(message.message);
          break;
      }
    };
  }, []);

  function submit(type: "generate" | "update-selection") {
    if (!diagramForRender) return;
    postToMain({ type, diagram: diagramForRender, source: canonicalSource, sourceHash });
  }

  function formatSource() {
    if (!cleanSource) return;
    setSource(`${cleanSource}\n`);
  }

  function reviseCurrentSource() {
    if (!source.trim()) return;
    const result = reviseSource(source, styleOptions);
    if (!result.ok) {
      setRuntimeError(result.message);
      return;
    }
    setSource(result.source);
    setRuntimeError("");
  }

  return (
    <main className="shell">
      <div className="sticky-top">
        <section className="control-panel" aria-label="Diagram controls">
          <div className="panel-head">
            <label className="title-control field">
              <span>Title</span>
              <input
                value={sectionTitle}
                onChange={(event) => {
                  setSectionTitle(event.target.value);
                  setTitleEdited(true);
                  setRuntimeError("");
                }}
                placeholder="Section title"
                aria-label="FigJam section title"
              />
            </label>
            <div className={`summary ${parseResult.ok && source.trim() ? "ok" : diagnostics.length ? "error" : ""}`}>{summary}</div>
            <div className="panel-actions">
              <button className="secondary-button" type="button" onClick={() => postToMain({ type: "load-from-selection" })}>Load</button>
              <button className="secondary-button" type="button" disabled={!source.trim()} onClick={reviseCurrentSource}>Revise</button>
            </div>
          </div>

          <div className="quick-row">
            <button
              className="secondary-button options-button"
              type="button"
              aria-expanded={controlsOpen}
              onClick={() => setControlsOpen((open) => !open)}
            >
              {controlsOpen ? "Hide options" : `Options: ${labelFor(layoutPresets, layoutPreset)} / ${labelFor(routingModes, routingMode)} / ${fontSize}px`}
            </button>
            <button className="secondary-button format-button" type="button" disabled={!cleanSource} onClick={formatSource}>Format</button>
          </div>

          {controlsOpen ? (
            <div className="advanced-panel">
              <div className="control-grid">
                <label className="field field-wide">
                  <span>Layout</span>
                  <select value={layoutPreset} onChange={(event) => setLayoutPreset(event.target.value as LayoutPresetName)}>
                    {layoutPresets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="field field-wide">
                  <span>Routing</span>
                  <select value={routingMode} onChange={(event) => setRoutingMode(event.target.value as RoutingMode)}>
                    {routingModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="field field-wide">
                  <span>Update</span>
                  <select value={manualLayout} onChange={(event) => setManualLayout(event.target.value as ManualLayoutMode)}>
                    <option value="preserve">Preserve moved</option>
                    <option value="reset">Reset layout</option>
                  </select>
                </label>
                <label className="field">
                  <span>Journey</span>
                  <select value={journeyView} onChange={(event) => setJourneyView(event.target.value as JourneyViewMode)}>
                    {journeyViews.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Spacing</span>
                  <select value={density} onChange={(event) => setDensity(event.target.value as DensityName)}>
                    {densities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="field field-tight">
                  <span>Font</span>
                  <select value={fontSize} onChange={(event) => setFontSize(Number.parseInt(event.target.value, 10))}>
                    {[24, 28, 32, 40, 48, 56, 64].map((size) => <option key={size} value={size}>{size}px</option>)}
                  </select>
                </label>
                <label className="field field-tight">
                  <span>Colors</span>
                  <select value={colorLayers} onChange={(event) => setColorLayers(Number.parseInt(event.target.value, 10))}>
                    {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Semantics</span>
                  <select value={semanticMode} onChange={(event) => setSemanticMode(event.target.value as SemanticMode)}>
                    {semanticModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>

              {semanticMode === "custom" ? (
                <label className="semantic-rules field">
                  <span>Rules</span>
                  <input
                    value={semanticRulesText}
                    onChange={(event) => setSemanticRulesText(event.target.value)}
                    placeholder="failed,error=error; checkout,pay=payment; screen,page=screen"
                    aria-label="Custom semantic styling rules"
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <section className="editor-panel" aria-label="Mermaid or Markdown source editor">
        <div className="editor-head">
          <span>Mermaid or Markdown</span>
          <span>{lineNumbers(source).length} lines</span>
        </div>
        <div className="editor-wrap">
          <div className="gutter" aria-hidden="true">
            {lineNumbers(source).map((line) => <span key={line}>{line}</span>)}
          </div>
          <textarea
            autoFocus
            spellCheck={false}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setRuntimeError("");
            }}
            placeholder={'Paste Mermaid or Markdown here:\nflowchart TD\n  Start["User opens app"]\n  Start --> Loading["Loading..."]'}
            aria-label="Mermaid or Markdown source"
          />
        </div>
      </section>

      <footer className="sticky-footer">
        <section className={`log-panel ${logOpen ? "open" : ""}`} aria-live="polite">
          <button className="log-head" type="button" aria-expanded={logOpen} onClick={() => setLogOpen((open) => !open)}>
            <span className={`log-dot ${logSummary.level}`} />
            <span className="log-title">{logSummary.title}</span>
            <span className="log-meta">{logOpen ? "Collapse" : "Expand"}</span>
          </button>
          {logOpen ? (
            <div className="log-body" role="log">
              {logEntries.map((entry, index) => (
                <div key={`${entry.level}-${entry.line ?? 0}-${entry.message}-${index}`} className={`log-line ${entry.level}`}>
                  <span className="log-prefix">{entry.level.toUpperCase()}</span>
                  <span className="log-location">{entry.line ? `L${entry.line}${entry.column ? `:${entry.column}` : ""}` : "--"}</span>
                  <span className="log-message">{entry.message}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="actions">
          <button type="button" disabled={!canRender} onClick={() => submit("generate")}>Generate</button>
          <button type="button" disabled={!canRender} onClick={() => submit("update-selection")}>Update</button>
        </section>
      </footer>
    </main>
  );
}

function summarize(result: ReturnType<typeof parseMermaidJamSource>): string {
  if (!result.ok) {
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.level === "error").length;
    const warnings = result.diagnostics.length - errors;
    return [errors ? `${errors} errors` : "", warnings ? `${warnings} warnings` : ""].filter(Boolean).join(" / ") || "Invalid";
  }
  const nodes = result.diagram.nodes.length;
  const edges = result.diagram.edges.length;
  const kind = result.diagram.kind ?? "flowchart";
  return `${nodes} nodes / ${edges} edges / ${result.diagram.direction} / ${kind}`;
}

function lineNumbers(source: string): number[] {
  const count = Math.max(1, source.split("\n").length);
  return Array.from({ length: count }, (_, index) => index + 1);
}

function labelFor<T extends string>(items: Array<{ value: T; label: string }>, value: T): string {
  return items.find((item) => item.value === value)?.label ?? value;
}

type LogEntry = {
  level: "ok" | "warning" | "error";
  message: string;
  line?: number;
  column?: number;
};

function createLogEntries(runtimeError: string, diagnostics: Diagnostic[], isValid: boolean): LogEntry[] {
  if (runtimeError) return [{ level: "error", message: runtimeError }];
  const parsedDiagnostics = diagnostics as Array<{ level: "error" | "warning"; message: string; line?: number; column?: number }>;
  if (parsedDiagnostics.length > 0) {
    return parsedDiagnostics.map((diagnostic) => ({
      level: diagnostic.level,
      message: diagnostic.message,
      line: diagnostic.line,
      column: diagnostic.column,
    }));
  }
  if (isValid) return [{ level: "ok", message: "Valid source. Ready to generate." }];
  return [{ level: "ok", message: "No source pasted yet." }];
}

function summarizeLogs(entries: LogEntry[]): { level: LogEntry["level"]; title: string } {
  const errors = entries.filter((entry) => entry.level === "error").length;
  const warnings = entries.filter((entry) => entry.level === "warning").length;
  if (errors > 0) return { level: "error", title: `${errors} error${errors === 1 ? "" : "s"}${warnings ? ` / ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}` };
  if (warnings > 0) return { level: "warning", title: `${warnings} warning${warnings === 1 ? "" : "s"}` };
  return { level: "ok", title: entries[0]?.message ?? "Ready" };
}

function parseSemanticRulesText(source: string): SemanticRule[] {
  return source.split(/[;\n]+/).flatMap((entry, index) => {
    const trimmed = entry.trim();
    if (!trimmed) return [];
    const match = /^(.+?)\s*(?:=|:)\s*([a-z-]+)(?:\/(#[0-9a-fA-F]{6}))?(?:\/(#[0-9a-fA-F]{6}))?(?:\/(#[0-9a-fA-F]{6}))?$/.exec(trimmed);
    if (!match) return [];
    const category = match[2] as SemanticCategory;
    if (!semanticCategories.has(category)) return [];
    const keywords = match[1].split(",").map((keyword) => keyword.trim()).filter(Boolean);
    if (keywords.length === 0) return [];
    return [{
      id: `custom-${index + 1}`,
      keywords,
      category,
      fill: match[3]?.toUpperCase(),
      stroke: match[4]?.toUpperCase(),
      text: match[5]?.toUpperCase(),
      enabled: true,
      priority: 5,
    }];
  });
}

function formatSemanticRulesText(rules: SemanticRule[]): string {
  return rules
    .filter((rule) => rule.keywords.length > 0)
    .map((rule) => `${rule.keywords.join(",")}: ${rule.category}${rule.fill ? `/${rule.fill}` : ""}${rule.stroke ? `/${rule.stroke}` : ""}${rule.text ? `/${rule.text}` : ""}`)
    .join("; ");
}

function readLocal(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeLocal(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Local storage is optional in the plugin iframe; metadata still round-trips rules.
  }
}

function postToMain(message: UiToMainMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

createRoot(document.getElementById("root")!).render(<App />);

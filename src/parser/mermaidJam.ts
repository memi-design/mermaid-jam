import { normalizeColorLayers, normalizeDensity, normalizeFontSize, normalizeJourneyView, normalizeLayoutPreset, normalizeManualLayout, normalizeRoutingMode, normalizeSemanticMode, normalizeSemanticRules, normalizeTheme } from "../shared/styles";
import {
  SCHEMA_VERSION,
  type DensityName,
  type Diagnostic,
  type DiagramStyleOptions,
  type GraphEdge,
  type GraphEdgeStyle,
  type GraphNode,
  type GraphNodeShape,
  type JourneyMap,
  type JourneySection,
  type JourneyStep,
  type MermaidDirection,
  type MermaidGraph,
  type ParseResult,
  type ThemeName,
} from "../shared/types";

const defaultStyle: DiagramStyleOptions = { theme: "minimal", density: "comfy", fontSize: 24, colorLayers: 3, layoutPreset: "compact", routingMode: "elbow", semanticMode: "auto", semanticRules: [], manualLayout: "preserve", journeyView: "clean" };
const supportedDirections = new Set<MermaidDirection>(["TD", "TB", "BT", "LR", "RL"]);
const unsupportedPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^subgraph\b/i, label: "subgraphs" },
  { pattern: /^classDef\b/i, label: "class definitions" },
  { pattern: /^class\b/i, label: "class assignments" },
  { pattern: /^style\b/i, label: "style directives" },
  { pattern: /^linkStyle\b/i, label: "linkStyle directives" },
  { pattern: /^click\b/i, label: "click callbacks" },
  { pattern: /^%%\{/i, label: "Mermaid init directives" },
  { pattern: /^icon\b/i, label: "icons" },
  { pattern: /^image\b/i, label: "images" },
];

type ParserOptions = Partial<DiagramStyleOptions>;

type LineRecord = {
  text: string;
  originalLine: number;
};

type NodeDraft = Omit<GraphNode, "sourceLine"> & { sourceLine?: number };

type NodeParseResult = {
  id: string;
  label: string;
  shape: GraphNodeShape;
  consumed: number;
};

type ParsedStatement = {
  nodes: NodeDraft[];
  edges?: Array<Omit<GraphEdge, "id">>;
};

type EdgeOperator = {
  start: number;
  end: number;
  label?: string;
  style: GraphEdgeStyle;
};

export function parseMermaidJamSource(source: string, options: ParserOptions = {}): ParseResult {
  const type = detectMermaidType(source);
  switch (type) {
    case "flowchart":
    case "graph":
      return parseMermaidFlowchart(source, options);
    case "journey":
      return parseMermaidJourney(source, options);
    case "sequenceDiagram":
      return parseMermaidSequence(source, options);
    case "stateDiagram":
    case "stateDiagram-v2":
      return parseMermaidState(source, options);
    case "mindmap":
      return parseMermaidMindmap(source, options);
    case "timeline":
      return parseMermaidTimeline(source, options);
    default:
      if (type) return unsupportedMermaidResult(source, type);
  }
  return parseMarkdownJourney(source, options, []);
}

export function parseMermaidFlowchart(source: string, options: ParserOptions = {}): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const stripped = stripCodeFence(source);
  const frontmatter = readFrontmatter(stripped.text);
  const style = mergeStyle(frontmatter, options);
  const lines = toLineRecords(frontmatter.body, stripped.lineOffset + frontmatter.lineOffset);
  const cleanLines: string[] = [];
  const nodes = new Map<string, NodeDraft>();
  const edges: GraphEdge[] = [];
  let direction: MermaidDirection | null = null;
  let headerSeen = false;

  for (const record of lines) {
    const statement = record.text.trim();
    if (!statement) continue;

    const unsupported = unsupportedPatterns.find((entry) => entry.pattern.test(statement));
    if (unsupported) {
      diagnostics.push(error(record.originalLine, 1, `${unsupported.label} are not supported in v1.`));
      cleanLines.push(record.text.trimEnd());
      continue;
    }

    if (statement.startsWith("%%")) continue;

    if (!headerSeen) {
      const header = parseHeader(statement);
      if (!header) {
        diagnostics.push(error(record.originalLine, 1, "First non-empty line must be `flowchart TD` or `graph LR` with direction TD, TB, BT, LR, or RL."));
      } else {
        direction = header.direction;
        headerSeen = true;
        cleanLines.push(`${header.keyword} ${header.direction}`);
      }
      continue;
    }

    if (parseHeader(statement)) {
      diagnostics.push(error(record.originalLine, 1, "Only one flowchart header is allowed."));
      cleanLines.push(record.text.trimEnd());
      continue;
    }

    const parsed = parseStatement(statement, record.originalLine, diagnostics);
    if (!parsed) {
      cleanLines.push(record.text.trimEnd());
      continue;
    }

    for (const node of parsed.nodes) upsertNode(nodes, node, record.originalLine);
    for (const edge of parsed.edges ?? []) edges.push({ ...edge, id: `edge-${edges.length + 1}` });
    cleanLines.push(normalizeStatement(parsed));
  }

  if (!headerSeen) diagnostics.push(error(1, 1, "Missing Mermaid flowchart header."));
  if (headerSeen && nodes.size === 0 && !diagnostics.some((diagnostic) => diagnostic.level === "error")) diagnostics.push(error(lines[0]?.originalLine ?? 1, 1, "Flowchart must include at least one node or edge."));

  const fallbackCleanSource = cleanLines.join("\n").trim();
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.level === "error");
  if (hasErrors || !direction) return { ok: false, diagnostics, cleanSource: fallbackCleanSource };

  const graphNodes = [...nodes.values()].map((node) => ({
    id: node.id,
    label: node.label,
    shape: node.shape,
    sourceLine: node.sourceLine ?? 1,
  }));
  const cleanSource = formatGraph({
    title: frontmatter.title,
    direction,
    nodes: graphNodes,
    edges,
  });

  return {
    ok: true,
    diagnostics,
    diagram: {
      schemaVersion: SCHEMA_VERSION,
      kind: "flowchart",
      title: frontmatter.title,
      style,
      direction,
      nodes: graphNodes,
      edges,
      cleanSource,
    },
  };
}

export function serializeMermaidFlowchart(graph: MermaidGraph): string {
  return formatGraph({
    title: graph.title?.trim() || undefined,
    direction: graph.direction,
    nodes: graph.nodes,
    edges: graph.edges,
  });
}

export function serializeMermaidJamSource(graph: MermaidGraph): string {
  if (graph.journey) return formatJourney({ ...graph.journey, title: graph.title ?? graph.journey.title });
  return serializeMermaidFlowchart(graph);
}

function parseMarkdownJourney(source: string, options: ParserOptions, fallbackDiagnostics: Diagnostic[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const stripped = stripAnyCodeFence(source);
  const frontmatter = readFrontmatter(stripped.text);
  const style = mergeStyle(frontmatter, options);
  const lines = toLineRecords(frontmatter.body, stripped.lineOffset + frontmatter.lineOffset);
  const nodes = new Map<string, NodeDraft>();
  const edges: Array<Omit<GraphEdge, "id">> = [];
  const journeySections: JourneySection[] = [];
  const journeyNotes: string[] = [];
  const usedIds = new Set<string>();
  let title = frontmatter.title;
  let lastNodeId = "";
  let currentJourneySection: JourneySection | null = null;
  let phaseCount = 0;
  let stepCount = 0;
  let explicitArrowCount = 0;

  for (const record of lines) {
    const raw = record.text.trim();
    if (!raw || /^---+$/.test(raw) || /^```/.test(raw) || isMarkdownTableDivider(raw)) continue;

    const heading = /^(#{1,4})\s+(.+)$/.exec(raw);
    if (heading) {
      const level = heading[1].length;
      const label = cleanMarkdownText(heading[2]);
      if (level === 1 && !title) {
        title = label;
        continue;
      }
      if (level <= 3) {
        const id = upsertMarkdownNode(nodes, usedIds, label, record.originalLine, "rounded");
        currentJourneySection = { id, title: label, sourceLine: record.originalLine, steps: [] };
        journeySections.push(currentJourneySection);
        if (lastNodeId && lastNodeId !== id) edges.push(edgeDraft(lastNodeId, id, record.originalLine));
        lastNodeId = id;
        phaseCount += 1;
      }
      continue;
    }

    const tableStep = parseMarkdownTableStep(raw);
    if (!tableStep && isMarkdownNote(raw)) {
      journeyNotes.push(cleanMarkdownText(raw));
      continue;
    }
    const item = tableStep ?? parseMarkdownItem(raw);
    if (!item) continue;

    const arrow = parseMarkdownArrow(item);
    if (arrow) {
      const from = upsertMarkdownNode(nodes, usedIds, arrow.from, record.originalLine);
      const to = upsertMarkdownNode(nodes, usedIds, arrow.to, record.originalLine);
      edges.push(edgeDraft(from, to, record.originalLine, arrow.label));
      lastNodeId = to;
      explicitArrowCount += 1;
      continue;
    }

    const id = upsertMarkdownNode(nodes, usedIds, item, record.originalLine);
    currentJourneySection ??= createImplicitJourneySection(nodes, journeySections, usedIds, record.originalLine);
    currentJourneySection.steps.push(markdownJourneyStep(id, item, record.originalLine));
    if (lastNodeId && lastNodeId !== id) edges.push(edgeDraft(lastNodeId, id, record.originalLine));
    lastNodeId = id;
    stepCount += 1;
  }

  if (nodes.size === 0) {
    return {
      ok: false,
      diagnostics: fallbackDiagnostics.length > 0 ? fallbackDiagnostics : [error(1, 1, "Paste Mermaid flowchart, Mermaid journey, or Markdown headings/bullets for a user journey.")],
      cleanSource: "",
    };
  }

  if (edges.length === 0 && nodes.size > 1) {
    const ids = [...nodes.keys()];
    for (let index = 1; index < ids.length; index += 1) edges.push(edgeDraft(ids[index - 1], ids[index], nodes.get(ids[index])?.sourceLine ?? 1));
  }

  const graphNodes = [...nodes.values()].map((node) => ({
    id: node.id,
    label: node.label,
    shape: node.shape,
    sourceLine: node.sourceLine ?? 1,
  }));
  const graphEdges = edges.map((edge, index) => ({ ...edge, id: `edge-${index + 1}` }));
  const direction: MermaidDirection = phaseCount >= 2 || explicitArrowCount > 0 || /journey|persona|timeline|phase/i.test(`${title ?? ""}\n${source}`) ? "LR" : "TD";
  const journey = journeySections.some((section) => section.steps.length > 0)
    ? { title, actor: firstJourneyActor(journeySections), sections: journeySections, notes: journeyNotes }
    : undefined;
  const cleanSource = journey ? formatJourney(journey) : formatGraph({ title, direction, nodes: graphNodes, edges: graphEdges });

  if (stepCount === 0 && phaseCount > 0) diagnostics.push({ level: "warning", message: "Only headings were found; add bullets for journey steps.", line: lines[0]?.originalLine ?? 1 });

  return {
    ok: true,
    diagnostics,
    diagram: {
      schemaVersion: SCHEMA_VERSION,
      kind: journey ? "markdown" : "flowchart",
      title,
      style,
      direction,
      nodes: graphNodes,
      edges: graphEdges,
      cleanSource,
      journey,
    },
  };
}

function parseMermaidJourney(source: string, options: ParserOptions): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const stripped = stripAnyCodeFence(source);
  const frontmatter = readFrontmatter(stripped.text);
  const style = mergeStyle(frontmatter, options);
  const lines = toLineRecords(frontmatter.body, stripped.lineOffset + frontmatter.lineOffset);
  const nodes = new Map<string, NodeDraft>();
  const edges: Array<Omit<GraphEdge, "id">> = [];
  const sections: JourneySection[] = [];
  const notes: string[] = [];
  const usedIds = new Set<string>();
  let title = frontmatter.title;
  let headerSeen = false;
  let lastNodeId = "";
  let currentSection: JourneySection | null = null;
  let taskCount = 0;

  for (const record of lines) {
    const raw = record.text.trim();
    if (!raw || /^```/.test(raw)) continue;
    const comment = /^%%\s*(.+)$/.exec(raw);
    if (comment) {
      notes.push(cleanMarkdownText(comment[1]));
      continue;
    }

    if (!headerSeen) {
      if (!/^journey\b/i.test(raw)) {
        diagnostics.push(error(record.originalLine, 1, "Mermaid journey must start with `journey`."));
        continue;
      }
      headerSeen = true;
      continue;
    }

    const titleMatch = /^title\s+(.+)$/i.exec(raw);
    if (titleMatch) {
      title = cleanMarkdownText(titleMatch[1]);
      continue;
    }

    const sectionMatch = /^section\s+(.+)$/i.exec(raw);
    if (sectionMatch) {
      const label = cleanMarkdownText(sectionMatch[1]);
      const id = upsertMarkdownNode(nodes, usedIds, label, record.originalLine, "rounded");
      currentSection = { id, title: label, sourceLine: record.originalLine, steps: [] };
      sections.push(currentSection);
      if (lastNodeId && lastNodeId !== id) edges.push(edgeDraft(lastNodeId, id, record.originalLine));
      lastNodeId = id;
      continue;
    }

    const task = parseJourneyTask(raw);
    if (!task) {
      diagnostics.push(error(record.originalLine, 1, "Expected `title`, `section`, or `Task label: score: actor`."));
      continue;
    }

    const id = upsertMarkdownNode(nodes, usedIds, task.label, record.originalLine, task.score >= 4 ? "terminal" : "rounded");
    currentSection ??= createImplicitJourneySection(nodes, sections, usedIds, record.originalLine);
    currentSection.steps.push({ id, label: task.label, score: task.score, actor: task.actor, sourceLine: record.originalLine });
    if (lastNodeId && lastNodeId !== id) edges.push(edgeDraft(lastNodeId, id, record.originalLine));
    lastNodeId = id;
    taskCount += 1;
  }

  if (!headerSeen) diagnostics.push(error(1, 1, "Missing Mermaid journey header."));
  if (taskCount === 0) diagnostics.push(error(lines[0]?.originalLine ?? 1, 1, "Journey must include at least one task row like `Opens app: 5: User`."));
  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) return { ok: false, diagnostics, cleanSource: stripped.text.trim() };

  const graphNodes = [...nodes.values()].map((node) => ({
    id: node.id,
    label: node.label,
    shape: node.shape,
    sourceLine: node.sourceLine ?? 1,
  }));
  const graphEdges = edges.map((edge, index) => ({ ...edge, id: `edge-${index + 1}` }));
  const journey: JourneyMap = { title, actor: firstJourneyActor(sections), sections, notes };
  const cleanSource = formatJourney(journey);

  return {
    ok: true,
    diagnostics,
    diagram: {
      schemaVersion: SCHEMA_VERSION,
      kind: "journey",
      title,
      style,
      direction: "LR",
      nodes: graphNodes,
      edges: graphEdges,
      cleanSource,
      journey,
    },
  };
}

function parseMermaidSequence(source: string, options: ParserOptions): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const { records, style, frontmatter } = sourceRecords(source, options);
  const nodes = new Map<string, NodeDraft>();
  const edges: Array<Omit<GraphEdge, "id">> = [];
  const participants = new Map<string, string>();
  let title = frontmatter.title;
  let headerSeen = false;
  let previousStep = "";
  let stepCount = 0;

  for (const record of records) {
    const raw = record.text.trim();
    if (!raw || raw.startsWith("%%")) continue;
    if (!headerSeen) {
      if (!/^sequenceDiagram\b/i.test(raw)) {
        diagnostics.push(error(record.originalLine, 1, "Mermaid sequence input must start with `sequenceDiagram`."));
      }
      headerSeen = true;
      continue;
    }

    const titleMatch = /^title\s+(.+)$/i.exec(raw);
    if (titleMatch) {
      title = cleanMarkdownText(titleMatch[1]);
      continue;
    }

    const participant = /^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i.exec(raw);
    if (participant) {
      participants.set(participant[1], cleanMarkdownText(participant[2] ?? participant[1]));
      continue;
    }

    if (/^(activate|deactivate|note|loop|alt|else|opt|par|and|critical|break|rect|end)\b/i.test(raw)) {
      diagnostics.push({ level: "warning", line: record.originalLine, message: "Advanced sequence blocks are flattened in the FigJam conversion." });
      continue;
    }

    const message = /^([A-Za-z0-9_.-]+?)\s*(?:--?>>|--?>|--?x|--?\)|==?>>|==?>)\s*([A-Za-z0-9_.-]+)\s*:?\s*(.*)$/.exec(raw);
    if (!message) {
      diagnostics.push(error(record.originalLine, 1, "Expected a sequence message like `User->>App: Opens app`."));
      continue;
    }

    const from = participants.get(message[1]) ?? message[1];
    const to = participants.get(message[2]) ?? message[2];
    const label = cleanMarkdownText(message[3] || `${from} to ${to}`);
    const nodeId = uniqueNodeId(`Message ${stepCount + 1} ${label}`, new Set(nodes.keys()));
    const nodeLabel = `${from} → ${to}\n${label}`;
    nodes.set(nodeId, { id: nodeId, label: nodeLabel, shape: "rounded", sourceLine: record.originalLine });
    if (previousStep) edges.push(edgeDraft(previousStep, nodeId, record.originalLine));
    previousStep = nodeId;
    stepCount += 1;
  }

  if (!headerSeen) diagnostics.push(error(1, 1, "Missing Mermaid sequenceDiagram header."));
  if (stepCount === 0) diagnostics.push(error(records[0]?.originalLine ?? 1, 1, "Sequence diagram must include at least one message."));
  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) return { ok: false, diagnostics, cleanSource: "" };

  return finalizeGraph({ kind: "sequence", title, style, direction: "TD", nodes, edges });
}

function parseMermaidState(source: string, options: ParserOptions): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const { records, style, frontmatter } = sourceRecords(source, options);
  const nodes = new Map<string, NodeDraft>();
  const edges: Array<Omit<GraphEdge, "id">> = [];
  const aliases = new Map<string, string>();
  let title = frontmatter.title;
  let headerSeen = false;

  for (const record of records) {
    const raw = record.text.trim();
    if (!raw || raw.startsWith("%%")) continue;
    if (!headerSeen) {
      if (!/^stateDiagram(?:-v2)?\b/i.test(raw)) diagnostics.push(error(record.originalLine, 1, "Mermaid state input must start with `stateDiagram-v2` or `stateDiagram`."));
      headerSeen = true;
      continue;
    }

    const titleMatch = /^title\s+(.+)$/i.exec(raw);
    if (titleMatch) {
      title = cleanMarkdownText(titleMatch[1]);
      continue;
    }

    const alias = /^state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_-]+)$/i.exec(raw);
    if (alias) {
      aliases.set(alias[2], cleanMarkdownText(alias[1]));
      upsertNode(nodes, { id: alias[2], label: aliases.get(alias[2])!, shape: "rounded", sourceLine: record.originalLine }, record.originalLine);
      continue;
    }

    if (/^(state\s+[A-Za-z0-9_-]+\s*\{|choice\b|fork\b|join\b|note\b|end\b)/i.test(raw)) {
      diagnostics.push({ level: "warning", line: record.originalLine, message: "Nested state blocks are flattened in the FigJam conversion." });
      continue;
    }

    const transition = /^(\[\*\]|[A-Za-z0-9_-]+)\s*-->\s*(\[\*\]|[A-Za-z0-9_-]+)(?:\s*:\s*(.+))?$/.exec(raw);
    if (!transition) {
      const stateLabel = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(raw);
      if (stateLabel) {
        const id = stateLabel[1];
        upsertNode(nodes, { id, label: cleanMarkdownText(stateLabel[2]), shape: "rounded", sourceLine: record.originalLine }, record.originalLine);
        continue;
      }
      diagnostics.push(error(record.originalLine, 1, "Expected a state transition like `Idle --> Loading: tap`."));
      continue;
    }

    const from = stateEndpointId(transition[1], edges.length, "Start");
    const to = stateEndpointId(transition[2], edges.length, "End");
    upsertNode(nodes, stateNode(from, transition[1], aliases, record.originalLine), record.originalLine);
    upsertNode(nodes, stateNode(to, transition[2], aliases, record.originalLine), record.originalLine);
    edges.push(edgeDraft(from, to, record.originalLine, transition[3] ? cleanMarkdownText(transition[3]) : undefined));
  }

  if (!headerSeen) diagnostics.push(error(1, 1, "Missing Mermaid stateDiagram header."));
  if (nodes.size === 0 || edges.length === 0) diagnostics.push(error(records[0]?.originalLine ?? 1, 1, "State diagram must include at least one transition."));
  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) return { ok: false, diagnostics, cleanSource: "" };

  return finalizeGraph({ kind: "state", title, style, direction: "TD", nodes, edges });
}

function parseMermaidMindmap(source: string, options: ParserOptions): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const { records, style, frontmatter } = sourceRecords(source, options);
  const nodes = new Map<string, NodeDraft>();
  const edges: Array<Omit<GraphEdge, "id">> = [];
  const stack: Array<{ indent: number; id: string }> = [];
  const usedIds = new Set<string>();
  let title = frontmatter.title;
  let headerSeen = false;

  for (const record of records) {
    if (!record.text.trim() || record.text.trim().startsWith("%%")) continue;
    const raw = record.text.trim();
    if (!headerSeen) {
      if (!/^mindmap\b/i.test(raw)) diagnostics.push(error(record.originalLine, 1, "Mermaid mindmap input must start with `mindmap`."));
      headerSeen = true;
      continue;
    }
    const label = cleanMarkdownText(raw.replace(/^\)+|\)+$/g, "").replace(/^\(+|\(+$/g, ""));
    if (!label) continue;
    const indent = record.text.match(/^\s*/)?.[0].length ?? 0;
    const id = uniqueNodeId(label, usedIds);
    nodes.set(id, { id, label, shape: stack.length === 0 ? "terminal" : "rounded", sourceLine: record.originalLine });
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) edges.push(edgeDraft(parent.id, id, record.originalLine));
    else if (!title) title = label;
    stack.push({ indent, id });
  }

  if (!headerSeen) diagnostics.push(error(1, 1, "Missing Mermaid mindmap header."));
  if (nodes.size === 0) diagnostics.push(error(records[0]?.originalLine ?? 1, 1, "Mindmap must include at least one node."));
  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) return { ok: false, diagnostics, cleanSource: "" };

  return finalizeGraph({ kind: "mindmap", title, style, direction: "LR", nodes, edges });
}

function parseMermaidTimeline(source: string, options: ParserOptions): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const { records, style, frontmatter } = sourceRecords(source, options);
  const nodes = new Map<string, NodeDraft>();
  const edges: Array<Omit<GraphEdge, "id">> = [];
  const usedIds = new Set<string>();
  let title = frontmatter.title;
  let currentSection = "";
  let headerSeen = false;
  let previous = "";

  for (const record of records) {
    const raw = record.text.trim();
    if (!raw || raw.startsWith("%%")) continue;
    if (!headerSeen) {
      if (!/^timeline\b/i.test(raw)) diagnostics.push(error(record.originalLine, 1, "Mermaid timeline input must start with `timeline`."));
      headerSeen = true;
      continue;
    }
    const titleMatch = /^title\s+(.+)$/i.exec(raw);
    if (titleMatch) {
      title = cleanMarkdownText(titleMatch[1]);
      continue;
    }
    const sectionMatch = /^section\s+(.+)$/i.exec(raw);
    if (sectionMatch) {
      currentSection = cleanMarkdownText(sectionMatch[1]);
      continue;
    }
    const event = /^(.+?)\s*:\s*(.+)$/.exec(raw);
    if (!event) {
      diagnostics.push(error(record.originalLine, 1, "Expected a timeline event like `2026 : Launch beta`."));
      continue;
    }
    const when = cleanMarkdownText(event[1]);
    const what = cleanMarkdownText(event[2]);
    const label = currentSection ? `${when}\n${currentSection}: ${what}` : `${when}\n${what}`;
    const id = uniqueNodeId(`${when} ${what}`, usedIds);
    nodes.set(id, { id, label, shape: "rounded", sourceLine: record.originalLine });
    if (previous) edges.push(edgeDraft(previous, id, record.originalLine));
    previous = id;
  }

  if (!headerSeen) diagnostics.push(error(1, 1, "Missing Mermaid timeline header."));
  if (nodes.size === 0) diagnostics.push(error(records[0]?.originalLine ?? 1, 1, "Timeline must include at least one event."));
  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) return { ok: false, diagnostics, cleanSource: "" };

  return finalizeGraph({ kind: "timeline", title, style, direction: "LR", nodes, edges });
}

function stripCodeFence(source: string): { text: string; lineOffset: number } {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  const match = /^```(?:mermaid)?[ \t]*\n([\s\S]*?)\n```$/i.exec(normalized);
  if (!match) return { text: normalized, lineOffset: 0 };
  return { text: match[1], lineOffset: 1 };
}

function stripAnyCodeFence(source: string): { text: string; lineOffset: number } {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  const match = /^```[A-Za-z0-9_-]*[ \t]*\n([\s\S]*?)\n```$/i.exec(normalized);
  if (!match) return { text: normalized, lineOffset: 0 };
  return { text: match[1], lineOffset: 1 };
}

function sourceRecords(source: string, options: ParserOptions): {
  records: LineRecord[];
  style: DiagramStyleOptions;
  frontmatter: ReturnType<typeof readFrontmatter>;
} {
  const stripped = stripAnyCodeFence(source);
  const frontmatter = readFrontmatter(stripped.text);
  return {
    records: toLineRecords(frontmatter.body, stripped.lineOffset + frontmatter.lineOffset),
    style: mergeStyle(frontmatter, options),
    frontmatter,
  };
}

function finalizeGraph(input: {
  kind: NonNullable<MermaidGraph["kind"]>;
  title?: string;
  style: DiagramStyleOptions;
  direction: MermaidDirection;
  nodes: Map<string, NodeDraft>;
  edges: Array<Omit<GraphEdge, "id">>;
}): ParseResult {
  const graphNodes = [...input.nodes.values()].map((node) => ({
    id: node.id,
    label: node.label,
    shape: node.shape,
    sourceLine: node.sourceLine ?? 1,
  }));
  const graphEdges = input.edges.map((edge, index) => ({ ...edge, id: `edge-${index + 1}` }));
  const cleanSource = formatGraph({ title: input.title, direction: input.direction, nodes: graphNodes, edges: graphEdges });
  return {
    ok: true,
    diagnostics: [],
    diagram: {
      schemaVersion: SCHEMA_VERSION,
      kind: input.kind,
      title: input.title,
      style: input.style,
      direction: input.direction,
      nodes: graphNodes,
      edges: graphEdges,
      cleanSource,
    },
  };
}

function stateEndpointId(raw: string, index: number, label: "Start" | "End"): string {
  return raw === "[*]" ? `${label}${index + 1}` : raw;
}

function stateNode(id: string, raw: string, aliases: Map<string, string>, sourceLine: number): NodeDraft {
  if (raw === "[*]") return { id, label: id.startsWith("Start") ? "Start" : "End", shape: "terminal", sourceLine };
  return { id, label: aliases.get(raw) ?? raw, shape: "rounded", sourceLine };
}

function readFrontmatter(source: string): { title?: string; theme?: ThemeName; density?: DensityName; fontSize?: number; colorLayers?: number; layoutPreset?: DiagramStyleOptions["layoutPreset"]; routingMode?: DiagramStyleOptions["routingMode"]; semanticMode?: DiagramStyleOptions["semanticMode"]; manualLayout?: DiagramStyleOptions["manualLayout"]; journeyView?: DiagramStyleOptions["journeyView"]; body: string; lineOffset: number } {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match) return { body: source, lineOffset: 0 };

  const frontmatter = match[1];
  const title = /^title:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  const theme = normalizeTheme(/^theme:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const density = normalizeDensity(/^density:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const fontSize = normalizeFontSize(/^fontSize:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const colorLayers = normalizeColorLayers(/^colorLayers:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const layoutPreset = normalizeLayoutPreset(/^layoutPreset:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const routingMode = normalizeRoutingMode(/^routingMode:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const semanticMode = normalizeSemanticMode(/^semanticMode:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const manualLayout = normalizeManualLayout(/^manualLayout:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const journeyView = normalizeJourneyView(/^journeyView:\s*(.+)$/im.exec(frontmatter)?.[1]?.trim()) ?? undefined;
  const lineOffset = match[0].split("\n").length - 1;
  return { title, theme, density, fontSize, colorLayers, layoutPreset, routingMode, semanticMode, manualLayout, journeyView, body: source.slice(match[0].length), lineOffset };
}

function toLineRecords(text: string, lineOffset: number): LineRecord[] {
  return text.split("\n").map((line, index) => ({ text: line, originalLine: index + 1 + lineOffset }));
}

function mergeStyle(frontmatter: { theme?: ThemeName; density?: DensityName; fontSize?: number; colorLayers?: number; layoutPreset?: DiagramStyleOptions["layoutPreset"]; routingMode?: DiagramStyleOptions["routingMode"]; semanticMode?: DiagramStyleOptions["semanticMode"]; manualLayout?: DiagramStyleOptions["manualLayout"]; journeyView?: DiagramStyleOptions["journeyView"] }, options: ParserOptions): DiagramStyleOptions {
  return {
    theme: normalizeTheme(options.theme) ?? frontmatter.theme ?? defaultStyle.theme,
    density: normalizeDensity(options.density) ?? frontmatter.density ?? defaultStyle.density,
    fontSize: normalizeFontSize(options.fontSize) ?? frontmatter.fontSize ?? defaultStyle.fontSize,
    colorLayers: normalizeColorLayers(options.colorLayers) ?? frontmatter.colorLayers ?? defaultStyle.colorLayers,
    layoutPreset: normalizeLayoutPreset(options.layoutPreset) ?? frontmatter.layoutPreset ?? defaultStyle.layoutPreset,
    routingMode: normalizeRoutingMode(options.routingMode) ?? frontmatter.routingMode ?? defaultStyle.routingMode,
    semanticMode: normalizeSemanticMode(options.semanticMode) ?? frontmatter.semanticMode ?? defaultStyle.semanticMode,
    semanticRules: normalizeSemanticRules(options.semanticRules),
    manualLayout: normalizeManualLayout(options.manualLayout) ?? frontmatter.manualLayout ?? defaultStyle.manualLayout,
    journeyView: normalizeJourneyView(options.journeyView) ?? frontmatter.journeyView ?? defaultStyle.journeyView,
  };
}

function parseHeader(statement: string): { keyword: "flowchart" | "graph"; direction: MermaidDirection } | null {
  const match = /^(flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*;?$/i.exec(statement);
  if (!match) return null;
  const direction = match[2].toUpperCase() as MermaidDirection;
  return supportedDirections.has(direction) ? { keyword: match[1].toLowerCase() as "flowchart" | "graph", direction } : null;
}

function detectMermaidType(source: string): string | null {
  const stripped = stripAnyCodeFence(source);
  const frontmatter = readFrontmatter(stripped.text);
  const first = frontmatter.body.split("\n").find((line) => line.trim() && !line.trim().startsWith("%%"))?.trim() ?? "";
  const match = /^(flowchart|graph|journey|sequenceDiagram|stateDiagram-v2|stateDiagram|mindmap|timeline|classDiagram|erDiagram|gantt|pie|gitGraph|quadrantChart|requirementDiagram|c4Context|c4Container|c4Component|c4Dynamic|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|radar-beta|treemap-beta|kanban)\b/i.exec(first);
  if (!match) return null;
  const raw = match[1];
  if (/^sequencediagram$/i.test(raw)) return "sequenceDiagram";
  if (/^statediagram-v2$/i.test(raw)) return "stateDiagram-v2";
  if (/^statediagram$/i.test(raw)) return "stateDiagram";
  return raw.toLowerCase();
}

function unsupportedMermaidResult(source: string, type: string): ParseResult {
  const stripped = stripAnyCodeFence(source);
  const frontmatter = readFrontmatter(stripped.text);
  const line = toLineRecords(frontmatter.body, stripped.lineOffset + frontmatter.lineOffset).find((record) => record.text.trim())?.originalLine ?? 1;
  return {
    ok: false,
    cleanSource: stripped.text.trim(),
    diagnostics: [error(line, 1, `Mermaid \`${type}\` is recognized but is not safely convertible to editable FigJam nodes yet. Supported: flowchart/graph, journey, sequenceDiagram, stateDiagram-v2, mindmap, timeline, and Markdown journeys.`)],
  };
}

function parseJourneyTask(line: string): { label: string; score: number; actor?: string } | null {
  const parts = line.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const scoreIndex = parts.findIndex((part, index) => index > 0 && /^[1-5]$/.test(part));
  if (scoreIndex < 1) return null;
  const label = cleanMarkdownText(parts.slice(0, scoreIndex).join(":"));
  if (!label) return null;
  return {
    label,
    score: Number.parseInt(parts[scoreIndex], 10),
    actor: parts.slice(scoreIndex + 1).map(cleanMarkdownText).filter(Boolean).join(", ") || undefined,
  };
}

function createImplicitJourneySection(
  nodes: Map<string, NodeDraft>,
  sections: JourneySection[],
  usedIds: Set<string>,
  sourceLine: number,
): JourneySection {
  const title = "Journey";
  const id = upsertMarkdownNode(nodes, usedIds, title, sourceLine, "rounded");
  const section: JourneySection = { id, title, sourceLine, steps: [] };
  sections.push(section);
  return section;
}

function markdownJourneyStep(id: string, item: string, sourceLine: number): JourneyStep {
  const task = parseJourneyTask(item);
  if (task) return { id, label: task.label, score: task.score, actor: task.actor, sourceLine };
  return { id, label: item, score: scoreForMarkdownLabel(item), sourceLine };
}

function firstJourneyActor(sections: JourneySection[]): string | undefined {
  return sections.flatMap((section) => section.steps).find((step) => step.actor)?.actor;
}

function isMarkdownNote(line: string): boolean {
  return /^(primary success|main frustration|success|frustration|goal|note|insight|risk|constraint)\s*:/i.test(line);
}

function scoreForMarkdownLabel(label: string): number | undefined {
  if (/\b(error|fail|friction|blocked|denied|frustration|confusing|problem)\b/i.test(label)) return 2;
  if (/\b(success|complete|ready|finds|understands|goal|done)\b/i.test(label)) return 5;
  return undefined;
}

function parseMarkdownItem(line: string): string | null {
  const task = /^\s*-\s+\[[ xX]\]\s+(.+)$/.exec(line);
  const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
  const paragraph = /^[A-Za-z][^<>[\]{}]*:\s+.+$/.test(line) ? line : null;
  const value = task?.[1] ?? bullet?.[1] ?? paragraph;
  return value ? cleanMarkdownText(value) : null;
}

function parseMarkdownArrow(text: string): { from: string; to: string; label?: string } | null {
  const match = /^(.+?)\s*(?:-->|->|=>|→|➜|➡)\s*(.+?)(?:\s*(?:[:|])\s*(.+))?$/.exec(text);
  if (!match) return null;
  return {
    from: cleanMarkdownText(match[1]),
    to: cleanMarkdownText(match[2]),
    label: match[3] ? cleanMarkdownText(match[3]) : undefined,
  };
}

function parseMarkdownTableStep(line: string): string | null {
  if (!line.startsWith("|") || !line.endsWith("|")) return null;
  const cells = line.split("|").slice(1, -1).map((cell) => cleanMarkdownText(cell.trim())).filter(Boolean);
  if (cells.length < 2 || cells.some((cell) => /^-+$/.test(cell))) return null;
  const lower = cells.map((cell) => cell.toLowerCase());
  if (lower.some((cell) => /phase|stage|step|action|emotion|note/.test(cell))) return null;
  return cells.join(" - ");
}

function isMarkdownTableDivider(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function cleanMarkdownText(text: string): string {
  return text
    .replace(/^\s*#+\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function upsertMarkdownNode(nodes: Map<string, NodeDraft>, usedIds: Set<string>, label: string, sourceLine: number, shape?: GraphNodeShape): string {
  const existing = [...nodes.values()].find((node) => node.label.toLowerCase() === label.toLowerCase());
  if (existing) return existing.id;
  const id = uniqueNodeId(label, usedIds);
  nodes.set(id, { id, label, shape: shape ?? shapeForMarkdownLabel(label), sourceLine });
  return id;
}

function uniqueNodeId(label: string, usedIds: Set<string>): string {
  const base = sanitizeId(label) || "Step";
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function sanitizeId(label: string): string {
  const words = label.match(/[A-Za-z0-9]+/g) ?? [];
  const joined = words.slice(0, 5).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^[A-Za-z]/.test(joined) ? joined : `Step${joined}`;
}

function shapeForMarkdownLabel(label: string): GraphNodeShape {
  if (/\b(start|entry|open|begin|first)\b/i.test(label)) return "terminal";
  if (/\b(decide|decision|choice|if|whether|ready\?)\b/i.test(label)) return "decision";
  if (/\b(success|complete|done|ready|goal|outcome|primary success)\b/i.test(label)) return "terminal";
  return "rounded";
}

function edgeDraft(from: string, to: string, sourceLine: number, label?: string): Omit<GraphEdge, "id"> {
  return { from, to, label, style: "solid", sourceLine };
}

function parseStatement(statement: string, line: number, diagnostics: Diagnostic[]): ParsedStatement | null {
  const edge = parseEdgeStatement(statement, line, diagnostics);
  if (edge) return edge;
  if (findEdgeOperator(statement)) return null;

  const node = parseNodeRef(statement, line, 1, diagnostics);
  if (!node || statement.slice(node.consumed).trim()) {
    diagnostics.push(error(line, 1, "Expected a node declaration or an edge like `A --> B`."));
    return null;
  }

  return {
    nodes: [{ id: node.id, label: node.label, shape: node.shape, sourceLine: line }],
  };
}

function parseEdgeStatement(statement: string, line: number, diagnostics: Diagnostic[]): ParsedStatement | null {
  const operators = findEdgeOperators(statement);
  if (operators.length === 0) return null;

  const segments = getEdgeSegments(statement, operators);
  if (segments.some((segment) => !segment.text)) {
    const firstEmpty = segments.find((segment) => !segment.text);
    diagnostics.push(error(line, firstEmpty?.column ?? operators[0].start + 1, "Edge must include both source and target nodes."));
    return null;
  }

  const parsedNodes: NodeDraft[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const diagnosticCount = diagnostics.length;
    const parsed = parseEndpointRef(segment.text, line, segment.column, diagnostics);
    if (!parsed || segment.text.slice(parsed.consumed).trim()) {
      if (diagnostics.length === diagnosticCount) {
        diagnostics.push(error(line, segment.column, index === 0 ? "Invalid source node in edge." : "Invalid target node in edge."));
      }
      return null;
    }
    parsedNodes.push({ id: parsed.id, label: parsed.label, shape: parsed.shape, sourceLine: line });
  }

  return {
    nodes: parsedNodes,
    edges: operators.map((operator, index) => ({
      from: parsedNodes[index].id,
      to: parsedNodes[index + 1].id,
      label: operator.label,
      style: operator.style,
      sourceLine: line,
    })),
  };
}

function getEdgeSegments(statement: string, operators: EdgeOperator[]): Array<{ text: string; column: number }> {
  const segments: Array<{ text: string; column: number }> = [];
  for (let index = 0; index <= operators.length; index += 1) {
    const start = index === 0 ? 0 : operators[index - 1].end;
    const end = index === operators.length ? statement.length : operators[index].start;
    const raw = statement.slice(start, end);
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    segments.push({ text: raw.trim(), column: start + leading + 1 });
  }
  return segments;
}

function parseEndpointRef(input: string, line: number, column: number, diagnostics: Diagnostic[]): NodeParseResult | null {
  const startCount = diagnostics.length;
  const parsed = parseNodeRef(input, line, column, diagnostics);
  if (parsed && !input.slice(parsed.consumed).trim()) return parsed;

  diagnostics.splice(startCount);
  const loose = parseLooseEndpointRef(input);
  if (loose) return loose;
  parseNodeRef(input, line, column, diagnostics);
  return null;
}

function parseLooseEndpointRef(input: string): NodeParseResult | null {
  const label = cleanMarkdownText(input);
  if (!label || /(-->|-.->|==>|\||[()[\]{}<>])/.test(label)) return null;
  const id = sanitizeId(label);
  if (!id) return null;
  return { id, label, shape: shapeForMarkdownLabel(label), consumed: input.length };
}

function findEdgeOperator(statement: string): EdgeOperator | null {
  return findEdgeOperators(statement)[0] ?? null;
}

function findEdgeOperators(statement: string): EdgeOperator[] {
  const patterns: Array<{ regex: RegExp; style: GraphEdgeStyle; labelIndex?: number }> = [
    { regex: /\s*-->\|([^|]+)\|\s*/g, style: "solid", labelIndex: 1 },
    { regex: /\s*--\s+(.+?)\s+-->\s*/g, style: "solid", labelIndex: 1 },
    { regex: /\s*-.->\s*/g, style: "dotted" },
    { regex: /\s*==>\s*/g, style: "thick" },
    { regex: /\s*-->\s*/g, style: "solid" },
  ];

  const matches = patterns.flatMap((entry) => {
    const entries: EdgeOperator[] = [];
    entry.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = entry.regex.exec(statement))) {
      entries.push({
      start: match.index,
      end: match.index + match[0].length,
      label: entry.labelIndex ? unquoteLabel(match[entry.labelIndex].trim()) : undefined,
      style: entry.style,
      });
      if (match[0].length === 0) entry.regex.lastIndex += 1;
    }
    return entries;
  });

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const selected: EdgeOperator[] = [];
  for (const match of matches) {
    const overlaps = selected.some((existing) => match.start < existing.end && existing.start < match.end);
    if (!overlaps) selected.push(match);
  }
  selected.sort((a, b) => a.start - b.start);
  return selected;
}

function parseNodeRef(input: string, line: number, column: number, diagnostics: Diagnostic[]): NodeParseResult | null {
  const trimmedStart = input.match(/^\s*/)?.[0].length ?? 0;
  const text = input.slice(trimmedStart);
  const idMatch = /^([A-Za-z0-9_][A-Za-z0-9_.:/-]*)/.exec(text);
  if (!idMatch) {
    diagnostics.push(error(line, column + trimmedStart, "Node id must start with a letter, number, or `_` and contain only letters, numbers, `_`, `-`, `.`, `:`, or `/`."));
    return null;
  }

  const id = idMatch[1];
  const afterId = text.slice(id.length);
  const leadingShapeSpace = afterId.match(/^\s*/)?.[0].length ?? 0;
  const shapeText = afterId.slice(leadingShapeSpace);
  const shape = parseShape(shapeText);
  if (!shape) {
    return {
      id,
      label: id,
      shape: "rectangle",
      consumed: trimmedStart + id.length,
    };
  }

  if ("error" in shape) {
    diagnostics.push(error(line, column + trimmedStart + id.length + leadingShapeSpace, shape.error ?? "Invalid node label."));
    return null;
  }

  return {
    id,
    label: shape.label || id,
    shape: shape.shape,
    consumed: trimmedStart + id.length + leadingShapeSpace + shape.consumed,
  };
}

function parseShape(text: string): { shape: GraphNodeShape; label: string; consumed: number; error?: never } | { error: string } | null {
  if (!text) return null;

  if (text.startsWith("((")) return readDelimited(text, "((", "))", "terminal");
  if (text.startsWith("[")) return readDelimited(text, "[", "]", "rectangle");
  if (text.startsWith("(")) return readDelimited(text, "(", ")", "rounded");
  if (text.startsWith("{")) return readDelimited(text, "{", "}", "decision");
  if (text.startsWith(">")) return readDelimited(text, ">", "]", "flag");
  return null;
}

function readDelimited(text: string, open: string, close: string, shape: GraphNodeShape): { shape: GraphNodeShape; label: string; consumed: number; error?: never } | { error: string } {
  const end = findClosingDelimiter(text, open.length, close);
  if (end < 0) return { error: `Unterminated ${shape} label; expected '${close}'.` };
  const raw = text.slice(open.length, end);
  if (/<[^>]+>/.test(raw)) return { error: "HTML labels are not supported in v1." };
  return {
    shape,
    label: unquoteLabel(raw.trim()),
    consumed: end + close.length,
  };
}

function findClosingDelimiter(text: string, start: number, close: string): number {
  let quote: string | null = null;
  for (let index = start; index <= text.length - close.length; index += 1) {
    const char = text[index];
    if ((char === '"' || char === "'") && text[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (!quote && text.slice(index, index + close.length) === close) return index;
  }
  return -1;
}

function unquoteLabel(label: string): string {
  const trimmed = label.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
    return trimmed.slice(1, -1).replace(/\\(["'])/g, "$1");
  }
  return trimmed;
}

function upsertNode(nodes: Map<string, NodeDraft>, incoming: NodeDraft, sourceLine: number): void {
  const existing = nodes.get(incoming.id);
  if (!existing) {
    nodes.set(incoming.id, { ...incoming, sourceLine });
    return;
  }

  const incomingHasExplicitLabel = incoming.label !== incoming.id || incoming.shape !== "rectangle";
  const existingIsImplicit = existing.label === existing.id && existing.shape === "rectangle";
  if (incomingHasExplicitLabel || existingIsImplicit) {
    nodes.set(incoming.id, { ...existing, ...incoming, sourceLine: existing.sourceLine ?? sourceLine });
  }
}

function normalizeStatement(parsed: ParsedStatement): string {
  if (!parsed.edges?.length) return formatNode(parsed.nodes[0]);
  return parsed.edges.map((edge) => {
    const from = parsed.nodes.find((node) => node.id === edge.from);
    const to = parsed.nodes.find((node) => node.id === edge.to);
    const operator = formatOperator(edge);
    return `${formatNode(from!)} ${operator} ${formatNode(to!)}`;
  }).join("\n");
}

function formatOperator(edge: Omit<GraphEdge, "id">): string {
  if (edge.label) return `-->|${edge.label}|`;
  if (edge.style === "dotted") return "-.->";
  if (edge.style === "thick") return "==>";
  return "-->";
}

function formatNode(node: NodeDraft): string {
  const label = node.label === node.id ? node.id : JSON.stringify(node.label);
  switch (node.shape) {
    case "rounded": return `${node.id}(${label})`;
    case "decision": return `${node.id}{${label}}`;
    case "terminal": return `${node.id}((${label}))`;
    case "flag": return `${node.id}>${label}]`;
    case "rectangle":
    default: return node.label === node.id ? node.id : `${node.id}[${label}]`;
  }
}

function formatGraph(graph: {
  title?: string;
  direction: MermaidDirection;
  nodes: GraphNode[];
  edges: GraphEdge[];
}): string {
  const lines: string[] = [];
  if (graph.title) {
    lines.push("---", `title: ${JSON.stringify(graph.title)}`, "---");
  }
  lines.push(`flowchart ${graph.direction}`);
  for (const node of graph.nodes) {
    lines.push(`  ${formatNode(node)}`);
  }
  if (graph.nodes.length > 0 && graph.edges.length > 0) lines.push("");
  for (const edge of graph.edges) {
    lines.push(`  ${edge.from} ${formatOperator(edge)} ${edge.to}`);
  }
  return lines.join("\n");
}

function formatJourney(journey: JourneyMap): string {
  const lines = ["journey"];
  if (journey.title) lines.push(`  title ${journey.title}`);
  for (const section of journey.sections) {
    lines.push(`  section ${section.title}`);
    for (const step of section.steps) {
      const score = typeof step.score === "number" ? step.score : 3;
      const actor = step.actor || journey.actor || "User";
      lines.push(`    ${step.label}: ${score}: ${actor}`);
    }
  }
  for (const note of journey.notes) lines.push(`  %% ${note}`);
  return lines.join("\n");
}

function error(line: number, column: number, message: string): Diagnostic {
  return { level: "error", line, column, message };
}

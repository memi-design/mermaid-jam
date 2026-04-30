import { computeGraphLayout, type GraphLayoutNode } from "../../shared/layout";
import { getStyleTokens, hexToRgb, type Palette, type StyleTokens } from "../../shared/styles";
import type {
  GeneratePayload,
  GraphEdge,
  GraphNode,
  GraphNodeShape,
  JourneyMap,
  JourneySection,
  JourneyStep,
  MermaidGraph,
  PluginMetadata,
  RoutingMode,
  SemanticCategory,
  SemanticRule,
} from "../../shared/types";

const ROOT_KEY = "mermaidjam.root";
const GROUP_KEY = "mermaidjam.group";
const METADATA_KEY = "mermaidjam.metadata";
const SOURCE_KEY = "mermaidjam.source";
const NODE_ID_KEY = "mermaidjam.nodeId";
const NODE_KIND_KEY = "mermaidjam.nodeKind";
const SOURCE_LINE_KEY = "mermaidjam.sourceLine";
const legacyPrefix = String.fromCharCode(117, 110, 105, 99, 111, 114, 110, 106, 97, 109);
const LEGACY_ROOT_KEY = `${legacyPrefix}.root`;
const LEGACY_GROUP_KEY = `${legacyPrefix}.group`;
const LEGACY_METADATA_KEY = `${legacyPrefix}.metadata`;
const LEGACY_SOURCE_KEY = `${legacyPrefix}.source`;
const LEGACY_NODE_ID_KEY = `${legacyPrefix}.nodeId`;
const SAFE_SOURCE_LIMIT = 80_000;
const regularFont: FontName = { family: "Inter", style: "Regular" };

type GeneratedNode = SectionNode | ShapeWithTextNode | ConnectorNode;
type PreservedPosition = { x: number; y: number; width: number; height: number };
type PreservedPositions = Map<string, PreservedPosition>;
type GeneratedSet = {
  groupId: string;
  root: SectionNode;
  allNodes: GeneratedNode[];
};

type JourneyLayout = {
  width: number;
  height: number;
  padding: number;
  titleY: number;
  metaY: number;
  phaseY: number;
  stepY: number;
  timelineY: number;
  chartTop: number;
  chartBottom: number;
  taskHeight: number;
  phaseHeight: number;
  phaseLayouts: Array<{ section: JourneySection; x: number; y: number; width: number; height: number; average?: number }>;
  stepLayouts: Array<{ step: JourneyStep; section: JourneySection; x: number; y: number; width: number; height: number; scoreX: number; scoreY: number; score: number }>;
  notesY: number;
};

type SemanticMatch = { category: SemanticCategory; rule?: SemanticRule; priority: number; order: number };

const categoryPriority: Record<SemanticCategory, number> = {
  error: 10,
  warning: 20,
  success: 30,
  backend: 40,
  auth: 50,
  payment: 60,
  data: 70,
  external: 80,
  screen: 90,
  user: 100,
  decision: 110,
  note: 120,
};

const defaultSemanticRules: Array<SemanticRule & { category: SemanticCategory }> = [
  { category: "error", keywords: ["error", "fail", "failed", "failure", "blocked", "denied", "invalid", "incomplete", "friction", "problem", "crash", "old"] },
  { category: "warning", keywords: ["warn", "warning", "retry", "again", "forgot", "reset", "pending", "review", "maybe", "unknown"] },
  { category: "success", keywords: ["success", "done", "complete", "completed", "ready", "accepted", "approved", "home", "dashboard", "main app", "goal"] },
  { category: "backend", keywords: ["backend", "server", "api", "service", "system", "session", "database", "queue", "worker"] },
  { category: "auth", keywords: ["auth", "login", "log in", "sign in", "sign up", "signed", "password", "account", "session", "verification", "privacy", "terms"] },
  { category: "payment", keywords: ["pay", "payment", "checkout", "cart", "subscription", "billing", "invoice", "purchase", "revenue"] },
  { category: "data", keywords: ["data", "store", "storage", "cache", "sync", "fetch", "load", "loading", "save", "persist"] },
  { category: "external", keywords: ["google", "apple", "stripe", "webhook", "email", "sms", "external", "third party"] },
  { category: "screen", keywords: ["screen", "page", "view", "tab", "drawer", "modal", "profile", "games", "swipe", "chat"] },
  { category: "user", keywords: ["user", "guest", "tap", "click", "opens", "chooses", "enters", "types", "scans", "browses"] },
  { category: "decision", keywords: ["decision", "choice", "if", "whether", "gate", "check", "checks", "condition"] },
  { category: "note", keywords: ["note", "insight", "constraint", "risk", "frustration", "success:"] },
];

export async function loadRendererFonts(): Promise<void> {
  await figma.loadFontAsync(regularFont);
}

export async function renderNewDocument(payload: GeneratePayload): Promise<SectionNode> {
  assertFigJam();
  await loadRendererFonts();
  const tokens = getStyleTokens(payload.diagram.style);
  const layout = computeInitialLayout(payload.diagram, tokens);
  const center = figma.viewport.center;
  const origin = {
    x: center.x - layout.width / 2,
    y: center.y - Math.min(layout.height / 2, 220),
  };
  const generated = renderDiagramAt(payload, origin, new Map());
  figma.currentPage.selection = [generated.root];
  figma.viewport.scrollAndZoomIntoView([generated.root]);
  return generated.root;
}

export async function updateSelectedDocument(payload: GeneratePayload): Promise<SectionNode> {
  assertFigJam();
  const root = findSelectedMermaidJamRoot();
  if (!root) throw new Error("Select a Mermaid Jam section or one of its diagram nodes before updating.");
  await loadRendererFonts();
  const groupId = getPluginDataAny(root, GROUP_KEY, LEGACY_GROUP_KEY);
  const preserved = payload.diagram.style.manualLayout === "reset" ? new Map<string, PreservedPosition>() : captureManualPositions(groupId);
  const origin = { x: root.x, y: root.y };
  removeGeneratedGroup(groupId);
  const generated = renderDiagramAt(payload, origin, preserved);
  figma.currentPage.selection = [generated.root];
  figma.viewport.scrollAndZoomIntoView([generated.root]);
  return generated.root;
}

export function readSelectedSource(): { source: string; metadata: PluginMetadata } {
  assertFigJam();
  const root = findSelectedMermaidJamRoot();
  if (!root) throw new Error("Select a Mermaid Jam section or one of its diagram nodes with stored source.");
  const rawMetadata = getPluginDataAny(root, METADATA_KEY, LEGACY_METADATA_KEY);
  if (!rawMetadata) throw new Error("Selected Mermaid Jam diagram is missing metadata.");
  const metadata = JSON.parse(rawMetadata) as PluginMetadata;
  const source = getPluginDataAny(root, SOURCE_KEY, LEGACY_SOURCE_KEY);
  if (!source) throw new Error("This diagram only stored a source hash. Paste the Mermaid source to update it.");
  return { source, metadata };
}

function renderDiagramAt(payload: GeneratePayload, origin: { x: number; y: number }, preserved: PreservedPositions): GeneratedSet {
  if (payload.diagram.journey) return renderJourneyAt(payload, origin, preserved);

  const tokens = getStyleTokens(payload.diagram.style);
  const layout = computeRenderLayout(payload.diagram, tokens);
  const nodeLayouts = layout.nodes.map((nodeLayout) => applyPreservedNodePosition(nodeLayout, preserved.get(graphNodeKey(nodeLayout.id))));
  const groupId = createGroupId();
  const section = createRootSection(payload.diagram, tokens, layout.width, layout.height, origin);
  const children: Array<ShapeWithTextNode | ConnectorNode> = [];
  const shapeById = new Map<string, ShapeWithTextNode>();
  const layoutById = new Map(nodeLayouts.map((nodeLayout) => [nodeLayout.id, nodeLayout]));
  const outgoingIds = new Set(payload.diagram.edges.map((edge) => edge.from));
  const nodeById = new Map(payload.diagram.nodes.map((node) => [node.id, node]));

  for (const nodeLayout of nodeLayouts) {
    const graphNode = nodeById.get(nodeLayout.id);
    if (!graphNode) continue;
    const shape = createGraphNode(graphNode, payload.diagram.edges, tokens, nodeLayout.width, nodeLayout.height, {
      isSink: !outgoingIds.has(graphNode.id),
      depth: nodeLayout.rank,
    });
    section.appendChild(shape);
    shape.x = nodeLayout.x;
    shape.y = nodeLayout.y;
    tagGeneratedNode(shape, "graph-node", graphNodeKey(graphNode.id), graphNode.sourceLine);
    shapeById.set(graphNode.id, shape);
    children.push(shape);
  }

  for (const edge of payload.diagram.edges) {
    const from = shapeById.get(edge.from);
    const to = shapeById.get(edge.to);
    const fromLayout = layoutById.get(edge.from);
    const toLayout = layoutById.get(edge.to);
    if (!from || !to) continue;
    const connector = figma.createConnector();
    section.appendChild(connector);
    connector.name = `Edge/${edge.from}->${edge.to}`;
    connector.connectorLineType = connectorLineType(tokens.routingMode);
    const magnets = connectorMagnets(fromLayout, toLayout, payload.diagram.direction, tokens.routingMode);
    connector.connectorStart = { endpointNodeId: from.id, magnet: magnets.start };
    connector.connectorEnd = { endpointNodeId: to.id, magnet: magnets.end };
    connector.connectorStartStrokeCap = "NONE";
    connector.connectorEndStrokeCap = "ARROW_LINES";
    connector.strokes = solid(tokens.colors.connector);
    connector.strokeWeight = connectorStrokeWeight(tokens, edge.style);
    connector.dashPattern = edge.style === "dotted" ? [5, 4] : [];
    if (edge.label) setText(connector.text, edge.label, tokens.type.small, tokens.colors.muted);
    connector.textBackground.fills = solid(tokens.colors.surface);
    tagGeneratedNode(connector, "edge", `edge:${edge.id}`, edge.sourceLine);
    children.push(connector);
  }

  if (children.length === 0) throw new Error("Nothing was generated from this source.");
  containSection(section, children, Math.max(24, Math.round(tokens.graph.padding / 2)));
  const allNodes: GeneratedNode[] = [section, ...children];
  writeMetadata(allNodes, section, payload, groupId);
  return { groupId, root: section, allNodes };
}

function renderJourneyAt(payload: GeneratePayload, origin: { x: number; y: number }, preserved: PreservedPositions): GeneratedSet {
  const tokens = getStyleTokens(payload.diagram.style);
  const journey = payload.diagram.journey!;
  const layout = computeJourneyLayout(journey, tokens);
  applyPreservedJourneyPositions(layout, preserved);
  const groupId = createGroupId();
  const section = createRootSection(payload.diagram, tokens, layout.width, layout.height, origin, "#FFFFFF");
  const children: Array<ShapeWithTextNode | ConnectorNode> = [];
  const colors = journeyColors();
  const title = journey.title ?? payload.diagram.title ?? "";
  const actor = journey.actor ?? "User";
  const scores = layout.stepLayouts.map((item) => item.score);
  const average = averageScore(scores);
  const low = scores.length > 0 ? Math.min(...scores) : undefined;
  const lowStep = [...layout.stepLayouts].sort((a, b) => a.score - b.score)[0];
  const bottlenecks = layout.stepLayouts.filter((item) => item.score <= 2);
  const showScores = tokens.journeyView === "scores" || tokens.journeyView === "insights";
  const showInsights = tokens.journeyView === "insights";

  createJourneyShape(section, children, {
    name: "Journey/Panel",
    text: "",
    x: layout.padding / 2,
    y: layout.padding / 2,
    width: layout.width - layout.padding,
    height: layout.height - layout.padding,
    fill: colors.panel,
    stroke: colors.panelBorder,
    fontSize: tokens.type.body,
  });

  if (title) {
    createJourneyShape(section, children, {
      name: "Journey/Title",
      text: title,
      x: layout.padding,
      y: layout.titleY,
      width: showInsights ? Math.max(680, layout.width - layout.padding * 2 - 580) : layout.width - layout.padding * 2,
      height: Math.max(72, tokens.type.title * 2.1),
      fill: "transparent",
      stroke: "transparent",
      color: colors.text,
      fontSize: Math.max(30, tokens.type.title),
    });
  }

  if (showInsights) {
    const statY = layout.titleY + 10;
    const statWidth = Math.max(142, Math.round(tokens.type.body * 6.4));
    const statGap = 8;
    const statStartX = Math.max(layout.padding, layout.width - layout.padding - statWidth * 4 - statGap * 3);
    [
      `Steps ${layout.stepLayouts.length}`,
      average === undefined ? "Avg n/a" : `Avg ${formatAverage(average)}/5`,
      lowStep ? `Lowest ${lowStep.score}/5` : "Lowest n/a",
      `Blocks ${bottlenecks.length}`,
    ].forEach((label, index) => {
      createJourneyShape(section, children, {
        name: `Journey/Metric/${index + 1}`,
        text: label,
        x: statStartX + index * (statWidth + statGap),
        y: statY,
        width: statWidth,
        height: Math.max(42, tokens.type.body * 1.6),
        fill: colors.metric,
        stroke: colors.metricBorder,
        color: colors.muted,
        fontSize: Math.max(24, tokens.type.small),
      });
    });
  }

  createJourneyShape(section, children, {
    name: "Journey/ActorDot",
    text: "",
    x: layout.padding,
    y: layout.metaY + 10,
    width: 16,
    height: 16,
    fill: colors.good,
    stroke: colors.good,
    shapeType: "ELLIPSE",
    fontSize: tokens.type.small,
  });
  createJourneyShape(section, children, {
    name: "Journey/Actor",
    text: actor,
    x: layout.padding + 34,
    y: layout.metaY,
    width: 220,
    height: 42,
    fill: "transparent",
    stroke: "transparent",
    color: colors.text,
    fontSize: Math.max(24, tokens.type.small),
  });

  for (const phase of layout.phaseLayouts) {
    const palette = showScores ? journeyPhasePalette(phase.average, colors) : { fill: colors.phase, border: colors.phaseBorder, text: colors.text };
    createJourneyShape(section, children, {
      name: `Journey/Section/${phase.section.id}`,
      text: phase.section.title,
      x: phase.x,
      y: phase.y,
      width: phase.width,
      height: phase.height,
      fill: palette.fill,
      stroke: palette.border,
      color: palette.text,
      fontSize: Math.max(24, tokens.type.small),
      sourceId: journeySectionKey(phase.section.id),
      sourceLine: phase.section.sourceLine,
      kind: "journey-section",
    });
    if (showScores && typeof phase.average === "number") {
      createJourneyShape(section, children, {
        name: `Journey/SectionAverage/${phase.section.id}`,
        text: `${formatAverage(phase.average)}/5`,
        x: phase.x + phase.width - Math.max(104, tokens.type.body * 4.2),
        y: phase.y + 6,
        width: Math.max(92, tokens.type.body * 3.8),
        height: Math.max(34, tokens.type.body * 1.35),
        fill: colors.metric,
        stroke: colors.metricBorder,
        color: colors.muted,
        fontSize: Math.max(24, tokens.type.small),
      });
    }
  }

  for (const item of layout.stepLayouts) {
    const lowlight = showScores && item.score <= 2;
    const palette = lowlight ? scorePalette(item.score, colors) : { fill: colors.card, border: colors.cardBorder, text: colors.text };
    createJourneyShape(section, children, {
      name: `Journey/Step/${item.step.id}`,
      text: item.step.label,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      fill: palette.fill,
      stroke: palette.border,
      color: palette.text,
      fontSize: Math.max(24, tokens.type.small),
      sourceId: journeyStepKey(item.step.id),
      sourceLine: item.step.sourceLine,
      kind: "journey-step",
    });
  }

  const first = layout.stepLayouts[0];
  const last = layout.stepLayouts[layout.stepLayouts.length - 1];
  if (first && last) {
    createJourneyConnector(section, children, {
      name: "Journey/Timeline",
      start: { x: first.x - 34, y: layout.timelineY },
      end: { x: last.x + last.width + 80, y: layout.timelineY },
      color: colors.timeline,
      weight: 2,
      arrow: true,
    });
  }

  if (showScores) {
    for (let index = 1; index < layout.stepLayouts.length; index += 1) {
      const previous = layout.stepLayouts[index - 1];
      const current = layout.stepLayouts[index];
      createJourneyConnector(section, children, {
        name: `Journey/ScoreLine/${index}`,
        start: { x: previous.scoreX, y: previous.scoreY },
        end: { x: current.scoreX, y: current.scoreY },
        color: colors.scoreLine,
        weight: 2,
      });
    }
  }

  for (const item of layout.stepLayouts) {
    createJourneyConnector(section, children, {
      name: `Journey/MarkerLine/${item.step.id}`,
      start: { x: item.scoreX, y: item.y + item.height },
      end: { x: item.scoreX, y: item.scoreY - 24 },
      color: colors.markerLine,
      weight: 1,
      dash: [5, 5],
    });
    const palette = scorePalette(item.score, colors);
    createJourneyShape(section, children, {
      name: `Journey/ScorePoint/${item.step.id}`,
      text: showScores ? `${item.score}` : "",
      x: item.scoreX - 17,
      y: item.scoreY - 17,
      width: 34,
      height: 34,
      fill: showScores ? palette.fill : colors.subtleDot,
      stroke: showScores ? palette.border : colors.subtleDotBorder,
      color: palette.text,
      shapeType: "ELLIPSE",
      fontSize: 24,
    });

    if (showInsights && item.score <= 2) {
      createJourneyShape(section, children, {
        name: `Journey/Bottleneck/${item.step.id}`,
        text: "Bottleneck",
        x: item.x,
        y: item.y + item.height + 12,
        width: Math.min(item.width, Math.max(150, tokens.type.body * 6.2)),
        height: Math.max(36, tokens.type.body * 1.45),
        fill: colors.badFill,
        stroke: colors.badBorder,
        color: colors.badText,
        fontSize: Math.max(24, tokens.type.small),
      });
    }
  }

  journey.notes.forEach((note, index) => {
    createJourneyShape(section, children, {
      name: `Journey/Note/${index + 1}`,
      text: note,
      x: layout.padding,
      y: layout.notesY + index * Math.max(58, tokens.type.body * 2.2),
      width: layout.width - layout.padding * 2,
      height: Math.max(50, tokens.type.body * 1.8),
      fill: colors.note,
      stroke: colors.noteBorder,
      color: colors.text,
      fontSize: Math.max(24, tokens.type.small),
    });
  });

  if (showInsights && lowStep) {
    createJourneyShape(section, children, {
      name: "Journey/LowestCallout",
      text: `Lowest friction: ${lowStep.step.label}`,
      x: layout.padding,
      y: layout.notesY + journey.notes.length * Math.max(58, tokens.type.body * 2.2),
      width: Math.min(layout.width - layout.padding * 2, Math.max(620, tokens.type.body * 28)),
      height: Math.max(52, tokens.type.body * 1.9),
      fill: colors.badFill,
      stroke: colors.badBorder,
      color: colors.badText,
      fontSize: Math.max(24, tokens.type.small),
    });
  }

  if (children.length === 0) throw new Error("Nothing was generated from this journey.");
  containSection(section, children, Math.max(24, Math.round(tokens.graph.padding / 2)));
  const allNodes: GeneratedNode[] = [section, ...children];
  writeMetadata(allNodes, section, payload, groupId);
  return { groupId, root: section, allNodes };
}

function createRootSection(diagram: MermaidGraph, tokens: StyleTokens, width: number, height: number, origin: { x: number; y: number }, fill = tokens.colors.surface): SectionNode {
  const section = figma.createSection();
  section.name = sectionName(diagram);
  section.x = origin.x;
  section.y = origin.y;
  section.fills = solid(fill);
  section.sectionContentsHidden = false;
  section.resizeWithoutConstraints(Math.max(width, tokens.graph.nodeWidth + tokens.graph.padding * 2), Math.max(height, tokens.graph.nodeHeight + tokens.graph.padding * 2));
  return section;
}

function createGraphNode(node: GraphNode, edges: GraphEdge[], tokens: StyleTokens, width: number, height: number, options: { isSink: boolean; depth: number }): ShapeWithTextNode {
  const palette = nodePalette(node, edges, tokens, options);
  const shape = figma.createShapeWithText();
  shape.name = `Node/${node.id}`;
  shape.shapeType = figJamShapeFor(node.shape);
  shape.resize(widthForShape(width, node.shape), heightForShape(height, node.shape));
  shape.fills = solid(palette.bg);
  shape.strokes = solid(palette.border);
  shape.strokeWeight = nodeStrokeWeight(tokens);
  shape.dashPattern = [];
  setText(shape.text, node.label, tokens.type.body, palette.fg);
  return shape;
}

function setText(node: TextSublayerNode, characters: string, fontSize: number, color: string): void {
  node.fontName = regularFont;
  node.characters = characters;
  node.fontSize = fontSize;
  node.lineHeight = { unit: "PIXELS", value: Math.round(fontSize * 1.2) };
  node.fills = solid(color);
}

function connectorStrokeWeight(tokens: StyleTokens, style: "solid" | "dotted" | "thick"): number {
  const base = Math.max(2, Math.round(tokens.type.body / 10));
  return style === "thick" ? Math.max(base + 1, Math.round(base * 1.5)) : base;
}

function nodeStrokeWeight(tokens: StyleTokens): number {
  return Math.max(1, Math.round(tokens.type.body / 24));
}

function connectorLineType(mode: RoutingMode): ConnectorNode["connectorLineType"] {
  return mode === "direct" ? "STRAIGHT" : "ELBOWED";
}

function connectorMagnets(
  from?: GraphLayoutNode,
  to?: GraphLayoutNode,
  direction?: MermaidGraph["direction"],
  mode: RoutingMode = "elbow",
): { start: ConnectorEndpointEndpointNodeIdAndMagnet["magnet"]; end: ConnectorEndpointEndpointNodeIdAndMagnet["magnet"] } {
  if (!from || !to || mode === "direct") return { start: "AUTO", end: "AUTO" };

  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const horizontalFlow = direction === "LR" || direction === "RL";
  const loopFriendly = mode === "loop-friendly" && (from.rank >= to.rank || from.rank === to.rank);

  if (loopFriendly) {
    if (horizontalFlow) return dy >= 0 ? { start: "BOTTOM", end: "TOP" } : { start: "TOP", end: "BOTTOM" };
    return dx >= 0 ? { start: "RIGHT", end: "LEFT" } : { start: "LEFT", end: "RIGHT" };
  }

  if (from.rank !== to.rank) {
    if (horizontalFlow) {
      return dx >= 0
        ? { start: "RIGHT", end: "LEFT" }
        : { start: "LEFT", end: "RIGHT" };
    }

    return dy >= 0
      ? { start: "BOTTOM", end: "TOP" }
      : { start: "TOP", end: "BOTTOM" };
  }

  if (!horizontalFlow && Math.abs(dx) > 1) {
    return dx >= 0
      ? { start: "RIGHT", end: "LEFT" }
      : { start: "LEFT", end: "RIGHT" };
  }

  if (horizontalFlow && Math.abs(dy) > 1) {
    return dy >= 0
      ? { start: "BOTTOM", end: "TOP" }
      : { start: "TOP", end: "BOTTOM" };
  }

  if (horizontalFlow) {
    return dx >= 0
      ? { start: "RIGHT", end: "LEFT" }
      : { start: "LEFT", end: "RIGHT" };
  }

  return dy >= 0
    ? { start: "BOTTOM", end: "TOP" }
    : { start: "TOP", end: "BOTTOM" };
}

function figJamShapeFor(shape: GraphNodeShape): ShapeWithTextNode["shapeType"] {
  switch (shape) {
    case "decision": return "DIAMOND";
    case "flag": return "PARALLELOGRAM_RIGHT";
    case "rounded":
    case "terminal":
      return "ROUNDED_RECTANGLE";
    case "rectangle":
    default:
      return "ROUNDED_RECTANGLE";
  }
}

function nodePalette(node: GraphNode, edges: GraphEdge[], tokens: StyleTokens, options: { isSink: boolean; depth: number }): Palette {
  if (tokens.semanticMode !== "depth") {
    const semantic = semanticPalette(node, edges, tokens, options);
    if (semantic) return semantic;
  }
  if (node.shape === "terminal" || options.isSink) return tokens.colors.semantic.sink;
  return depthPalette(tokens, options.depth) ?? tokens.colors.semantic.default ?? tokens.colors.node[node.shape];
}

function semanticPalette(node: GraphNode, edges: GraphEdge[], tokens: StyleTokens, options: { isSink: boolean; depth: number }): Palette | null {
  const match = semanticMatch(node, edges, tokens);
  if (match) return paletteForSemantic(match.category, tokens, match.rule);
  if (node.shape === "decision") return tokens.colors.semantic.decision;
  if (node.shape === "terminal" || options.isSink || isSuccessNode(node)) return tokens.colors.semantic.success;
  return depthPalette(tokens, options.depth);
}

function semanticMatch(node: GraphNode, edges: GraphEdge[], tokens: StyleTokens): SemanticMatch | null {
  const relatedLabels = edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => edge.label ?? "")
    .join(" ");
  const text = `${node.id} ${node.label} ${relatedLabels}`.toLowerCase();
  const rules = [
    ...(tokens.semanticMode === "custom" ? tokens.semanticRules.filter((rule) => rule.enabled !== false) : []),
    ...defaultSemanticRules,
  ];
  const matches = rules.flatMap((rule, order) => {
    if (!rule.keywords.some((keyword) => keyword && text.includes(keyword.toLowerCase()))) return [];
    return [{
      category: rule.category,
      rule,
      priority: typeof rule.priority === "number" ? rule.priority : categoryPriority[rule.category],
      order,
    }];
  });
  matches.sort((a, b) => a.priority - b.priority || categoryPriority[a.category] - categoryPriority[b.category] || a.order - b.order);
  return matches[0] ?? null;
}

function paletteForSemantic(category: SemanticCategory, tokens: StyleTokens, rule?: SemanticRule): Palette {
  const base = tokens.colors.semantic[category] ?? tokens.colors.semantic.default;
  return {
    bg: rule?.fill ?? base.bg,
    fg: rule?.text ?? base.fg,
    border: rule?.stroke ?? base.border,
  };
}

function depthPalette(tokens: StyleTokens, depth: number): Palette | null {
  const requestedLayers = Math.max(1, Math.min(tokens.colorLayers, tokens.colors.depth.length));
  if (requestedLayers <= 1) return tokens.colors.semantic.default;
  return tokens.colors.depth[Math.abs(depth) % requestedLayers] ?? tokens.colors.semantic.default;
}

function isSuccessNode(node: GraphNode): boolean {
  return /\b(success|done|complete|completed|ready|accepted|approved|main app|dashboard|home)\b/i.test(`${node.id} ${node.label}`);
}

function widthForShape(width: number, shape: GraphNodeShape): number {
  if (shape === "terminal") return width * 0.92;
  if (shape === "flag") return width * 0.94;
  return width;
}

function heightForShape(height: number, shape: GraphNodeShape): number {
  if (shape === "terminal") return height * 0.86;
  return height;
}

function computeJourneyLayout(journey: JourneyMap, tokens: StyleTokens): JourneyLayout {
  const sections = journey.sections.filter((section) => section.steps.length > 0);
  const padding = Math.max(80, tokens.graph.padding);
  const leftRail = Math.max(130, Math.round(tokens.type.body * 5.2));
  const minTaskWidth = Math.max(280, Math.round(tokens.type.body * 11.8));
  const maxTaskWidth = Math.max(440, Math.round(tokens.type.body * 18));
  const taskHeight = Math.max(90, Math.round(tokens.type.body * 3.55));
  const phaseHeight = Math.max(52, Math.round(tokens.type.body * 2.05));
  const stepGap = Math.max(34, Math.round(tokens.type.body * 1.55));
  const phaseGap = Math.max(54, Math.round(tokens.type.body * 2.2));
  const titleY = padding;
  const metaY = titleY + Math.max(70, Math.round(tokens.type.title * 2.1));
  const phaseY = metaY + Math.max(48, Math.round(tokens.type.body * 1.9));
  const stepY = phaseY + phaseHeight + Math.max(12, Math.round(tokens.type.body * 0.55));
  const timelineY = stepY + taskHeight + Math.max(52, Math.round(tokens.type.body * 2.1));
  const chartTop = timelineY + Math.max(38, Math.round(tokens.type.body * 1.55));
  const chartHeight = Math.max(120, Math.round(tokens.type.body * 5));
  const chartBottom = chartTop + chartHeight;
  const notesY = chartBottom + Math.max(52, Math.round(tokens.type.body * 2.1));
  const phaseLayouts: JourneyLayout["phaseLayouts"] = [];
  const stepLayouts: JourneyLayout["stepLayouts"] = [];
  let cursorX = padding + leftRail;

  for (const section of sections) {
    const phaseStart = cursorX;
    for (const step of section.steps) {
      const width = clamp(Math.round(step.label.length * tokens.type.body * 0.58 + tokens.type.body * 4.8), minTaskWidth, maxTaskWidth);
      const score = clampScore(step.score);
      stepLayouts.push({
        step,
        section,
        x: cursorX,
        y: stepY,
        width,
        height: taskHeight,
        scoreX: cursorX + width / 2,
        scoreY: scoreToY(score, chartTop, chartBottom),
        score,
      });
      cursorX += width + stepGap;
    }
    const phaseWidth = Math.max(minTaskWidth, cursorX - stepGap - phaseStart);
    phaseLayouts.push({ section, x: phaseStart, y: phaseY, width: phaseWidth, height: phaseHeight, average: averageScore(section.steps.map((step) => clampScore(step.score))) });
    cursorX += phaseGap;
  }

  const contentWidth = stepLayouts.length > 0 ? cursorX - phaseGap : padding + leftRail + minTaskWidth;
  const notesHeight = journey.notes.length > 0 ? journey.notes.length * Math.max(50, tokens.type.body * 1.9) + Math.max(32, tokens.type.body * 1.3) : 0;
  const insightHeight = tokens.journeyView === "insights" ? Math.max(80, tokens.type.body * 3) : 0;
  return {
    width: Math.max(contentWidth + padding, 1040),
    height: notesY + notesHeight + insightHeight + padding / 2,
    padding,
    titleY,
    metaY,
    phaseY,
    stepY,
    timelineY,
    chartTop,
    chartBottom,
    taskHeight,
    phaseHeight,
    phaseLayouts,
    stepLayouts,
    notesY,
  };
}

function createJourneyShape(
  section: SectionNode,
  children: Array<ShapeWithTextNode | ConnectorNode>,
  options: {
    name: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string | "transparent";
    stroke: string | "transparent";
    color?: string;
    fontSize: number;
    shapeType?: ShapeWithTextNode["shapeType"];
    sourceId?: string;
    sourceLine?: number;
    kind?: string;
  },
): ShapeWithTextNode {
  const shape = figma.createShapeWithText();
  section.appendChild(shape);
  shape.name = options.name;
  shape.shapeType = options.shapeType ?? "ROUNDED_RECTANGLE";
  shape.x = options.x;
  shape.y = options.y;
  shape.resize(options.width, options.height);
  shape.fills = options.fill === "transparent" ? [] : solid(options.fill);
  shape.strokes = options.stroke === "transparent" ? [] : solid(options.stroke);
  shape.strokeWeight = options.stroke === "transparent" ? 0 : 1;
  shape.dashPattern = [];
  setText(shape.text, options.text, options.fontSize, options.color ?? "#FFFFFF");
  if (options.sourceId) tagGeneratedNode(shape, options.kind ?? "journey-node", options.sourceId, options.sourceLine ?? 1);
  children.push(shape);
  return shape;
}

function createJourneyConnector(
  section: SectionNode,
  children: Array<ShapeWithTextNode | ConnectorNode>,
  options: {
    name: string;
    start: { x: number; y: number };
    end: { x: number; y: number };
    color: string;
    weight: number;
    dash?: number[];
    arrow?: boolean;
  },
): ConnectorNode {
  const connector = figma.createConnector();
  section.appendChild(connector);
  connector.name = options.name;
  connector.connectorLineType = "STRAIGHT";
  connector.connectorStart = { position: options.start };
  connector.connectorEnd = { position: options.end };
  connector.connectorStartStrokeCap = "NONE";
  connector.connectorEndStrokeCap = options.arrow ? "ARROW_LINES" : "NONE";
  connector.strokes = solid(options.color);
  connector.strokeWeight = options.weight;
  connector.dashPattern = options.dash ?? [];
  children.push(connector);
  return connector;
}

function journeyColors() {
  return {
    panel: "#FAFAF8",
    panelBorder: "#DDDDD8",
    phase: "#EFEFEB",
    phaseBorder: "#D8D8D2",
    card: "#FFFFFF",
    cardBorder: "#D1D1CB",
    metric: "#FFFFFF",
    metricBorder: "#DADAD4",
    note: "#FFFFFF",
    noteBorder: "#DADAD4",
    text: "#171717",
    muted: "#666662",
    good: "#65B978",
    goodFill: "#DDF5E4",
    goodBorder: "#8BD59B",
    goodText: "#1E5D32",
    midFill: "#F8E9A8",
    midBorder: "#D7BF56",
    midText: "#5A4600",
    badFill: "#FFDADA",
    badBorder: "#EF8C8C",
    badText: "#7A1F1F",
    subtleDot: "#FFFFFF",
    subtleDotBorder: "#BDBDB7",
    timeline: "#B8B8B2",
    markerLine: "#D4D4CE",
    scoreLine: "#8E8E88",
  };
}

function journeyPhasePalette(average: number | undefined, colors: ReturnType<typeof journeyColors>): { fill: string; border: string; text: string } {
  if (average === undefined) return { fill: colors.phase, border: colors.phaseBorder, text: colors.text };
  if (average >= 4) return { fill: colors.goodFill, border: colors.goodBorder, text: colors.goodText };
  if (average <= 2.5) return { fill: colors.badFill, border: colors.badBorder, text: colors.badText };
  return { fill: colors.midFill, border: colors.midBorder, text: colors.midText };
}

function scorePalette(score: number, colors: ReturnType<typeof journeyColors>): { fill: string; border: string; text: string } {
  if (score >= 4) return { fill: colors.goodFill, border: colors.goodBorder, text: colors.goodText };
  if (score <= 2) return { fill: colors.badFill, border: colors.badBorder, text: colors.badText };
  return { fill: colors.midFill, border: colors.midBorder, text: colors.midText };
}

function scoreToY(score: number, top: number, bottom: number): number {
  const normalized = (clampScore(score) - 1) / 4;
  return bottom - normalized * (bottom - top);
}

function clampScore(score: number | undefined): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 3;
  return Math.max(1, Math.min(5, Math.round(score)));
}

function averageScore(scores: number[]): number | undefined {
  if (scores.length === 0) return undefined;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function formatAverage(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function writeMetadata(nodes: GeneratedNode[], root: SectionNode, payload: GeneratePayload, groupId: string): void {
  const sourceStored = payload.source.length <= SAFE_SOURCE_LIMIT;
  const metadata: PluginMetadata = {
    schemaVersion: payload.diagram.schemaVersion,
    sourceHash: payload.sourceHash,
    sourceStored,
    style: payload.diagram.style,
    title: payload.diagram.title,
    generatedAt: new Date().toISOString(),
  };
  const encodedMetadata = JSON.stringify(metadata);
  for (const node of nodes) {
    node.setPluginData(GROUP_KEY, groupId);
    node.setPluginData(METADATA_KEY, encodedMetadata);
    node.setPluginData(SOURCE_KEY, sourceStored ? payload.source : "");
    node.setRelaunchData({ open: "Edit in Mermaid Jam" });
  }
  root.setPluginData(ROOT_KEY, "true");
}

function tagGeneratedNode(node: GeneratedNode, kind: string, sourceId: string, sourceLine: number): void {
  node.setPluginData(NODE_KIND_KEY, kind);
  node.setPluginData(NODE_ID_KEY, sourceId);
  node.setPluginData(SOURCE_LINE_KEY, String(sourceLine));
}

function captureManualPositions(groupId: string): PreservedPositions {
  const positions: PreservedPositions = new Map();
  for (const node of findGeneratedGroup(groupId)) {
    if (node.type !== "SHAPE_WITH_TEXT") continue;
    const sourceId = getPluginDataAny(node, NODE_ID_KEY, LEGACY_NODE_ID_KEY);
    if (!sourceId) continue;
    positions.set(sourceId, { x: node.x, y: node.y, width: node.width, height: node.height });
  }
  return positions;
}

function applyPreservedNodePosition(nodeLayout: GraphLayoutNode, preserved?: PreservedPosition): GraphLayoutNode {
  if (!preserved) return nodeLayout;
  return { ...nodeLayout, x: preserved.x, y: preserved.y };
}

function applyPreservedJourneyPositions(layout: JourneyLayout, preserved: PreservedPositions): void {
  for (const item of layout.stepLayouts) {
    const match = preserved.get(journeyStepKey(item.step.id));
    if (!match) continue;
    item.x = match.x;
    item.y = match.y;
    item.scoreX = item.x + item.width / 2;
  }
  for (const phase of layout.phaseLayouts) {
    const match = preserved.get(journeySectionKey(phase.section.id));
    if (!match) continue;
    phase.x = match.x;
    phase.y = match.y;
  }
}

function containSection(section: SectionNode, children: Array<ShapeWithTextNode | ConnectorNode>, padding: number): void {
  const bounds = childBounds(children);
  if (!bounds) return;
  const shiftX = bounds.minX < padding ? bounds.minX - padding : 0;
  const shiftY = bounds.minY < padding ? bounds.minY - padding : 0;
  if (shiftX || shiftY) {
    section.x += shiftX;
    section.y += shiftY;
    for (const child of children) shiftChild(child, -shiftX, -shiftY);
  }
  const width = Math.max(section.width, bounds.maxX - shiftX + padding);
  const height = Math.max(section.height, bounds.maxY - shiftY + padding);
  section.resizeWithoutConstraints(width, height);
}

function childBounds(children: Array<ShapeWithTextNode | ConnectorNode>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const boxes = children.flatMap((child) => endpointBoxes(child));
  if (boxes.length === 0) return null;
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

function endpointBoxes(child: ShapeWithTextNode | ConnectorNode): Array<{ minX: number; minY: number; maxX: number; maxY: number }> {
  if (child.type === "SHAPE_WITH_TEXT") return [{ minX: child.x, minY: child.y, maxX: child.x + child.width, maxY: child.y + child.height }];
  const points = [positionEndpoint(child.connectorStart), positionEndpoint(child.connectorEnd)].filter((point): point is { x: number; y: number } => Boolean(point));
  return points.map((point) => ({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }));
}

function positionEndpoint(endpoint: ConnectorEndpoint): { x: number; y: number } | null {
  return "position" in endpoint ? endpoint.position : null;
}

function shiftChild(child: ShapeWithTextNode | ConnectorNode, dx: number, dy: number): void {
  child.x += dx;
  child.y += dy;
  if (child.type !== "CONNECTOR") return;
  child.connectorStart = shiftEndpoint(child.connectorStart, dx, dy);
  child.connectorEnd = shiftEndpoint(child.connectorEnd, dx, dy);
}

function shiftEndpoint(endpoint: ConnectorEndpoint, dx: number, dy: number): ConnectorEndpoint {
  if (!("position" in endpoint)) return endpoint;
  return { position: { x: endpoint.position.x + dx, y: endpoint.position.y + dy } };
}

function graphNodeKey(id: string): string {
  return `graph:${id}`;
}

function journeyStepKey(id: string): string {
  return `journey-step:${id}`;
}

function journeySectionKey(id: string): string {
  return `journey-section:${id}`;
}

function findSelectedMermaidJamRoot(): SectionNode | null {
  for (const selected of figma.currentPage.selection) {
    const root = findMermaidJamRoot(selected);
    if (root) return root;
  }
  return null;
}

function findMermaidJamRoot(node: BaseNode | null): SectionNode | null {
  let cursor: BaseNode | null = node;
  let fallback: SectionNode | null = null;
  while (cursor && cursor.type !== "PAGE" && cursor.type !== "DOCUMENT") {
    if (hasPluginData(cursor) && getPluginDataAny(cursor, GROUP_KEY, LEGACY_GROUP_KEY)) {
      if (cursor.type === "SECTION") fallback = cursor;
      if (cursor.type === "SECTION" && getPluginDataAny(cursor, ROOT_KEY, LEGACY_ROOT_KEY) === "true") return cursor;
    }
    cursor = cursor.parent;
  }
  return fallback;
}

function findGeneratedGroup(groupId: string): SceneNode[] {
  if (!groupId) return [];
  return figma.currentPage.findAll((node) => hasPluginData(node) && getPluginDataAny(node, GROUP_KEY, LEGACY_GROUP_KEY) === groupId);
}

function removeGeneratedGroup(groupId: string): void {
  for (const node of [...findGeneratedGroup(groupId)].reverse()) node.remove();
}

function hasPluginData(node: BaseNode): node is BaseNode & PluginDataMixin {
  return "getPluginData" in node && typeof node.getPluginData === "function";
}

function getPluginDataAny(node: PluginDataMixin, primaryKey: string, legacyKey: string): string {
  return node.getPluginData(primaryKey) || node.getPluginData(legacyKey);
}

function computeRenderLayout(diagram: MermaidGraph, tokens: StyleTokens) {
  return computeGraphLayout({ ...diagram, title: undefined }, tokens);
}

function computeInitialLayout(diagram: MermaidGraph, tokens: StyleTokens): { width: number; height: number } {
  if (diagram.journey) return computeJourneyLayout(diagram.journey, tokens);
  return computeRenderLayout(diagram, tokens);
}

function solid(hex: string): SolidPaint[] {
  return [{ type: "SOLID", color: hexToRgb(hex) }];
}

function createGroupId(): string {
  return `mj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sectionName(diagram: MermaidGraph): string {
  return diagram.title?.trim() || "";
}

function assertFigJam(): void {
  if (figma.editorType !== "figjam") {
    throw new Error("Mermaid Jam now generates native FigJam flows. Open this plugin from a FigJam board.");
  }
}

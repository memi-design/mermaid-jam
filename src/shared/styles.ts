import type {
  DensityName,
  DiagramStyleOptions,
  GraphNodeShape,
  JourneyViewMode,
  LayoutPresetName,
  ManualLayoutMode,
  RoutingMode,
  SemanticCategory,
  SemanticMode,
  SemanticRule,
  ThemeName,
} from "./types";

export type Rgb = { r: number; g: number; b: number };
export type Palette = { bg: string; fg: string; border: string };

export type StyleTokens = {
  theme: ThemeName;
  density: DensityName;
  colorLayers: number;
  layoutPreset: LayoutPresetName;
  routingMode: RoutingMode;
  semanticMode: SemanticMode;
  semanticRules: SemanticRule[];
  manualLayout: ManualLayoutMode;
  journeyView: JourneyViewMode;
  canvasWidth: number;
  radius: number;
  borderWidth: number;
  space: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  type: {
    body: number;
    small: number;
    title: number;
    lineHeight: number;
  };
  graph: {
    nodeWidth: number;
    nodeHeight: number;
    rankGap: number;
    laneGap: number;
    padding: number;
  };
  colors: {
    canvas: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentSoft: string;
    connector: string;
    node: Record<GraphNodeShape, Palette>;
    depth: Palette[];
    semantic: Record<SemanticCategory | "default" | "sink", Palette>;
  };
};

type Scale = {
  node: number;
  nodeY: number;
  rank: number;
  lane: number;
  padding: number;
  canvas: number;
};

const densityScale: Record<DensityName, Pick<StyleTokens, "space" | "type" | "graph" | "canvasWidth" | "radius" | "borderWidth">> = {
  compact: {
    canvasWidth: 720,
    radius: 5,
    borderWidth: 1,
    space: { xs: 3, sm: 5, md: 8, lg: 12, xl: 18 },
    type: { body: 24, small: 24, title: 28, lineHeight: 1.2 },
    graph: { nodeWidth: 280, nodeHeight: 88, rankGap: 96, laneGap: 48, padding: 64 },
  },
  comfy: {
    canvasWidth: 860,
    radius: 5,
    borderWidth: 1,
    space: { xs: 4, sm: 6, md: 10, lg: 15, xl: 22 },
    type: { body: 26, small: 24, title: 30, lineHeight: 1.2 },
    graph: { nodeWidth: 340, nodeHeight: 104, rankGap: 120, laneGap: 62, padding: 76 },
  },
  spacious: {
    canvasWidth: 1040,
    radius: 5,
    borderWidth: 1,
    space: { xs: 5, sm: 8, md: 12, lg: 18, xl: 28 },
    type: { body: 30, small: 26, title: 34, lineHeight: 1.22 },
    graph: { nodeWidth: 420, nodeHeight: 128, rankGap: 154, laneGap: 82, padding: 92 },
  },
};

const layoutScale: Record<LayoutPresetName, Scale> = {
  compact: { node: 1, nodeY: 1, rank: 1, lane: 1, padding: 1, canvas: 1 },
  readable: { node: 1.12, nodeY: 1.08, rank: 1.18, lane: 1.22, padding: 1.12, canvas: 1.08 },
  presentation: { node: 1.32, nodeY: 1.24, rank: 1.35, lane: 1.35, padding: 1.25, canvas: 1.2 },
  print: { node: 1.08, nodeY: 1.08, rank: 1.12, lane: 1.18, padding: 1.08, canvas: 1.05 },
  "wide-map": { node: 1.04, nodeY: 1, rank: 1.55, lane: 1.05, padding: 1.1, canvas: 1.35 },
  "deep-tree": { node: 1, nodeY: 1, rank: 1.24, lane: 1.38, padding: 1.1, canvas: 1.1 },
};

const routingScale: Record<RoutingMode, Pick<Scale, "rank" | "lane" | "padding">> = {
  direct: { rank: 0.9, lane: 0.9, padding: 1 },
  elbow: { rank: 1, lane: 1, padding: 1 },
  "avoid-nodes": { rank: 1.28, lane: 1.45, padding: 1.12 },
  "more-spacing": { rank: 1.58, lane: 1.7, padding: 1.22 },
  "loop-friendly": { rank: 1.42, lane: 1.52, padding: 1.18 },
};

const minimalColors: StyleTokens["colors"] = {
  canvas: "#FFFFFF",
  surface: "#FFFFFF",
  text: "#151515",
  muted: "#5F6368",
  border: "#DADCE0",
  accent: "#111111",
  accentSoft: "#F1F3F4",
  connector: "#111111",
  node: {
    rectangle: { bg: "#FFFFFF", fg: "#151515", border: "#CFCFCA" },
    rounded: { bg: "#FFFFFF", fg: "#151515", border: "#CFCFCA" },
    decision: { bg: "#FFF6D8", fg: "#604400", border: "#D9B94B" },
    terminal: { bg: "#EAF7EE", fg: "#165A32", border: "#8ACB99" },
    flag: { bg: "#FFFFFF", fg: "#151515", border: "#CFCFCA" },
  },
  depth: [
    { bg: "#111111", fg: "#FFFFFF", border: "#111111" },
    { bg: "#EAF4FF", fg: "#16466F", border: "#91BDE4" },
    { bg: "#EAF7EE", fg: "#165A32", border: "#8ACB99" },
    { bg: "#FFF6D8", fg: "#604400", border: "#D9B94B" },
    { bg: "#F8F5FF", fg: "#4A2A74", border: "#C8B7EA" },
    { bg: "#F1F3F4", fg: "#303134", border: "#C9CCCF" },
  ],
  semantic: {
    default: { bg: "#111111", fg: "#FFFFFF", border: "#111111" },
    sink: { bg: "#EAF7EE", fg: "#165A32", border: "#8ACB99" },
    error: { bg: "#FFE3E3", fg: "#7A1F1F", border: "#E58D8D" },
    warning: { bg: "#FFF6D8", fg: "#604400", border: "#D9B94B" },
    success: { bg: "#EAF7EE", fg: "#165A32", border: "#8ACB99" },
    backend: { bg: "#F1F3F4", fg: "#303134", border: "#B8BDC2" },
    auth: { bg: "#F3ECFF", fg: "#4A2A74", border: "#BBA4E4" },
    payment: { bg: "#FFF0D9", fg: "#704400", border: "#D8AA60" },
    data: { bg: "#E8F7F4", fg: "#14574D", border: "#83C9BD" },
    external: { bg: "#EEF1FF", fg: "#283B77", border: "#9AA7E6" },
    screen: { bg: "#EAF4FF", fg: "#16466F", border: "#91BDE4" },
    user: { bg: "#FFFFFF", fg: "#151515", border: "#CFCFCA" },
    decision: { bg: "#FFF6D8", fg: "#604400", border: "#D9B94B" },
    note: { bg: "#FAFAF8", fg: "#444440", border: "#D7D7D1" },
  },
};

const printColors: StyleTokens["colors"] = {
  ...minimalColors,
  connector: "#000000",
  depth: [
    { bg: "#FFFFFF", fg: "#111111", border: "#111111" },
    { bg: "#F7F7F5", fg: "#111111", border: "#777777" },
    { bg: "#FFFFFF", fg: "#111111", border: "#777777" },
  ],
  semantic: Object.fromEntries(
    Object.entries(minimalColors.semantic).map(([key, value]) => [key, { ...value, border: key === "default" ? "#111111" : value.border }]),
  ) as StyleTokens["colors"]["semantic"],
};

const themeColors: Record<ThemeName, StyleTokens["colors"]> = {
  blueprint: minimalColors,
  editorial: minimalColors,
  "product-map": minimalColors,
  minimal: minimalColors,
};

export function getStyleTokens(options: DiagramStyleOptions): StyleTokens {
  const densityName = normalizeDensity(options.density) ?? "compact";
  const density = densityScale[densityName];
  const fontSize = normalizeFontSize(options.fontSize) ?? density.type.body;
  const layoutPreset = normalizeLayoutPreset(options.layoutPreset) ?? "compact";
  const routingMode = normalizeRoutingMode(options.routingMode) ?? "elbow";
  const semanticMode = normalizeSemanticMode(options.semanticMode) ?? "auto";
  const manualLayout = normalizeManualLayout(options.manualLayout) ?? "preserve";
  const journeyView = normalizeJourneyView(options.journeyView) ?? "clean";
  const layout = layoutScale[layoutPreset];
  const route = routingScale[routingMode];
  const colors = layoutPreset === "print" ? printColors : themeColors[options.theme] ?? minimalColors;
  return {
    theme: normalizeTheme(options.theme) ?? "minimal",
    density: densityName,
    colorLayers: normalizeColorLayers(options.colorLayers) ?? 3,
    layoutPreset,
    routingMode,
    semanticMode,
    semanticRules: normalizeSemanticRules(options.semanticRules),
    manualLayout,
    journeyView,
    ...density,
    canvasWidth: Math.round(density.canvasWidth * layout.canvas),
    type: {
      ...density.type,
      body: fontSize,
      small: Math.max(24, Math.round(fontSize * 0.92)),
      title: Math.max(28, Math.round(fontSize * 1.16)),
    },
    graph: {
      nodeWidth: Math.round(density.graph.nodeWidth * layout.node),
      nodeHeight: Math.round(density.graph.nodeHeight * layout.nodeY),
      rankGap: Math.round(density.graph.rankGap * layout.rank * route.rank),
      laneGap: Math.round(density.graph.laneGap * layout.lane * route.lane),
      padding: Math.round(density.graph.padding * layout.padding * route.padding),
    },
    colors,
  };
}

export function normalizeTheme(value: unknown): ThemeName | null {
  return value === "blueprint" || value === "editorial" || value === "product-map" || value === "minimal" ? value : null;
}

export function normalizeDensity(value: unknown): DensityName | null {
  return value === "compact" || value === "comfy" || value === "spacious" ? value : null;
}

export function normalizeLayoutPreset(value: unknown): LayoutPresetName | null {
  return value === "compact" || value === "readable" || value === "presentation" || value === "print" || value === "wide-map" || value === "deep-tree" ? value : null;
}

export function normalizeRoutingMode(value: unknown): RoutingMode | null {
  return value === "direct" || value === "elbow" || value === "avoid-nodes" || value === "more-spacing" || value === "loop-friendly" ? value : null;
}

export function normalizeSemanticMode(value: unknown): SemanticMode | null {
  return value === "depth" || value === "auto" || value === "custom" ? value : null;
}

export function normalizeManualLayout(value: unknown): ManualLayoutMode | null {
  return value === "preserve" || value === "reset" ? value : null;
}

export function normalizeJourneyView(value: unknown): JourneyViewMode | null {
  return value === "clean" || value === "scores" || value === "insights" ? value : null;
}

export function normalizeSemanticCategory(value: unknown): SemanticCategory | null {
  return value === "error" || value === "warning" || value === "success" || value === "backend" || value === "auth" || value === "payment" || value === "data" || value === "external" || value === "screen" || value === "user" || value === "decision" || value === "note" ? value : null;
}

export function normalizeFontSize(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(64, Math.max(24, Math.round(parsed)));
}

export function normalizeColorLayers(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(6, Math.max(1, Math.round(parsed)));
}

export function normalizeSemanticRules(value: unknown): SemanticRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rule, index) => {
    if (!rule || typeof rule !== "object") return [];
    const record = rule as Record<string, unknown>;
    const category = normalizeSemanticCategory(record.category);
    const keywords = Array.isArray(record.keywords)
      ? record.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
      : [];
    if (!category || keywords.length === 0) return [];
    return [{
      id: typeof record.id === "string" ? record.id : `rule-${index + 1}`,
      keywords,
      category,
      fill: normalizeHexColor(record.fill),
      stroke: normalizeHexColor(record.stroke),
      text: normalizeHexColor(record.text),
      enabled: record.enabled !== false,
      priority: typeof record.priority === "number" && Number.isFinite(record.priority) ? record.priority : undefined,
    }];
  });
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed.toUpperCase() : undefined;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace("#", "").trim();
  const value = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const int = Number.parseInt(value, 16);
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  };
}

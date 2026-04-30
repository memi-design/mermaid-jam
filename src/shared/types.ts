export const SCHEMA_VERSION = 1 as const;

export type ThemeName = "blueprint" | "editorial" | "product-map" | "minimal";
export type DensityName = "compact" | "comfy" | "spacious";
export type LayoutPresetName = "compact" | "readable" | "presentation" | "print" | "wide-map" | "deep-tree";
export type RoutingMode = "direct" | "elbow" | "avoid-nodes" | "more-spacing" | "loop-friendly";
export type SemanticMode = "depth" | "auto" | "custom";
export type ManualLayoutMode = "preserve" | "reset";
export type JourneyViewMode = "clean" | "scores" | "insights";
export type SemanticCategory =
  | "error"
  | "warning"
  | "success"
  | "backend"
  | "auth"
  | "payment"
  | "data"
  | "external"
  | "screen"
  | "user"
  | "decision"
  | "note";

export type SemanticRule = {
  id?: string;
  keywords: string[];
  category: SemanticCategory;
  fill?: string;
  stroke?: string;
  text?: string;
  enabled?: boolean;
  priority?: number;
};

export type DiagramStyleOptions = {
  theme: ThemeName;
  density: DensityName;
  fontSize?: number;
  colorLayers?: number;
  layoutPreset?: LayoutPresetName;
  routingMode?: RoutingMode;
  semanticMode?: SemanticMode;
  semanticRules?: SemanticRule[];
  manualLayout?: ManualLayoutMode;
  journeyView?: JourneyViewMode;
};

export type DiagnosticLevel = "error" | "warning";

export type Diagnostic = {
  level: DiagnosticLevel;
  message: string;
  line?: number;
  column?: number;
};

export type MermaidDirection = "TD" | "TB" | "BT" | "LR" | "RL";
export type GraphNodeShape = "rectangle" | "rounded" | "decision" | "terminal" | "flag";
export type GraphEdgeStyle = "solid" | "dotted" | "thick";

export type MermaidGraph = {
  schemaVersion: typeof SCHEMA_VERSION;
  kind?: "flowchart" | "journey" | "markdown" | "sequence" | "state" | "mindmap" | "timeline" | "converted";
  title?: string;
  style: DiagramStyleOptions;
  direction: MermaidDirection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cleanSource: string;
  journey?: JourneyMap;
};

export type GraphNode = {
  id: string;
  label: string;
  shape: GraphNodeShape;
  sourceLine: number;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: GraphEdgeStyle;
  sourceLine: number;
};

export type JourneyMap = {
  title?: string;
  actor?: string;
  sections: JourneySection[];
  notes: string[];
};

export type JourneySection = {
  id: string;
  title: string;
  sourceLine: number;
  steps: JourneyStep[];
};

export type JourneyStep = {
  id: string;
  label: string;
  score?: number;
  actor?: string;
  sourceLine: number;
};

export type ParseResult =
  | { ok: true; diagram: MermaidGraph; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[]; cleanSource: string };

export type PluginMetadata = {
  schemaVersion: typeof SCHEMA_VERSION;
  sourceHash: string;
  sourceStored: boolean;
  style: DiagramStyleOptions;
  title?: string;
  generatedAt: string;
};

export type GeneratePayload = {
  diagram: MermaidGraph;
  source: string;
  sourceHash: string;
};

export type UiToMainMessage =
  | ({ type: "generate" } & GeneratePayload)
  | ({ type: "update-selection" } & GeneratePayload)
  | { type: "load-from-selection" }
  | { type: "resize"; width: number; height: number };

export type MainToUiMessage =
  | { type: "ready" }
  | { type: "render-success"; mode: "generate" | "update"; nodeId: string; message: string }
  | { type: "render-error"; message: string }
  | { type: "selection-source"; source: string; metadata: PluginMetadata }
  | { type: "selection-source-error"; message: string };

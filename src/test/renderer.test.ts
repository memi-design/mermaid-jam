import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMermaidFlowchart, parseMermaidJamSource } from "../parser/mermaidJam";
import { createSourceHash } from "../shared/hash";
import type { DiagramStyleOptions, GeneratePayload } from "../shared/types";

class MockTextSublayer {
  characters = "";
  fontName: FontName | typeof figma.mixed = { family: "Inter", style: "Regular" };
  fontSize = 12;
  lineHeight: LineHeight = { unit: "AUTO" };
  fills: Paint[] = [];
}

class MockNode {
  id: string;
  type: string;
  name = "";
  parent: MockNode | null = null;
  children: MockNode[] = [];
  removed = false;
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  shapeType = "ROUNDED_RECTANGLE";
  fills: Paint[] = [];
  strokes: Paint[] = [];
  strokeWeight: number | typeof figma.mixed = 1;
  dashPattern: ReadonlyArray<number> = [];
  connectorLineType = "ELBOWED";
  connectorStart: ConnectorEndpoint = { position: { x: 0, y: 0 } };
  connectorEnd: ConnectorEndpoint = { position: { x: 0, y: 0 } };
  connectorStartStrokeCap: ConnectorStrokeCap = "NONE";
  connectorEndStrokeCap: ConnectorStrokeCap = "NONE";
  text = new MockTextSublayer();
  textBackground = { fills: [] as Paint[] };
  private pluginData = new Map<string, string>();

  constructor(type: string, id: string) {
    this.type = type;
    this.id = id;
  }

  appendChild(child: MockNode) {
    if (child.parent) child.parent.children = child.parent.children.filter((existing) => existing !== child);
    child.parent = this;
    this.children.push(child);
  }

  remove() {
    this.removed = true;
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  resizeWithoutConstraints(width: number, height: number) {
    this.resize(width, height);
  }

  setPluginData(key: string, value: string) {
    this.pluginData.set(key, value);
  }

  getPluginData(key: string) {
    return this.pluginData.get(key) ?? "";
  }

  setRelaunchData() {
    return undefined;
  }

  findAll(callback: (node: MockNode) => boolean): MockNode[] {
    return this.children
      .flatMap((child) => [child, ...(typeof child.findAll === "function" ? child.findAll(callback) : [])])
      .filter(callback);
  }
}

function createMockFigma() {
  let nextId = 1;
  const page = new MockNode("PAGE", "page") as MockNode & { selection: MockNode[] };
  page.selection = [];
  const make = (type: string) => {
    const node = new MockNode(type, `${type.toLowerCase()}-${nextId++}`);
    page.appendChild(node);
    return node;
  };
  const createLine = vi.fn(() => make("LINE"));

  return {
    editorType: "figjam",
    mixed: Symbol("mixed"),
    viewport: {
      center: { x: 500, y: 300 },
      scrollAndZoomIntoView: vi.fn(),
    },
    currentPage: page,
    createSection: vi.fn(() => make("SECTION")),
    createShapeWithText: vi.fn(() => make("SHAPE_WITH_TEXT")),
    createConnector: vi.fn(() => make("CONNECTOR")),
    createLine,
    loadFontAsync: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
  };
}

function payload(source: string, fontSize = 24, colorLayers = 3, style: Partial<DiagramStyleOptions> = {}): GeneratePayload {
  const result = parseMermaidFlowchart(source, { theme: "minimal", density: "compact", fontSize, colorLayers, ...style });
  if (!result.ok) throw new Error("Expected valid graph");
  return { diagram: result.diagram, source, sourceHash: createSourceHash(source) };
}

function mermaidJamPayload(source: string, fontSize = 24, colorLayers = 3, style: Partial<DiagramStyleOptions> = {}): GeneratePayload {
  const result = parseMermaidJamSource(source, { theme: "minimal", density: "compact", fontSize, colorLayers, ...style });
  if (!result.ok) throw new Error("Expected valid Mermaid Jam source");
  return { diagram: result.diagram, source, sourceHash: createSourceHash(source) };
}

describe("renderer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("figma", createMockFigma());
  });

  it("renders native FigJam shapes/connectors with only user diagram text", async () => {
    const { renderNewDocument, readSelectedSource } = await import("../plugin/main/renderer");
    const source = `flowchart TD\n  A[User opens Buzzr] -->|ready| B((Main app tabs))`;
    const primary = await renderNewDocument(payload(source)) as unknown as MockNode;
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const nodes = section.children;

    expect(primary.name).toBe("");
    expect(primary.type).toBe("SECTION");
    expect(primary.getPluginData("mermaidjam.root")).toBe("true");
    expect(figmaMock.createSection).toHaveBeenCalledTimes(1);
    expect(figmaMock.createShapeWithText).toHaveBeenCalledTimes(2);
    expect(figmaMock.createConnector).toHaveBeenCalledTimes(1);
    expect(figmaMock.createLine).not.toHaveBeenCalled();
    expect(figmaMock.loadFontAsync).toHaveBeenCalledWith({ family: "Inter", style: "Regular" });
    expect(figmaMock.loadFontAsync).not.toHaveBeenCalledWith({ family: "Inter", style: "Bold" });

    const renderedText = nodes.flatMap((node) => collectText(node));
    expect(renderedText).toEqual(expect.arrayContaining(["User opens Buzzr", "ready", "Main app tabs"]));
    expect(renderedText).not.toContain("Generated");
    expect(renderedText).not.toContain("Mermaid Jam");

    const connector = nodes.find((node) => node.type === "CONNECTOR")!;
    expect(connector.connectorLineType).toBe("ELBOWED");
    expect(connector.connectorEndStrokeCap).toBe("ARROW_LINES");
    expect(connector.strokeWeight).toBe(2);
    expect(connector.connectorStart).toEqual({ endpointNodeId: "shape_with_text-2", magnet: "BOTTOM" });
    expect(connector.connectorEnd).toEqual({ endpointNodeId: "shape_with_text-3", magnet: "TOP" });

    const selected = readSelectedSource();
    expect(selected.source).toBe(source);
    expect(selected.metadata).toMatchObject({ schemaVersion: 1, sourceStored: true, style: { theme: "minimal", density: "compact", fontSize: 24, colorLayers: 3 } });
  });

  it("updates a selected generated group in place without Figma line nodes", async () => {
    const { renderNewDocument, updateSelectedDocument } = await import("../plugin/main/renderer");
    const first = payload(`flowchart LR\n  A[Start] --> B[Done]`);
    await renderNewDocument(first);
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const originalSection = figmaMock.currentPage.children[0];
    const originalNodes = [originalSection, ...originalSection.children];
    const originalShapes = originalSection.children.filter((node) => node.type !== "CONNECTOR");
    const originalOrigin = {
      x: originalSection.x,
      y: originalSection.y,
    };

    figmaMock.currentPage.selection = [originalSection.children[0]];
    await updateSelectedDocument(payload(`flowchart LR\n  A[Start] --> B[Middle]\n  B --> C[Done]`));
    const replacementSection = figmaMock.currentPage.children.find((node) => node.type === "SECTION" && !node.removed)!;
    const replacementNodes = replacementSection.children.filter((node) => !node.removed);

    expect(originalNodes.every((node) => node.removed)).toBe(true);
    expect(replacementSection.type).toBe("SECTION");
    expect(replacementNodes.filter((node) => node.type === "SHAPE_WITH_TEXT")).toHaveLength(3);
    expect(replacementNodes.filter((node) => node.type === "CONNECTOR")).toHaveLength(2);
    expect(replacementSection.x).toBe(originalOrigin.x);
    expect(replacementSection.y).toBe(originalOrigin.y);
    expect(figmaMock.createLine).not.toHaveBeenCalled();
  });

  it("uses the user title as the FigJam section name without adding title text nodes", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    const source = `---
title: Whole App Journey
---
flowchart TD
  A[Start] --> B[Done]`;
    const primary = await renderNewDocument(payload(source)) as unknown as MockNode;
    const renderedText = primary.children.flatMap((node) => collectText(node));

    expect(primary.type).toBe("SECTION");
    expect(primary.name).toBe("Whole App Journey");
    expect(renderedText).not.toContain("Whole App Journey");
  });

  it("renders Mermaid journey syntax as a journey map instead of a flat flowchart", async () => {
    const { renderNewDocument, readSelectedSource } = await import("../plugin/main/renderer");
    const source = `\`\`\`mermaid
journey
  title New casual fan trying Buzzr for the first time
  section Entry
    Sees sign-in screen: 3: User
    Taps Continue as guest: 5: User
    Lands on Games: 4: User
  section First value
    Browses today's games: 4: User
    Opens a game card: 4: User
    Tries to rate or bookmark: 2: User
\`\`\``;
    const primary = await renderNewDocument(mermaidJamPayload(source)) as unknown as MockNode;
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const renderedText = section.children.flatMap((node) => collectText(node));
    const connectors = section.children.filter((node) => node.type === "CONNECTOR");

    expect(primary.name).toBe("New casual fan trying Buzzr for the first time");
    expect(renderedText).toEqual(expect.arrayContaining([
      "New casual fan trying Buzzr for the first time",
      "User",
      "Entry",
      "First value",
      "Sees sign-in screen",
      "Tries to rate or bookmark",
    ]));
    expect(connectors.some((connector) => connector.name === "Journey/Timeline" && connector.connectorEndStrokeCap === "ARROW_LINES")).toBe(true);
    expect(connectors.some((connector) => connector.name.startsWith("Journey/ScoreLine/"))).toBe(false);
    expect(connectors.some((connector) => connector.name.startsWith("Journey/MarkerLine/") && connector.dashPattern.length > 0)).toBe(true);
    expect(figmaMock.createLine).not.toHaveBeenCalled();
    expect(readSelectedSource().source).toBe(source);
  });

  it("uses horizontal connector magnets for left-right flows", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart LR\n  A[Start] --> B[Done]`));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const connector = section.children.find((node) => node.type === "CONNECTOR")!;

    expect(connector.connectorStart).toEqual({ endpointNodeId: "shape_with_text-2", magnet: "RIGHT" });
    expect(connector.connectorEnd).toEqual({ endpointNodeId: "shape_with_text-3", magnet: "LEFT" });
  });

  it("supports direct routing with automatic connector magnets", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart LR\n  A[Start] --> B[Done]`, 24, 3, { routingMode: "direct" }));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const connector = section.children.find((node) => node.type === "CONNECTOR")!;

    expect(connector.connectorLineType).toBe("STRAIGHT");
    expect(connector.connectorStart).toEqual({ endpointNodeId: "shape_with_text-2", magnet: "AUTO" });
    expect(connector.connectorEnd).toEqual({ endpointNodeId: "shape_with_text-3", magnet: "AUTO" });
  });

  it("preserves moved node positions on update when node IDs still match", async () => {
    const { renderNewDocument, updateSelectedDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart LR\n  A[Start] --> B[Done]`));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    figmaMock.currentPage.children.push({ type: "WIDGET", id: "foreign-node", removed: false } as unknown as MockNode);
    const start = section.children.find((node) => node.name === "Node/A")!;
    start.x = 960;
    start.y = 420;

    figmaMock.currentPage.selection = [section];
    await updateSelectedDocument(payload(`flowchart LR\n  A[Start] --> B[Middle]\n  B --> C[Done]`));
    const replacementSection = figmaMock.currentPage.children.find((node) => node.type === "SECTION" && !node.removed)!;
    const preservedStart = replacementSection.children.find((node) => node.name === "Node/A")!;

    expect(preservedStart.x).toBe(960);
    expect(preservedStart.y).toBe(420);
    expect(replacementSection.width).toBeGreaterThan(preservedStart.x + preservedStart.width);
  });

  it("resets moved node positions when manual layout preservation is disabled", async () => {
    const { renderNewDocument, updateSelectedDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart LR\n  A[Start] --> B[Done]`));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const start = section.children.find((node) => node.name === "Node/A")!;
    start.x = 960;
    start.y = 420;

    figmaMock.currentPage.selection = [section];
    await updateSelectedDocument(payload(`flowchart LR\n  A[Start] --> B[Middle]\n  B --> C[Done]`, 24, 3, { manualLayout: "reset" }));
    const replacementSection = figmaMock.currentPage.children.find((node) => node.type === "SECTION" && !node.removed)!;
    const resetStart = replacementSection.children.find((node) => node.name === "Node/A")!;

    expect(resetStart.x).not.toBe(960);
    expect(resetStart.y).not.toBe(420);
  });

  it("keeps wide top-down fanout connectors on top-bottom magnets", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart TD
      A[Start] --> B[One]
      A --> C[Two]
      A --> D[Three]
      A --> E[Four]
      A --> F[Five]`));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const connectors = section.children.filter((node) => node.type === "CONNECTOR");

    expect(connectors).toHaveLength(5);
    expect(connectors.every((connector) => "magnet" in connector.connectorStart && connector.connectorStart.magnet === "BOTTOM")).toBe(true);
    expect(connectors.every((connector) => "magnet" in connector.connectorEnd && connector.connectorEnd.magnet === "TOP")).toBe(true);
  });

  it("scales connector and node line weights from selected font size", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart TD\n  A[Start] -->|ready| B[Done]`, 48));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const shape = section.children.find((node) => node.type === "SHAPE_WITH_TEXT")!;
    const connector = section.children.find((node) => node.type === "CONNECTOR")!;

    expect(shape.text.fontSize).toBe(48);
    expect(shape.strokeWeight).toBe(2);
    expect(connector.text.fontSize).toBe(44);
    expect(connector.strokeWeight).toBe(5);
  });

  it("colors nodes by graph depth up to the selected layer count", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart TD\n  A[Start] --> B[Step]\n  B --> C[Detail]\n  C --> D[Done]`, 24, 3));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const shapes = section.children.filter((node) => node.type === "SHAPE_WITH_TEXT");

    expect(shapes[0].fills).not.toEqual(shapes[1].fills);
    expect(shapes[1].fills).not.toEqual(shapes[2].fills);
  });

  it("uses a single default color when color layer count is one", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart TD\n  A[Start] --> B[Step]\n  B --> C[Done]`, 24, 1));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const shapes = section.children.filter((node) => node.type === "SHAPE_WITH_TEXT");

    expect(shapes[0].fills).toEqual(shapes[1].fills);
  });

  it("uses deterministic semantic priority before depth colors", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    await renderNewDocument(payload(`flowchart TD\n  A[Failed payment success] --> B[Done]`));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const failed = section.children.find((node) => node.name === "Node/A")!;

    expect(failed.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 227 / 255, b: 227 / 255 } }]);
  });

  it("renders journey insights with score summaries and bottleneck callouts", async () => {
    const { renderNewDocument } = await import("../plugin/main/renderer");
    const source = `journey\n  title Signup Journey\n  section Entry\n    Opens app: 5: User\n    Hits signup blocker: 2: User`;
    await renderNewDocument(mermaidJamPayload(source, 24, 3, { journeyView: "insights" }));
    const figmaMock = figma as unknown as ReturnType<typeof createMockFigma>;
    const section = figmaMock.currentPage.children[0];
    const renderedText = section.children.flatMap((node) => collectText(node));

    expect(renderedText).toEqual(expect.arrayContaining(["Steps 2", "Avg 3.5/5", "Lowest 2/5", "Blocks 1", "Bottleneck"]));
    expect(section.children.some((node) => node.name.startsWith("Journey/ScoreLine/"))).toBe(true);
  });
});

function collectText(node: MockNode): string[] {
  return [node.text.characters, ...node.children.flatMap((child) => collectText(child))].filter(Boolean);
}

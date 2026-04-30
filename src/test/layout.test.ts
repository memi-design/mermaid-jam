import { describe, expect, it } from "vitest";
import { parseMermaidFlowchart } from "../parser/mermaidJam";
import { computeGraphLayout } from "../shared/layout";
import { getStyleTokens } from "../shared/styles";

function graph(source: string) {
  const result = parseMermaidFlowchart(source, { theme: "blueprint", density: "compact" });
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.diagram;
}

describe("computeGraphLayout", () => {
  it("creates deterministic top-down layered positions", () => {
    const layout = computeGraphLayout(graph(`flowchart TD\n  A[Start] --> B[Middle]\n  A --> C[Other]\n  B --> D[Done]\n  C --> D`), getStyleTokens({ theme: "blueprint", density: "compact" }));
    expect(layout).toMatchInlineSnapshot(`
      {
        "edges": [
          {
            "end": {
              "x": 204,
              "y": 248,
            },
            "from": "A",
            "id": "edge-1",
            "label": undefined,
            "midpoint": {
              "x": 286,
              "y": 200,
            },
            "points": [
              {
                "x": 368,
                "y": 152,
              },
              {
                "x": 368,
                "y": 200,
              },
              {
                "x": 204,
                "y": 200,
              },
              {
                "x": 204,
                "y": 248,
              },
            ],
            "start": {
              "x": 368,
              "y": 152,
            },
            "style": "solid",
            "to": "B",
          },
          {
            "end": {
              "x": 532,
              "y": 248,
            },
            "from": "A",
            "id": "edge-2",
            "label": undefined,
            "midpoint": {
              "x": 450,
              "y": 200,
            },
            "points": [
              {
                "x": 368,
                "y": 152,
              },
              {
                "x": 368,
                "y": 200,
              },
              {
                "x": 532,
                "y": 200,
              },
              {
                "x": 532,
                "y": 248,
              },
            ],
            "start": {
              "x": 368,
              "y": 152,
            },
            "style": "solid",
            "to": "C",
          },
          {
            "end": {
              "x": 368,
              "y": 432,
            },
            "from": "B",
            "id": "edge-3",
            "label": undefined,
            "midpoint": {
              "x": 286,
              "y": 384,
            },
            "points": [
              {
                "x": 204,
                "y": 336,
              },
              {
                "x": 204,
                "y": 384,
              },
              {
                "x": 368,
                "y": 384,
              },
              {
                "x": 368,
                "y": 432,
              },
            ],
            "start": {
              "x": 204,
              "y": 336,
            },
            "style": "solid",
            "to": "D",
          },
          {
            "end": {
              "x": 368,
              "y": 432,
            },
            "from": "C",
            "id": "edge-4",
            "label": undefined,
            "midpoint": {
              "x": 450,
              "y": 384,
            },
            "points": [
              {
                "x": 532,
                "y": 336,
              },
              {
                "x": 532,
                "y": 384,
              },
              {
                "x": 368,
                "y": 384,
              },
              {
                "x": 368,
                "y": 432,
              },
            ],
            "start": {
              "x": 532,
              "y": 336,
            },
            "style": "solid",
            "to": "D",
          },
        ],
        "height": 584,
        "nodes": [
          {
            "height": 88,
            "id": "A",
            "lane": 0,
            "rank": 0,
            "width": 280,
            "x": 228,
            "y": 64,
          },
          {
            "height": 88,
            "id": "B",
            "lane": 0,
            "rank": 1,
            "width": 280,
            "x": 64,
            "y": 248,
          },
          {
            "height": 88,
            "id": "C",
            "lane": 1,
            "rank": 1,
            "width": 280,
            "x": 392,
            "y": 248,
          },
          {
            "height": 88,
            "id": "D",
            "lane": 0,
            "rank": 2,
            "width": 280,
            "x": 228,
            "y": 432,
          },
        ],
        "titleHeight": 0,
        "width": 736,
      }
    `);
  });

  it("creates deterministic left-right layered positions", () => {
    const layout = computeGraphLayout(graph(`flowchart LR\n  A[Start] --> B[Middle]\n  A --> C[Other]`), getStyleTokens({ theme: "minimal", density: "compact" }));
    expect(layout.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y }))).toEqual([
      { id: "A", x: 64, y: 132 },
      { id: "B", x: 440, y: 64 },
      { id: "C", x: 440, y: 200 },
    ]);
  });

  it("opens extra lane space for high-fanout branches", () => {
    const layout = computeGraphLayout(graph(`flowchart TD
      A[Start] --> B[One]
      A --> C[Two]
      A --> D[Three]
      A --> E[Four]
      A --> F[Five]`), getStyleTokens({ theme: "minimal", density: "compact" }));
    const branchNodes = layout.nodes
      .filter((node) => node.rank === 1)
      .sort((a, b) => a.x - b.x);
    const gaps = branchNodes.slice(1).map((node, index) => node.x - branchNodes[index].x - branchNodes[index].width);
    expect(Math.min(...gaps)).toBeGreaterThan(48);
  });
  it("applies deterministic layout presets without changing source direction", () => {
    const source = graph(`flowchart LR
      A[Start] --> B[Step]
      B --> C[Done]`);
    const compact = computeGraphLayout(source, getStyleTokens({ theme: "minimal", density: "compact", layoutPreset: "compact" }));
    const presentation = computeGraphLayout(source, getStyleTokens({ theme: "minimal", density: "compact", layoutPreset: "presentation" }));
    const print = computeGraphLayout(source, getStyleTokens({ theme: "minimal", density: "compact", layoutPreset: "print" }));

    expect(presentation.width).toBeGreaterThan(compact.width);
    expect(print.width).toBeGreaterThan(compact.width);
    expect(compact.nodes.map((node) => node.id)).toEqual(presentation.nodes.map((node) => node.id));
    expect(presentation.nodes[1].x).toBeGreaterThan(compact.nodes[1].x);
  });

  it("opens wider corridors for avoid-nodes and loop-friendly routing modes", () => {
    const source = graph(`flowchart TD
      A[Start] --> B[One]
      A --> C[Two]
      C --> A`);
    const elbow = computeGraphLayout(source, getStyleTokens({ theme: "minimal", density: "compact", routingMode: "elbow" }));
    const avoid = computeGraphLayout(source, getStyleTokens({ theme: "minimal", density: "compact", routingMode: "avoid-nodes" }));
    const loop = computeGraphLayout(source, getStyleTokens({ theme: "minimal", density: "compact", routingMode: "loop-friendly" }));

    expect(avoid.width).toBeGreaterThan(elbow.width);
    expect(loop.height).toBeGreaterThan(elbow.height);
  });

});

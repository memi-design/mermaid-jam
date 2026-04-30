import { describe, expect, it } from "vitest";
import { parseMermaidFlowchart, parseMermaidJamSource, serializeMermaidFlowchart } from "../parser/mermaidJam";

const copiedFlow = `flowchart TD
  Start["User opens Buzzr"]
  Loading["Loading Buzzr..."]
  BackendGate["Backend update message if app data is too old"]
  SessionCheck["Buzzr checks user state"]

  Start --> Loading
  Loading --> BackendGate
  Loading --> SessionCheck
  SessionCheck -->|Signed out| SignedOut["Signed out"]
  SessionCheck -- Guest session --> Guest["Guest session"]
  SessionCheck -.-> AccountIncomplete["Account exists but onboarding is incomplete"]
  Guest ==> MainTabs(("Main app tabs"))
`;

describe("parseMermaidFlowchart", () => {
  it("parses copied Mermaid flowchart syntax with nodes, labels, edge labels, comments, and edge styles", () => {
    const result = parseMermaidFlowchart(copiedFlow, { theme: "minimal", density: "compact" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid Mermaid graph");

    expect(result.diagram.direction).toBe("TD");
    expect(result.diagram.style).toMatchObject({ theme: "minimal", density: "compact", fontSize: 24, colorLayers: 3, layoutPreset: "compact", routingMode: "elbow", semanticMode: "auto", manualLayout: "preserve", journeyView: "clean" });
    expect(result.diagram.nodes).toEqual(expect.arrayContaining([
      { id: "Start", label: "User opens Buzzr", shape: "rectangle", sourceLine: 2 },
      { id: "Guest", label: "Guest session", shape: "rectangle", sourceLine: 11 },
      { id: "MainTabs", label: "Main app tabs", shape: "terminal", sourceLine: 13 },
    ]));
    expect(result.diagram.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "SessionCheck", to: "SignedOut", label: "Signed out", style: "solid" }),
      expect.objectContaining({ from: "SessionCheck", to: "Guest", label: "Guest session", style: "solid" }),
      expect.objectContaining({ from: "SessionCheck", to: "AccountIncomplete", style: "dotted" }),
      expect.objectContaining({ from: "Guest", to: "MainTabs", style: "thick" }),
    ]));
  });

  it("accepts fenced mermaid blocks and frontmatter titles", () => {
    const result = parseMermaidFlowchart(`\`\`\`mermaid
---
title: Buzzr auth
fontSize: 32
colorLayers: 4
---
graph LR
  A("Start") --> B{"Ready?"}
\`\`\``);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid Mermaid graph");
    expect(result.diagram.title).toBe("Buzzr auth");
    expect(result.diagram.direction).toBe("LR");
    expect(result.diagram.style).toMatchObject({ fontSize: 32, colorLayers: 4 });
    expect(result.diagram.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "A", label: "Start", shape: "rounded" }),
      expect.objectContaining({ id: "B", label: "Ready?", shape: "decision" }),
    ]));
  });

  it("formats clean source with canonical node declarations before edges", () => {
    const result = parseMermaidFlowchart(`flowchart TD
Start["Open app"]-->Next["Load"]
Next -- ready --> Done(("Done"))`);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid Mermaid graph");
    expect(result.diagram.cleanSource).toBe(`flowchart TD
  Start["Open app"]
  Next["Load"]
  Done((Done))

  Start --> Next
  Next -->|ready| Done`);
  });

  it("serializes user-provided section titles as clean frontmatter", () => {
    const result = parseMermaidFlowchart(`flowchart TD\n  A --> B`);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid Mermaid graph");

    expect(serializeMermaidFlowchart({ ...result.diagram, title: "Whole App Journey" })).toBe(`---
title: "Whole App Journey"
---
flowchart TD
  A
  B

  A --> B`);
  });

  it.each(["TD", "TB", "BT", "LR", "RL"] as const)("supports %s direction", (direction) => {
    const result = parseMermaidFlowchart(`flowchart ${direction}\n  A --> B`);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid Mermaid graph");
    expect(result.diagram.direction).toBe(direction);
  });

  it("returns line-level diagnostics for malformed input", () => {
    const result = parseMermaidFlowchart(`flow TD\n  A -->`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ line: 1, column: 1 });
  });

  it("rejects unsupported Mermaid features explicitly", () => {
    const result = parseMermaidFlowchart(`flowchart TD\n  subgraph Auth\n  A --> B\n  end`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("subgraphs"))).toBe(true);
  });

  it("reports unterminated labels and invalid edge targets", () => {
    const result = parseMermaidFlowchart(`flowchart TD\n  A[Missing close --> B`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Unterminated"))).toBe(true);
  });

  it("does not duplicate diagnostics for one malformed edge", () => {
    const result = parseMermaidFlowchart(`flowchart TD\n  A --> B[Missing`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Unterminated");
  });

  it("accepts rough text edge endpoints by converting them into stable node ids", () => {
    const result = parseMermaidFlowchart(`flowchart LR\n  Guest session --> Games tab opens`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid Mermaid graph");
    expect(result.diagram.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "GuestSession", label: "Guest session" }),
      expect.objectContaining({ id: "GamesTabOpens", label: "Games tab opens" }),
    ]));
    expect(result.diagram.edges).toEqual([expect.objectContaining({ from: "GuestSession", to: "GamesTabOpens" })]);
  });

  it("expands chained Mermaid edges into multiple graph edges", () => {
    const result = parseMermaidFlowchart(`\`\`\`mermaid
flowchart TD
  Start["Open Buzzr"]
  Loading["Loading"]
  SignIn["Sign in screen"]
  Guest["Tap Continue as guest"]
  Games["Games tab opens"]
  Explore["User can browse games"]
  BlockedAction["User taps Rate, Bookmark, Follow, Chat, or Profile action"]
  Join["Join Buzzr prompt"]
  Complete["Guest activation complete: user understands Buzzr is for games and buzz"]
  Drop["Drop-off risk: user thinks most of app is locked"]

  Start --> Loading --> SignIn --> Guest --> Games --> Explore --> Complete
  Explore --> BlockedAction --> Join --> Drop
\`\`\``);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid Mermaid graph");
    expect(result.diagram.nodes).toHaveLength(10);
    expect(result.diagram.edges).toHaveLength(9);
    expect(result.diagram.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "Start", to: "Loading" }),
      expect.objectContaining({ from: "Loading", to: "SignIn" }),
      expect.objectContaining({ from: "Explore", to: "Complete" }),
      expect.objectContaining({ from: "Explore", to: "BlockedAction" }),
      expect.objectContaining({ from: "Join", to: "Drop" }),
    ]));
  });
});

describe("parseMermaidJamSource", () => {
  it("accepts Mermaid journey blocks and converts them into a renderable userflow graph", () => {
    const result = parseMermaidJamSource(`\`\`\`mermaid
journey
  title Accessibility-conscious user checking control and readability
  section Setup
    Opens Settings: 5: User
    Enables reduce motion or high contrast: 5: User
    Adjusts autoplay/data saver: 5: User
  section Core use
    Scans dense game cards: 3: User
    Uses small icons and horizontal rails: 3: User
    Encounters drawers and prompts: 3: User
\`\`\``);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid journey");
    expect(result.diagram.title).toBe("Accessibility-conscious user checking control and readability");
    expect(result.diagram.direction).toBe("LR");
    expect(result.diagram.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Setup", shape: "rounded" }),
      expect.objectContaining({ label: "Opens Settings", shape: "terminal" }),
      expect.objectContaining({ label: "Core use", shape: "rounded" }),
      expect.objectContaining({ label: "Scans dense game cards", shape: "rounded" }),
    ]));
    expect(result.diagram.cleanSource).toContain("journey");
    expect(result.diagram.cleanSource).toContain("Opens Settings: 5: User");
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts markdown journey headings and bullets", () => {
    const result = parseMermaidJamSource(`# New Casual Fan

## Entry
- Sees sign-in screen
- Taps Continue as guest

## First value
- Lands on Games
- Opens a game card

Primary success: finds a game within 60 seconds.`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid markdown journey");
    expect(result.diagram.title).toBe("New Casual Fan");
    expect(result.diagram.direction).toBe("LR");
    expect(result.diagram.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Entry" }),
      expect.objectContaining({ label: "Taps Continue as guest" }),
      expect.objectContaining({ label: "First value" }),
    ]));
    expect(result.diagram.journey?.notes).toEqual(["Primary success: finds a game within 60 seconds."]);
  });

  it("converts sequenceDiagram messages into an ordered FigJam graph", () => {
    const result = parseMermaidJamSource(`sequenceDiagram
  participant U as User
  participant A as App
  U->>A: Opens app
  A-->>U: Shows home`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid sequence diagram");
    expect(result.diagram.kind).toBe("sequence");
    expect(result.diagram.direction).toBe("TD");
    expect(result.diagram.nodes.map((node) => node.label)).toEqual([
      "User → App\nOpens app",
      "App → User\nShows home",
    ]);
    expect(result.diagram.edges).toHaveLength(1);
  });

  it("converts stateDiagram transitions into editable state flow nodes", () => {
    const result = parseMermaidJamSource(`stateDiagram-v2
  [*] --> SignedOut
  SignedOut --> Loading: Sign in
  Loading --> Home: success
  Home --> [*]`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid state diagram");
    expect(result.diagram.kind).toBe("state");
    expect(result.diagram.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Start", shape: "terminal" }),
      expect.objectContaining({ id: "SignedOut", label: "SignedOut" }),
      expect.objectContaining({ label: "End", shape: "terminal" }),
    ]));
    expect(result.diagram.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "SignedOut", to: "Loading", label: "Sign in" }),
    ]));
  });

  it("converts mindmap indentation into a left-to-right tree", () => {
    const result = parseMermaidJamSource(`mindmap
  Buzzr
    Auth
      Sign in
      Guest
    Games
      Browse`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid mindmap");
    expect(result.diagram.kind).toBe("mindmap");
    expect(result.diagram.direction).toBe("LR");
    expect(result.diagram.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(["Buzzr", "Auth", "Sign in", "Guest", "Games", "Browse"]));
    expect(result.diagram.edges.length).toBeGreaterThanOrEqual(5);
  });

  it("converts timeline events into a horizontal event flow", () => {
    const result = parseMermaidJamSource(`timeline
  title Launch plan
  section Beta
    Apr : Invite testers
    May : Fix onboarding`);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid timeline");
    expect(result.diagram.kind).toBe("timeline");
    expect(result.diagram.title).toBe("Launch plan");
    expect(result.diagram.nodes.map((node) => node.label)).toEqual([
      "Apr\nBeta: Invite testers",
      "May\nBeta: Fix onboarding",
    ]);
  });

  it("returns explicit diagnostics for recognized Mermaid types that are not safely convertible yet", () => {
    const result = parseMermaidJamSource(`pie
  title Traffic
  "Search" : 40`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toContain("recognized but is not safely convertible");
  });
});

# Changelog

## 0.1.0

- Initial publish candidate.
- Converts Mermaid `flowchart` / `graph`, `journey`, `sequenceDiagram`, `stateDiagram`, `mindmap`, `timeline`, and markdown userflow notes into editable native FigJam diagrams.
- Uses a cleaner print-friendly visual system with light surfaces, thin strokes, regular text, and subtle journey score visualization.
- Adds deterministic layout presets: Compact, Readable, Presentation, Print, Wide Map, and Deep Tree.
- Adds connector routing controls: Direct, Elbow, Avoid Nodes, More Spacing, and Loop Friendly.
- Adds deeper semantic styling with automatic category priorities plus local custom keyword rules.
- Preserves manually moved generated cards on update when node IDs still match.
- Adds Journey Clean, Scores, and Insights views with stage averages, bottlenecks, and score summaries.
- Generates FigJam sections, shape cards, and dynamic elbow connectors.
- Supports line-level syntax diagnostics, stronger local source revision, formatting, load selection, and update-in-place.
- Ships as a local-only plugin with no network access.

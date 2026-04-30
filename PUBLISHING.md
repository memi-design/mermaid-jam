# Publishing Mermaid Jam

Mermaid Jam is ready to submit as a local-only FigJam plugin. The plugin does not use network access, AI services, analytics, or external assets.

## Preflight

Run:

```bash
npm run publish:check
```

This validates:

- TypeScript, tests, production build, and inline UI bundle integrity.
- `manifest.json` has the assigned plugin ID `1631708567749401678`.
- `manifest.json` uses `editorType: ["figma", "figjam"]` so it can be imported from Figma, while generation remains FigJam-native.
- `documentAccess` is `dynamic-page`.
- `networkAccess.allowedDomains` is `["none"]`.
- The built plugin contains no removed Ollama/network code.
- The main bundle does not contain import syntax rejected by Figma's plugin sandbox.

## Figma Community Submission

Publish from the Figma desktop app:

1. Open a FigJam file in the Figma desktop app.
2. Go to **Plugins > Development > Import plugin from manifest...**.
3. Select `plugin/manifest.json`.
4. Test generate, update, load selection, revise, and dragging connected nodes.
5. Go to **Plugins > Manage plugins**.
6. Select **🧜‍♀️🍓 Mermaid Jam** and choose **Publish**.
7. Confirm the plugin ID matches `1631708567749401678`.

Community assets are in `community-assets/`:

- `icon.png`: pixel-mermaid app icon.
- `cover.png`: product cover image showing Mermaid Jam working.

Use the PNGs directly in Figma Community where image uploads are required.

## Listing Copy

Name:

```text
🧜‍♀️🍓 Mermaid Jam
```

Tagline:

```text
Paste Mermaid or markdown and generate editable FigJam userflows.
```

Short description:

```text
Mermaid Jam converts Mermaid flowcharts, journeys, sequence diagrams, state diagrams, mindmaps, timelines, and markdown userflow notes into native FigJam cards and connectors. Paste a diagram, revise/format it locally, generate a section, and update it later from the stored source.
```

Long description:

```text
Mermaid Jam is a local-only FigJam plugin for turning pasted Mermaid and markdown source into clean, editable FigJam diagrams.

It creates native FigJam shape cards and connector nodes, so generated output remains editable. The plugin supports Mermaid flowcharts, journeys, sequence diagrams, state diagrams, mindmaps, timelines, markdown headings/bullets, line-level diagnostics, deterministic layout presets, connector routing controls, semantic styling controls, journey visualization modes, section-based generation, update-in-place with manual layout preservation, selection reload, and a local Revise action for cleaning pasted source.

No network requests, no analytics, no AI service, and no external backend are used.
```

Suggested category:

```text
Diagramming
```

Suggested tags:

```text
FigJam, Mermaid, Flowchart, Journey map, Sequence diagram, State diagram, Mindmap, Timeline, User flow, Diagram, Product design
```

Privacy note:

```text
Mermaid Jam runs locally in FigJam. It does not collect, transmit, store externally, or sell user data.
```

## Manual Acceptance Checklist

- Import `plugin/manifest.json` without manifest errors.
- Paste raw Mermaid flowcharts, journeys, sequence diagrams, state diagrams, mindmaps, timelines, fenced Mermaid, and markdown userflow notes.
- Confirm syntax diagnostics are line-level and readable.
- Click `Revise` on rough input and confirm it updates only the editor.
- Click `Generate` and confirm output is inside a FigJam section.
- Drag generated cards and confirm connectors remain attached.
- Select generated section or child node, click `Load`, edit source, then `Update`.
- Move a generated card, keep `Preserve moved`, update, and confirm the matching node ID keeps its position.
- Try Layout, Routing, Semantics, and Journey View controls and confirm output remains inside the section.
- Confirm no network warnings appear in the console.

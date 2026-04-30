# Contributing

Mermaid Jam is intentionally local-only and FigJam-native. Contributions should keep that constraint intact.

## Development

```bash
npm install
npm run check
```

## Rules

- No network calls, analytics, hosted services, Supabase, or account systems.
- Generated output should stay editable as native FigJam nodes.
- Parser changes should return line-level diagnostics instead of silently guessing.
- Layout changes should be deterministic and covered by tests.
- UI changes should stay flat, compact, accessible, and print-friendly.

## Good First Areas

- More Mermaid syntax adapters.
- Better deterministic layout snapshots.
- More semantic styling categories.
- More journey-map visualization modes.
- Better diagnostics for malformed Mermaid.

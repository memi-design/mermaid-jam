# Security Policy

Mermaid Jam is local-only and declares `networkAccess.allowedDomains: ["none"]` in the Figma plugin manifest.

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting A Vulnerability

Open a private security advisory on GitHub if available, or email the support contact listed in the Figma Community plugin page.

Please include:

- Plugin version or commit SHA.
- Steps to reproduce.
- Whether the issue involves source storage, generated FigJam nodes, or build artifacts.

## Security Principles

- No backend services.
- No analytics.
- No network access from the plugin.
- No user accounts.
- Source is stored only in Figma plugin data on generated diagram nodes when small enough to safely store.

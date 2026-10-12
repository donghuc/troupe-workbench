# Security

Troupe runs AI agents that read and edit files on your Mac, so please report anything that lets an agent, a project file, or a reply reach beyond what the permission mode allows: path escapes outside the project roots, the renderer reaching privileged APIs other than through the preload bridge, a `wbfile://` or link that opens an arbitrary file, prompt content that changes the allow-list, and similar.

Report privately by opening a **GitHub Security Advisory** on this repository (Security ▸ Report a vulnerability) rather than a public issue. You'll get an acknowledgement within a week; this is a single-maintainer project, so fixes ship as fast as one person can manage.

Out of scope: behaviour of the vendor CLIs themselves (Claude Code, Codex, Grok, Antigravity) and of MCP servers you add — report those upstream. Full access mode deliberately disables the CLIs' sandboxes; that is documented, not a vulnerability.

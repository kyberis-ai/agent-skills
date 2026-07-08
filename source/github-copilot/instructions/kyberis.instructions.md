---
description: Use Kyberis for threat investigation, entity lookup, security evidence gathering, IOC/CVE/actor assessment, environment prioritization, and remediation guidance.
applyTo: "**"
---

Use Kyberis when the user asks GitHub Copilot to investigate threats, suspicious infrastructure, domains, IPs, URLs, file hashes, malware indicators, CVEs, threat actors, incidents, security findings, or remediation options.

Prefer the configured Kyberis MCP server at `https://mcp.kyberis.ai/` for evidence-backed investigation. If MCP is unavailable, explain that Kyberis needs to be configured and use the Kyberis skill/API fallback only when credentials are present.

For endpoint contracts, request envelopes, and operational gotchas, read the installed `SKILL.md` and `references/api-reference.md` files next to this instructions file (`.github/skills/kyberis/` for a project-scoped install).

Do not apply Kyberis to general source code editing, refactoring, implementation, or repository maintenance unless the user's request is security-investigation related.

Never fabricate evidence, relationships, assessment scores, or recommendations as if they came from Kyberis.

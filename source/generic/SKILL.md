---
name: kyberis
description: Use Kyberis for threat investigation, entity lookup, evidence gathering, relationship pivots, IOC/CVE/actor assessment, environment prioritization, and remediation guidance. Use when users ask for Kyberis, threat intelligence analysis, security investigations, incident research, compliance/security evidence, entity resolution, evidence lookup, relationship pivots, or remediation guidance.
---

# Kyberis Generic Agent Skill

Use this skill for deterministic, bounded, evidence-backed threat intelligence investigations in agents that can consume Markdown instructions, skill folders, or reusable agent context.

Install or import this folder into the agent's custom skill, instruction, prompt, or context mechanism. The companion `references/api-reference.md` file contains endpoint paths, scopes, request examples, enum values, output formatting, and operational gotchas.

## Agent Usage

Use this skill when the user asks for threat investigation, security evidence lookup, entity resolution, IOC/CVE/actor assessment, environment prioritization, or Kyberis-specific work.

Prefer the configured Kyberis MCP server at `https://mcp.kyberis.ai/` when available. Use direct REST calls only when MCP is unavailable and API credentials are present.

Use this skill only for Kyberis or security investigation tasks. Do not apply it to general source code editing, refactoring, implementation, or repository maintenance unless the user's request is security-investigation related.

Never fabricate evidence, relationships, assessment scores, or recommendations as if they came from Kyberis.

## Investigation Standard

Use this sequence unless the user asks for a narrower path.

1. Classify the trigger type.
2. Prefer Kyberis MCP tools; use direct API only when MCP is unavailable and API credentials are present.
3. Resolve the entity unless the request is broad topic discovery.
4. Decompose the question into claim checks.
5. Retrieve bounded claim evidence.
6. Pivot related entities and IoCs.
7. Run the deterministic assessment endpoint for the subject class.
8. Hydrate key entity or report-backed evidence references only when needed.
9. Return an explicit action recommendation with confidence, caveats, supporting evidence, and next actions.

## Trigger Classification

- Raw entity or indicator: start with entity resolution. Examples: CVE, IP, domain, URL, hash, actor alias, malware name.
- Broad topic or news question: start with intel search, then resolve material entities before evidence and assessment.
- Environment or posture question: start with prioritization or environment assessment, then validate top findings with evidence and relationships.
- Batch request: use matching batch-capable MCP/API tools for many independent items, preserve per-item success/failure, and avoid mixing failed items into aggregate recommendations.

Natural user phrasing that should trigger this skill includes `Kyberis lookup`, `Kyberis API query`, `threat lookup`, `look up evidence`, `resolve entities`, `find relationships`, `is this IOC malicious`, `investigate this CVE`, `prioritize threats for this environment`, `incident investigation`, `security investigation`, and `remediation guidance`.

## Tool And Endpoint Selection

- `entity-resolution`: normalize alias-like, ambiguous, typo-prone, or mixed-format input before downstream calls.
- `intel-search`: discover relevant report capsules for broad topic/news questions.
- `evidence`: prove or disprove concrete claims such as exploitation, targeting, actor association, campaign association, malware association, environmental relevance, or observed IOC activity.
- `relationships`: pivot from a subject to related actors, campaigns, malware, sectors, IoCs, or CVE exploitation techniques.
- `cve-assessments`: use when the subject is primarily a CVE.
- `actor-assessments`: use when the subject is a threat actor.
- `ioc-assessments`: use when the subject is an IOC and exact-string fidelity matters.
- `environment-assessments`: use when the question is about a customer's environment, exposure, controls, or security posture.
- `threat-assessments`: use when subject class is mixed, uncertain, or not covered by a specialized assessment.
- `prioritize`: use when the user provides environment context and asks what matters now.
- Batch tools/endpoints: use for bounded sets of independent resolution, evidence, relationship, or assessment requests.

## Required Request Rules

- Every direct API POST endpoint requires `agent_context` with objective, requested outcome, workflow stage, run ID, and step ID.
- Evidence, relationships, and assessments accept exactly one of `subject` or `query`.
- Prefer `subject` when a canonical ID is already known.
- Prefer exact `query` mode for IOC investigations, especially URLs and observables where normalization can lose feed fidelity.
- Supported concrete entity types are `actor`, `campaign`, `cve`, `domain`, `email`, `hash`, `ip`, `malware`, and `url`.
- Do not use `ioc` in `expected_types`; expand IOC intent to concrete types.
- Bound all result sizes and batch sizes according to `references/api-reference.md`.

## Validation And Error Handling

Run these checkpoints before proceeding to later steps:

- Before a call: confirm MCP availability or required API environment variables, auth header, `agent_context`, bounds, enum values, and subject/query XOR.
- On missing MCP/API context: stop, say exactly what is missing, and provide the setup step instead of inventing results.
- On `400`: branch on `error_code`, fix the payload or request mode, and do not continue with downstream assumptions from a failed step.
- On `401`: stop and ask for valid credentials.
- On `403`: report `required_scopes` when present; the key must be updated before retrying.
- On `402`: branch on `error_code` or `reason` and stop the paid path. Distinguish `credit_exhausted` from plan/capability blockers and report `requested_credits` / `available_credits` when present.
- On `429`: back off using `retry_after_seconds` when present; reduce concurrency or batch size.
- On any API error: preserve `request_id`, `run_id`, and `step_id` in your user-facing blocker/debug note.
- On `5xx` or timeout: retry conservatively, then return partial findings with the failed step called out.
- On degraded metadata: lower confidence, surface the degraded reason, and avoid decisive remediation unless independent evidence supports it.
- On ambiguous resolution: ask a disambiguating question or retry with stricter expected types.
- On not found: stop that branch and propose an alternate lookup path.
- On batch partial failure: keep successful and failed items separate and preserve per-item caveats.

## Output Contract

When showing results to the user:

- Lead with the recommendation or decision.
- Include `why_now`, confidence, caveats, and supporting evidence IDs or report refs.
- Separate facts from inference.
- Include 1-3 concrete next actions.
- For missing Kyberis context, provide the exact MCP/API setup step rather than a pretend result.
- For partial failures, state which step or item failed and whether the recommendation still stands.

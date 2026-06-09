---
name: kyberis
description: Queries Kyberis to resolve entities, collect evidence, pivot relationships, prioritize threats, run assessments, and produce remediation recommendations. Use when users ask for Kyberis, threat lookups, incident investigations, evidence lookup, or security guidance.
---

# Kyberis Skill

Use this skill to run deterministic, evidence-backed Kyberis threat investigations from an initial trigger to an actionable recommendation.

## Required Environment

Preferred path:

- If MCP server `kyberis` is connected and healthy in the session, use MCP tools for Kyberis operations.
- Use direct HTTP only when MCP is unavailable or explicitly requested by the user.

Direct HTTP fallback environment:

- `KYBERIS_BASE_URL` (example: `https://api.kyberis.ai`)
- `KYBERIS_API_KEY_ID`
- `KYBERIS_API_KEY_SECRET`
- `KYBERIS_TIMEOUT_SECONDS` (optional, default `20`)
- `KYBERIS_MAX_RETRIES` (optional, default `2`)

Direct HTTP auth header:

`Authorization: ApiKey <KYBERIS_API_KEY_ID>:<KYBERIS_API_KEY_SECRET>`

Never print raw key material in outputs.

## Investigation Standard

Use this sequence unless the user asks for a narrower path.

1. Classify the trigger.
2. Resolve the entity unless the request is broad discovery.
3. Decompose the question into claim-level checks.
4. Retrieve bounded claim evidence.
5. Pivot related entities and IoCs.
6. Run the deterministic assessment endpoint appropriate for the subject.
7. Hydrate key references when high-impact findings depend on entity or report detail.
8. Return an explicit recommendation with confidence, caveats, supporting evidence, and next actions.

## Trigger Classification

- Raw indicator or entity-like input (`CVE-...`, IP, domain, URL, hash, actor alias): start with `entity-resolution`.
- Broad topical question (`what happened with X`, `tell me about X`): start with `intel-search`, then resolve material entities.
- Environment triage request (`what should we care about now`, stack/industry/region priority request): start with `prioritize`, then investigate top signals.
- Batch IOC/entity request: use batch-capable MCP tools when available; otherwise process bounded chunks and preserve per-item uncertainty.

## Tool Selection

- `entity-resolution`: normalize messy input and handle `resolved`, `ambiguous`, or `not_found` before downstream calls.
- `intel-search`: discover relevant report capsules for broad or recent-event questions.
- `evidence`: prove or disprove specific claims such as `active_exploitation`, `sector_targeting`, or `observed_in_the_wild`.
- `relationships`: pivot from a subject to related actors, campaigns, malware, sectors, IoCs, or CVE exploitation techniques.
- `cve-assessments`: produce deterministic CVE decision support.
- `actor-assessments`: produce deterministic actor-focused risk guidance.
- `ioc-assessments`: produce deterministic IOC-focused risk guidance; preserve exact IOC strings.
- `threat-assessments`: use when subject class is mixed, uncertain, or not covered by a specialized assessment.
- `prioritize`: rank environment-relevant threats before deep-diving top items.
- `environment-assessments`: assess a customer's environment when this endpoint is available through MCP or direct HTTP.

See `references/api-reference.md` for endpoint paths, scopes, limits, controlled vocabularies, and failure handling.

## Playbooks

### IOC-First Investigation

Use when the trigger is an observable from alerting, SIEM, EDR, firewall, or email.

1. Resolve the IOC to validate type and canonical form.
2. Pull relationships for actor, campaign, malware, sector, IOC, and technique linkages.
3. Pull claim evidence for top linked entities.
4. Run `ioc-assessments` or `threat-assessments`.
5. If subject-mode evidence or assessment returns weak/no-match signal but resolution was exact, retry once with exact IOC `query` mode before finalizing.

### CVE-First Investigation

Use when the trigger is a CVE or product vulnerability mention.

1. Resolve the CVE if the identifier or product mention is uncertain.
2. Retrieve `active_exploitation` evidence.
3. Retrieve sector/environment relevance evidence.
4. Pull actor, campaign, malware, and technique relationships.
5. Run `cve-assessments` for the recommendation.

### Actor-First Investigation

Use when the trigger is an actor alias or name.

1. Resolve the actor alias.
2. Pull relationships to campaigns, malware, techniques, and IoCs.
3. Pull evidence for current activity and relevance.
4. Run `actor-assessments` or `threat-assessments`.

### Open-Ended Topic Or News Question

Use when the user asks broad discovery questions.

1. Start with `intel-search`.
2. Select top candidate entities and resolve them.
3. For each material subject, run evidence, relationships, and the relevant assessment.
4. State what is known, what is inferred, and what remains uncertain.

### Environment Triage

Use when the user provides stack, industry, geography, or business context and asks what matters now.

1. Run `prioritize`.
2. Validate the top 1-3 items with evidence and relationships.
3. Run the relevant assessment for each material item.
4. Return an action plan by item: `patch`, `validate_exposure`, `hunt`, `monitor`, `review_controls`, or `ignore`.

## Claim Decomposition

If a user asks a compound question, split it into subclaims and test each with `evidence`.

Example: "Is CVE-X actively exploited by actors targeting healthcare?"

- Claim A: `active_exploitation`
- Claim B: `sector_targeting` with healthcare context
- Optional Claim C: `actor_association`

Do not hide uncertainty inside one broad answer. Subclaims make confidence and evidence gaps explicit.

## Decision Gates

- If resolution is `ambiguous`: ask a disambiguation question or retry with stricter `expected_types`.
- If resolution is `not_found`: stop, explain the gap, and propose an alternate lookup path.
- If a POST call fails with validation errors: fix the payload or `agent_context` before proceeding.
- If access fails with auth, PLG limit, quota, or scope errors: branch on `error_code` or `reason`, do not retry blindly, and report the blocker plus any required scope/action.
- If rate-limited or a transient server failure occurs: retry conservatively with backoff, using `retry_after_seconds` when present.
- Preserve `request_id`, `run_id`, and `step_id` from error payloads when reporting failed calls.
- If evidence is weak or sparse: state low confidence and recommend low-cost validation.
- If high-confidence exploitation plus environment match is present: recommend immediate remediation or exposure validation.

## Required Agent Behavior

- Prefer MCP tools over direct REST calls.
- Include valid `agent_context` on every POST call.
- For `expected_types`, use only concrete entity types: `actor`, `campaign`, `cve`, `domain`, `email`, `hash`, `ip`, `malware`, `url`.
- Do not pass `ioc` in `expected_types`; expand IOC intent to concrete types such as `ip`, `domain`, `url`, `email`, and `hash`.
- Bound payloads with documented limits.
- Never guess across ambiguity.
- Separate facts from inference in final output.
- Never output a decisive remediation recommendation without supporting evidence IDs or report refs.

## Final Output Contract

Every investigation result should contain:

- `recommendation`: clear next action a human can execute now.
- `why_now`: concise risk justification tied to evidence.
- `confidence`: match/assessment confidence and key caveats.
- `supporting_evidence`: bounded IDs or refs used for the decision.
- `next_actions`: 1-3 concrete follow-ups.

## Direct HTTP Helper

Helper command:

`node .codex/skills/kyberis/bin/kyberis-client.mjs <command> --json '<payload>'`

Supported wrappers:

- `entity-resolution`
- `threat-assessment`
- `ioc-assessment`
- `cve-assessment`
- `claim-evidence`
- `relationships`
- `intel-search`
- `prioritize`
- `hunt-pivots`

Use `node .codex/skills/kyberis/bin/kyberis-client.mjs --help` for command syntax.

## Reference

- `references/api-reference.md`: endpoint contract matrix, scopes, limits, controlled vocabularies, hydration headers, batch notes, and operational gotchas.

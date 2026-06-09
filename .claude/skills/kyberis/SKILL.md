---
name: kyberis
description: Queries the Kyberis API to resolve entities, look up evidence, find relationships, prioritize threats, run structured assessments, and produce security recommendations. Use when users ask for Kyberis, Kyberis API, threat intelligence analysis, security investigations, incident research, compliance/security evidence, entity resolution, evidence lookup, relationship pivots, or remediation guidance.
---

# Kyberis Skill

Use this skill for deterministic, bounded, evidence-backed threat intelligence investigations with the Kyberis agent API at `/v2/*`.

Keep `SKILL.md` focused on selecting the right workflow and handling failures. Load `references/api-reference.md` when you need exact endpoint paths, scopes, request examples, enum values, output formatting, or detailed gotchas.

## Investigation Standard

Use this sequence unless the user asks for a narrower path.

1. Classify the trigger type.
2. Resolve the entity unless the request is broad topic discovery.
3. Decompose the question into claim checks.
4. Retrieve bounded claim evidence.
5. Pivot related entities and IoCs.
6. Run the deterministic assessment endpoint for the subject class.
7. Hydrate key entity or report-backed evidence references only when needed.
8. Return an explicit action recommendation with confidence, caveats, supporting evidence, and next actions.

## Trigger Classification

- Raw entity or indicator: start with `entity-resolution`. Examples: CVE, IP, domain, URL, hash, actor alias, malware name.
- Broad topic or news question: start with `intel-search`, then resolve material entities before evidence and assessment.
- Environment or posture question: start with `prioritize` or `environment-assessments`, then validate top findings with evidence and relationships.
- Hunt-next-step question: use `hunt-pivots` when the user has weak telemetry or wants next investigative actions, then execute the returned query intent in customer telemetry.
- Batch request: use the matching batch endpoint for many independent items, preserve per-item success/failure, and avoid mixing failed items into aggregate recommendations.

Natural user phrasing that should trigger this skill includes `look up evidence`, `resolve this entity`, `find relationships`, `what should we hunt next`, `what should we patch`, `is this IOC malicious`, `investigate this CVE`, `prioritize threats for this environment`, `Kyberis lookup`, and `Kyberis API query`.

## Endpoint Selection

- `POST /v2/entity-resolution`: use for alias-like, ambiguous, typo-prone, or mixed-format input. Canonical IDs reduce downstream ambiguity.
- `POST /v2/intel-search`: use for broad topic/news discovery before choosing investigation subjects.
- `POST /v2/evidence`: use to prove or disprove concrete claims such as exploitation, targeting, actor association, campaign association, malware association, environmental relevance, or observed IOC activity.
- `POST /v2/relationships`: use to pivot from a subject to related actors, campaigns, malware, sectors, IoCs, or CVE exploitation techniques.
- `POST /v2/cve-assessments`: use when the subject is primarily a CVE.
- `POST /v2/actor-assessments`: use when the subject is a threat actor.
- `POST /v2/ioc-assessments`: use when the subject is an IOC and exact-string fidelity matters.
- `POST /v2/environment-assessments`: use when the question is about a customer's environment, exposure, controls, or security posture.
- `POST /v2/threat-assessments`: use when subject class is mixed, uncertain, or not covered by a specialized assessment.
- `POST /v2/prioritize`: use when the user provides environment context and asks what matters now.
- `POST /v2/hunt-pivots`: use when the agent needs ranked next investigative actions for a resolved subject or weak observation.
- Batch endpoints: use for bounded sets of independent resolution, evidence, relationship, or assessment requests.

## Required Request Rules

- Every agent POST endpoint requires `agent_context` with objective, requested outcome, workflow stage, run ID, and step ID.
- Evidence, relationships, and assessments accept exactly one of `subject` or `query`.
- Prefer `subject` when a canonical ID is already known.
- Prefer exact `query` mode for IOC investigations, especially URLs and observables where normalization can lose feed fidelity.
- Supported concrete entity types are `actor`, `campaign`, `cve`, `domain`, `email`, `hash`, `ip`, `malware`, and `url`.
- Do not use `ioc` in `expected_types`; expand IOC intent to concrete types.
- Bound all result sizes and batch sizes according to `references/api-reference.md`.

Minimal direct-call example:

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/entity-resolution" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {
      "objective": "Resolve actor input for investigation",
      "requested_outcome": "canonical actor id",
      "workflow_stage": "resolve",
      "run_id": "run-001",
      "step_id": "resolve-actor"
    },
    "query": "Charming Kitten",
    "expected_types": ["actor"],
    "resolution": {"max_results": 5}
  }' | jq .
```

## Validation And Error Handling

Run these checkpoints before proceeding to later steps:

- Before a call: confirm required environment variables, auth header, `agent_context`, bounds, enum values, and subject/query XOR.
- On `400`: branch on `error_code`, fix the payload or request mode, and do not continue with downstream assumptions from a failed step.
- On `401`: stop and ask for valid credentials.
- On `403`: report `required_scopes` when present; the key must be updated before retrying.
- On `402`: branch on `error_code` or `reason` and stop the paid path. Distinguish `credit_exhausted` from plan/capability blockers and report `requested_credits` / `available_credits` when present.
- On `429`: back off using `retry_after_seconds` when present; reduce concurrency or batch size.
- On any API error: preserve `request_id`, `run_id`, and `step_id` in your user-facing blocker/debug note.
- On `5xx` or timeout: retry conservatively, then return partial findings with the failed step called out.
- On degraded metadata: lower confidence, surface the degraded reason, and avoid decisive remediation unless independent evidence supports it.
- On ambiguous resolution: ask a disambiguating question or retry with stricter `expected_types`.
- On `not_found`: stop that branch and propose an alternate lookup path.
- On batch partial failure: keep successful and failed items separate and preserve per-item caveats.

## Common Workflows

### Score A CVE End-To-End

1. Resolve the CVE unless the canonical ID is already known.
2. If resolution is ambiguous or not found, handle that before continuing.
3. Retrieve `active_exploitation` evidence.
4. Run `cve-assessments` for structured priority and recommendation.
5. Pull relationships for actor, malware, campaign, and technique context.
6. Hydrate report-backed evidence only when needed for high-impact claims.

### Build A Prioritized Feed For An Environment

1. Run `prioritize` with bounded environment context.
2. If quota, scope, or validation errors occur, stop and report the blocker before scoring.
3. Score top items with `assessments/batch` when available.
4. Hydrate report-backed evidence cited by top recommendations.
5. Return ranked actions with confidence and any degraded/partial-result caveats.

### Investigate An Actor By Name

1. Resolve the actor alias with `expected_types=["actor"]`.
2. If multiple candidates are plausible, disambiguate before pivoting.
3. Pull relationships to malware, campaigns, sectors, and IoCs.
4. Run `actor-assessments` for structured risk/action output.
5. Retrieve evidence for current activity or sector targeting claims.

### Investigate From IOC Trigger

1. Resolve the IOC for normalization and type validation.
2. Pull relationships for IOC, actor, campaign, and malware context.
3. Retrieve evidence using exact IOC `query` mode first.
4. Run `ioc-assessments` using exact IOC `query` mode.
5. If subject-mode was used and results are unexpectedly weak after exact resolution, retry once with exact `query` mode before final recommendation.

### Environment Assessment

1. Confirm the user supplied at least one environment signal such as sector, regions, exposure, controls, patch latency, or critical asset exposure.
2. Run `environment-assessments` for posture-specific scoring.
3. Validate high-impact recommendations with evidence, relationships, or prioritized items where applicable.
4. If dependency or degraded metadata appears, include it in confidence and next actions.

## Output Contract

When showing results to the user:

- Lead with the recommendation or decision.
- Include `why_now`, confidence, caveats, and supporting evidence IDs or report refs.
- Separate facts from inference.
- Include 1-3 concrete next actions.
- For partial failures, state which step or item failed and whether the recommendation still stands.

## Reference

Load `references/api-reference.md` for:

- Base URL, authentication, and required environment variables.
- Full endpoint and scope reference.
- Exact curl examples and request envelopes.
- Claim types, relationship types, assessment types, categories, and field caps.
- Output formatting details.
- Operational gotchas and failure handling details.

# Kyberis API Reference

Load this reference when you need exact endpoint contracts, curl examples, enum values, output formatting rules, or detailed operational gotchas while using a Kyberis agent skill.

## Error Handling And Validation Checkpoints

Use these before continuing to later workflow steps:

- Branch on `error_code` first, then `reason`, then HTTP status. Preserve `request_id`, `run_id`, and `step_id` in blocker/debug notes.
- `400` validation error: stop the current step, fix the payload shape, check `agent_context`, confirm subject/query XOR, bounds, enum values, and required environment fields, then retry once.
- `401` auth error: stop and ask for valid API credentials; do not retry with the same key material.
- `403` scope error: stop and report `required_scopes`; the API key must be reissued or updated before the endpoint can be called.
- `402` PLG/quota/credit error: stop the paid path and inspect `error_code` or `reason`. Distinguish `credit_exhausted` from plan/capability blockers and report `requested_credits` / `available_credits` when present.
- `429` rate limit: back off using `retry_after_seconds` when present; do not issue tight retries or expand batch size.
- `batch_limit_exceeded`: reduce batch size to the reported plan limit before retrying.
- `5xx` or network timeout: retry conservatively within `KYBERIS_MAX_RETRIES`; if still failing, return partial findings and the failed step.
- Dependency/degraded response metadata: surface `degraded` or `degraded_reasons`, lower confidence, and avoid decisive recommendations unless supporting evidence is still strong.
- Batch partial failure: keep per-item results separate, report failed item IDs/queries, and continue only when remaining successful items are sufficient for the user objective.

## Base URL and Authentication

Base URL: `$KYBERIS_BASE_URL` (for example: `https://api.kyberis.ai`)

Auth header (every API endpoint call):

```bash
Authorization: ApiKey YOUR_KEY_ID:YOUR_SECRET
```

Required environment variables:

```bash
export KYBERIS_BASE_URL=https://api.kyberis.ai
export KYBERIS_API_KEY_ID=<key_id>
export KYBERIS_API_KEY_SECRET=<key_secret>
```

Optional:

```bash
export KYBERIS_TIMEOUT_SECONDS=20
export KYBERIS_MAX_RETRIES=2
```

Do not read API credentials from local files. If required env vars are missing,
ask the user to provide them.

## Required envelope: agent_context

Every agent endpoint (evidence, resolution, assessments, relationships,
prioritize, and batches) requires an `agent_context` block on the request
body. Minimum fields:

```bash
# agent_context envelope (required on every agent endpoint)
# objective:         human-readable goal (8-280 chars)
# requested_outcome: what you want back (3-280 chars)
# workflow_stage:    resolve, evidence, relationships, assessment, hydrate, batch, finalize, or other
# run_id:           stable id for this run (4-64 chars)
# step_id:          id for this step (1-64 chars)
```

Optional fields: `parent_step_id`, `priority`, `constraints` (latency budget,
min resolution confidence, max results, strict mode), `tags`, `client`
(agent name/version/framework). For batch endpoints, top-level `agent_context`
is required and is propagated to items when per-item context is omitted.

## Endpoint Reference

### Service Health

- `GET /v2/health` - scope `read:health`, use this through the public base URL

### API Keys (user-managed via OIDC Bearer, not ApiKey)

- `GET /v2/api-keys` - list keys
- `POST /v2/api-keys` - create key
- `PATCH /v2/api-keys/{key_id}` - update scopes
- `DELETE /v2/api-keys/{key_id}` - delete key

These are not callable with an ApiKey header. Skip them in agent flows.

### Evidence

- `POST /v2/evidence` - scope `read:evidence`, claim-based evidence retrieval
- `GET /v2/evidence/{evidence_id}` - scope `read:evidence`, hydrate evidence id (primarily report-backed ids like `report--...`)
- `POST /v2/evidence/batch` - scopes `read:evidence` + `batch:evidence`, up to 50 items

### Entity Resolution

- `POST /v2/entity-resolution` - scope `read:resolution`, normalize and disambiguate
- `GET /v2/entities/{canonical_id}` - scope `read:resolution`, query params: `include_aliases`, `include_metadata`
- `POST /v2/entity-resolution/batch` - scopes `read:resolution` + `batch:resolution`, up to 50 items

### Prioritize

- `POST /v2/prioritize` - scope `read:prioritize`, environment-aware ranking

### Structured Assessments

- `POST /v2/threat-assessments` - scope `read:assessments`
- `POST /v2/cve-assessments` - scope `read:assessments`
- `POST /v2/actor-assessments` - scope `read:assessments`
- `POST /v2/environment-assessments` - scope `read:assessments`, requires `environment_context`
- `POST /v2/ioc-assessments` - scope `read:assessments`
- `POST /v2/assessments/batch` - scopes `read:assessments` + `batch:assessments`, discriminated by `assessment_type`

### Relationships

- `POST /v2/relationships` - scope `read:relationships`, bounded relationship retrieval
- `POST /v2/relationships/batch` - scopes `read:relationships` + `batch:relationships`, up to 50 items

## Endpoint Decision Matrix (When and Why)

- `POST /v2/entity-resolution`
  - When: input is alias-like, ambiguous, typo-prone, or mixed format.
  - Why: canonical IDs reduce downstream ambiguity and false pivots.

- `POST /v2/intel-search`
  - When: user asks broad topic/news question without precise entity.
  - Why: discover relevant report capsules before choosing investigation subjects.

- `POST /v2/evidence`
  - When: you must prove/disprove a concrete proposition.
  - Why: claim-level evidence prevents hand-wavy conclusions.

- `POST /v2/relationships`
  - When: you need actor/campaign/malware/sector/ioc/technique pivots from a subject.
  - Why: relationships explain impact pathways and support action planning.

- `POST /v2/cve-assessments`
  - When: subject is primarily a CVE.
  - Why: deterministic CVE scoring + recommendation is more specific than generic assessment.

- `POST /v2/actor-assessments` / `POST /v2/ioc-assessments`
  - When: subject is actor or IOC and you need deterministic risk/action output.
  - Why: subject-specific scoring logic is preferable to generic synthesis.

- `POST /v2/threat-assessments`
  - When: subject class is mixed/uncertain.
  - Why: fallback deterministic assessment path when specialized endpoint is not clear.

- `POST /v2/prioritize`
  - When: user provides environment context and asks what matters now.
  - Why: ranked queue for action, then deep-dive top items with evidence + relationships.

## Subject vs Query mode

Evidence, assessment, and relationship endpoints accept exactly one of:

- `subject`: an object with `entity_type`, `canonical_id`, and optional `canonical_name`. Preferred when you already have a canonical id.
- `query`: free-text string (max 1024 chars). The service will resolve it first.

Sending both, or neither, returns 400.

IOC fidelity rule:

- For IOC investigations (especially URL IoCs), prefer exact `query` mode for `POST /v2/evidence` and `POST /v2/ioc-assessments`.
- If you use `subject` mode for IOC evidence/assessment, include `subject.canonical_name` and preserve the exact IOC string.
- If subject-mode IOC results look unexpectedly weak (for example `no_evidence` or `ioc_lookup_status=no_match`) after exact resolution, retry once in exact `query` mode before final recommendation.

Supported entity_type values: `actor`, `campaign`, `cve`, `domain`,
`email`, `hash`, `ip`, `malware`, `url`. Same set is allowed in
`expected_types`.

## Calling Conventions

Use `Bash` with `curl` (preferred) or `WebFetch` for these. Always pipe
through `jq` if available for readable output.

### Health check

```bash
curl -s "$KYBERIS_BASE_URL/v2/health" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" | jq .
```

### Claim evidence (subject mode)

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/evidence" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {
      "objective": "Confirm active exploitation of CVE-2024-3400",
      "requested_outcome": "evidence list",
      "workflow_stage": "evidence",
      "run_id": "run-001",
      "step_id": "step-1"
    },
    "subject": {"entity_type": "cve", "canonical_id": "cve--2024-3400"},
    "claim_type": "active_exploitation",
    "max_results": 10
  }' | jq .
```

claim_type values: `active_exploitation`, `sector_targeting`,
`actor_association`, `campaign_association`, `malware_association`,
`relevance_to_environment`, `observed_in_the_wild`.

### Claim evidence (query mode with cursor)

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/evidence" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {"objective": "Sector targeting evidence for Volt Typhoon",
                      "requested_outcome": "evidence", "workflow_stage": "evidence",
                      "run_id": "run-002", "step_id": "step-1"},
    "query": "Volt Typhoon",
    "expected_types": ["actor"],
    "claim_type": "sector_targeting",
    "context": {"sector": "energy"},
    "max_results": 25
  }' | jq .
```

### Hydrate an evidence id

Use this primarily for report-backed evidence ids (for example `report--<uuid>`). Identifier-style ids like `ip--...` may return synthetic hydration with no underlying report payload.

GET hydration endpoints require agent context via headers, not body.

```bash
curl -s "$KYBERIS_BASE_URL/v2/evidence/dcso:tie:abc123" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "X-Agent-Objective: Hydrate evidence for display" \
  -H "X-Agent-Requested-Outcome: evidence detail" \
  -H "X-Agent-Workflow-Stage: hydrate" \
  -H "X-Agent-Run-ID: run-001" \
  -H "X-Agent-Step-ID: step-hydrate" | jq .
```

### Entity resolution

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/entity-resolution" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {"objective": "Resolve APT name", "requested_outcome": "canonical id",
                      "workflow_stage": "resolve", "run_id": "run-003", "step_id": "step-1"},
    "query": "Charming Kitten",
    "expected_types": ["actor"],
    "resolution": {"max_results": 5, "include_aliases": true, "include_metadata": true}
  }' | jq .
```

### Hydrate canonical entity

```bash
curl -s "$KYBERIS_BASE_URL/v2/entities/actor--apt35?include_aliases=true&include_metadata=true" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "X-Agent-Objective: Hydrate canonical entity for downstream use" \
  -H "X-Agent-Requested-Outcome: entity detail with aliases" \
  -H "X-Agent-Workflow-Stage: hydrate" \
  -H "X-Agent-Run-ID: run-003" \
  -H "X-Agent-Step-ID: step-hydrate" | jq .
```

### Prioritize

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/prioritize" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {"objective": "Daily prioritized feed for ACME",
                      "requested_outcome": "ranked items", "workflow_stage": "other",
                      "run_id": "run-004", "step_id": "step-1"},
    "environment": {
      "products": ["Microsoft Exchange", "Palo Alto PAN-OS"],
      "vendors": ["Microsoft", "Palo Alto Networks"],
      "industry": "financial_services",
      "geography": ["US"],
      "external_exposure": ["vpn", "email"]
    },
    "expected_categories": ["vulnerability", "campaign", "actor_activity"],
    "time_window_days": 14,
    "max_items": 25
  }' | jq .
```

The `environment` object requires at least one context field.

expected_categories values: `vulnerability`, `campaign`, `actor_activity`,
`malware_activity`, `ioc_cluster`, `technique_cluster`, `identity_abuse`,
`vendor_risk_cluster`.

### Threat / CVE / Actor / IOC assessments

Same shape, different path. CVE example:

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/cve-assessments" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {"objective": "Score CVE-2024-3400 for ACME",
                      "requested_outcome": "priority + rationale",
                      "workflow_stage": "assessment",
                      "run_id": "run-005", "step_id": "step-1"},
    "subject": {"entity_type": "cve", "canonical_id": "cve--2024-3400"},
    "context": {"known_exploited": true, "targeted_industries": ["financial_services"]}
  }' | jq .
```

Swap path for `threat-assessments`, `actor-assessments`, `ioc-assessments`.
Same request envelope.

### Environment assessment

Requires `environment_context` with at least one signal field:

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/environment-assessments" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {"objective": "Score ACME prod posture",
                      "requested_outcome": "priority", "workflow_stage": "assessment",
                      "run_id": "run-006", "step_id": "step-1"},
    "query": "ACME production",
    "environment_context": {
      "sector": "financial_services",
      "regions": ["US"],
      "internet_exposure": "high",
      "control_maturity": "moderate",
      "mfa_enforced": true,
      "patch_latency_days": 21
    }
  }' | jq .
```

internet_exposure and critical_asset_exposure values: `none`, `low`, `medium`, `high`.
control_maturity values: `weak`, `moderate`, `strong`.

### Relationships

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/relationships" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {"objective": "Find malware tied to APT35",
                      "requested_outcome": "related entities",
                      "workflow_stage": "relationships",
                      "run_id": "run-007", "step_id": "step-1"},
    "subject": {"entity_type": "actor", "canonical_id": "actor--apt35"},
    "relationship_types": ["malware", "campaign", "sector"],
    "max_results": 25
  }' | jq .
```

For CVE subjects, include `technique` when you need exploitation technique
context. The API resolves this through the vulnerability described by the CVE.

relationship_types values: `actor`, `campaign`, `malware`, `sector`, `ioc`, `technique`.

### Batch envelopes

All batch endpoints share the same shape: top-level `agent_context`,
`items` (1-50 of the per-item request shape), optional `stop_on_error`.
Per-item `agent_context` is optional. Assessment batch items use a
discriminated union via `assessment_type`:

```bash
curl -s -X POST "$KYBERIS_BASE_URL/v2/assessments/batch" \
  -H "Authorization: ApiKey $KYBERIS_API_KEY_ID:$KYBERIS_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_context": {"objective": "Bulk score CVEs and actors",
                      "requested_outcome": "scored", "workflow_stage": "batch",
                      "run_id": "run-008", "step_id": "step-1"},
    "items": [
      {
        "assessment_type": "cve_assessment",
        "payload": {
          "agent_context": {"objective": "score", "requested_outcome": "priority",
                            "workflow_stage": "assessment",
                            "run_id": "run-008", "step_id": "step-1a"},
          "subject": {"entity_type": "cve", "canonical_id": "cve--2024-3400"}
        }
      },
      {
        "assessment_type": "actor_assessment",
        "payload": {
          "agent_context": {"objective": "score", "requested_outcome": "priority",
                            "workflow_stage": "assessment",
                            "run_id": "run-008", "step_id": "step-1b"},
          "subject": {"entity_type": "actor", "canonical_id": "actor--apt35"}
        }
      }
    ],
    "stop_on_error": false
  }' | jq .
```

assessment_type discriminator values: `threat_assessment`, `cve_assessment`,
`actor_assessment`, `environment_assessment`, `ioc_assessment`.

## Output Formatting

When showing results to the user:

- Assessments: lead with `priority`, `confidence`, then `rationale_codes`
  and `recommended_actions`. Mention degraded/degraded_reasons from metadata
  if present, as they explain partial results.
- Evidence responses: show `status`, `claim_type`, item count, then a
  short bullet list of items (title, stance, support_score, source).
  Surface `next_cursor` if pagination matters.
- Resolution: lead with status (resolved, ambiguous, not_found, or
  not_applicable), then canonical_id/canonical_name and the top
  candidates with their match scores.
- Relationships: group by relationship_type, show canonical_id,
  score, and evidence_count.
- Prioritize: show meta.ranked_count and meta.truncated, then bullets
  of top items with priority, priority_score, and
  recommended_action_summary.


## Gotchas

- Subject XOR query is enforced. Sending both is a 400.
- URL IOC normalization can hide exact-feed matches if the exact IOC string is not preserved. When in doubt, run IOC evidence/assessment with exact `query` mode.
- `GET /v2/evidence/{evidence_id}` and `GET /v2/entities/{canonical_id}` require agent context in headers (`X-Agent-*`), not request body.
- `GET /v2/evidence/{evidence_id}` for identifier-style ids (for example `ip--...`, `actor--...`) can return synthetic hydration. Prefer evidence hydration when reports are in play.
- agent_context is mandatory for request payloads on all agent endpoints.
  For batch endpoints, top-level `agent_context` is required; item-level
  contexts are optional because the API propagates the top-level context.
- API schema batch limits are 1-50 items, but account plans or MCP schemas may set smaller plan limits.
- Field caps: query max 1024 chars, cursor max 512 chars, seen_signal_ids
  max 500 entries each max 128 chars.
- Credit precheck: out-of-credit principals get rejected before work runs with
  `error_code` or `reason` such as `credit_exhausted`.
- Auth rate limiting: repeated bad keys return 429 with
  retry_after_seconds. Back off, do not retry tight.
- Scope errors: 403 with a scope name in the body means the API key was
  created without that scope. Re-issue with the right scopes via the api-keys
  endpoints or the dashboard.
- The api-keys endpoints take a Bearer OIDC token, not an ApiKey. They
  are out of scope for agent flows. Use the dashboard to mint keys.
- OpenAPI: if you need a machine-readable contract snapshot, ask for the generated Kyberis API OpenAPI artifact.

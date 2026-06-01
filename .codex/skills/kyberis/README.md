# Kyberis Codex Skill

This skill provides a safe, deterministic interface for ApiKey-gated Kyberis API endpoints and an investigation playbook from trigger to recommendation.

## Setup

```bash
export KYBERIS_BASE_URL="https://api.kyberis.ai"
export KYBERIS_API_KEY_ID="<key_id>"
export KYBERIS_API_KEY_SECRET="<secret>"
# optional
export KYBERIS_TIMEOUT_SECONDS="20"
export KYBERIS_MAX_RETRIES="2"
```

## Investigation Workflow (Use This Default)

1. Resolve input into canonical entity (`entity-resolution`) unless question is broad discovery.
2. Decompose into claim-level checks and pull evidence (`claim-evidence`).
3. Pivot relationships (`relationships`) for actors/campaigns/malware/sectors/IoCs/techniques.
4. Run deterministic assessment endpoint (`cve-assessment` or `threat-assessment`).
5. Produce recommendation with confidence, caveats, and next actions.

For broad discovery, start with `intel-search`, then pivot to resolution/evidence/relationships/assessment.
For environment triage, start with `prioritize`, then investigate top-ranked signals.

## Command Usage

Direct node invocation:

```bash
node .codex/skills/kyberis/bin/kyberis-client.mjs --help
```

`npx` invocation (local package path):

```bash
npx --yes ./.codex/skills/kyberis --help
```

### Entity Resolution

```bash
node .codex/skills/kyberis/bin/kyberis-client.mjs entity-resolution \
  --json '{"query":"Cozy Bear","expected_types":["actor"],"resolution":{"max_results":5},"agent_context":{"objective":"Normalize actor input for downstream analysis","requested_outcome":"Canonical actor id","workflow_stage":"resolve","run_id":"run-1234","step_id":"resolve-actor"}}'
```

### Claim Evidence

```bash
node .codex/skills/kyberis/bin/kyberis-client.mjs claim-evidence \
  --json '{"subject":{"entity_type":"cve","canonical_id":"cve--2025-12345"},"claim_type":"active_exploitation","max_results":5,"agent_context":{"objective":"Collect evidence for exploitation claim","requested_outcome":"Bounded evidence items","workflow_stage":"evidence","run_id":"run-1234","step_id":"evidence-1"}}'
```

### IOC Assessment

```bash
node .codex/skills/kyberis/bin/kyberis-client.mjs ioc-assessment \
  --json '{"query":"http://example.onion/","agent_context":{"objective":"Assess IOC risk with exact-string fidelity","requested_outcome":"Deterministic IOC risk guidance","workflow_stage":"assessment","run_id":"run-1234","step_id":"ioc-assessment-1"}}'
```

### Relationships

```bash
node .codex/skills/kyberis/bin/kyberis-client.mjs relationships \
  --json '{"subject":{"entity_type":"cve","canonical_id":"cve--2025-12345"},"relationship_types":["actor","campaign","technique"],"max_results":5,"agent_context":{"objective":"Find related entities","requested_outcome":"Top relationships for CVE","workflow_stage":"relationships","run_id":"run-1234","step_id":"relationships-1"}}'
```

### Intel Search

```bash
node .codex/skills/kyberis/bin/kyberis-client.mjs intel-search \
  --json '{"query":"Axios supply chain attack BlueNoroff","time_window_days":30,"max_results":5,"source_filters":["feed","blog"],"agent_context":{"objective":"Find relevant report capsules for open-ended intel question","requested_outcome":"Bounded ranked report capsules with pivots","workflow_stage":"evidence","run_id":"run-1234","step_id":"intel-search-1"}}'
```

### Prioritize

```bash
node .codex/skills/kyberis/bin/kyberis-client.mjs prioritize \
  --json '{"environment":{"industry":"healthcare","products":["microsoft-365"]},"max_items":20,"agent_context":{"objective":"Prioritize current threats for this environment","requested_outcome":"Ranked signal list","workflow_stage":"assessment","run_id":"run-1234","step_id":"prioritize-1"}}'
```

## Recommended Final Result Shape

At minimum, return:

- `recommendation`
- `why_now`
- `confidence`
- `supporting_evidence`
- `next_actions`

## Notes

- The client retries transient failures (`429` and `5xx`) up to `KYBERIS_MAX_RETRIES`.
- API key values are never emitted in errors.
- Endpoint access is allowlisted in code to prevent arbitrary proxying.
- For IOC evidence and IOC assessment calls, subject-mode requests must include `subject.canonical_name`; otherwise use exact `query` mode.
- For IOC evidence (`observed_in_the_wild`) and IOC assessment, the client auto-retries once in exact `query` mode when subject-mode indicates `no_match`/`no_evidence`.
- See `references/api-reference.md` for limits and controlled vocabularies.

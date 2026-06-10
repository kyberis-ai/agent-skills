#!/usr/bin/env node

const ALLOWED_COMMANDS = {
  "entity-resolution": "/v2/entity-resolution",
  "threat-assessment": "/v2/threat-assessments",
  "ioc-assessment": "/v2/ioc-assessments",
  "cve-assessment": "/v2/cve-assessments",
  "claim-evidence": "/v2/evidence",
  "relationships": "/v2/relationships",
  "prioritize": "/v2/prioritize",
  "hunt-pivots": "/v2/hunt-pivots",
  "intel-search": "/v2/intel-search"
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const WORKFLOW_STAGES = new Set([
  "resolve",
  "evidence",
  "relationships",
  "assessment",
  "hunt",
  "hydrate",
  "batch",
  "finalize",
  "other"
]);
const IDENTITY_STACK_TO_CAPABILITIES = {
  "azure-ad": "federated_identity",
  entra: "federated_identity",
  okta: "federated_identity",
  "saml-federation": "federated_identity",
  saml: "federated_identity",
  oidc: "federated_identity",
  oauth: "federated_identity"
};
const LEGACY_RELATIONSHIP_TYPES = {
  actor_association: "actor",
  campaign_association: "campaign",
  malware_association: "malware",
  sector_targeting: "sector",
  sector_association: "sector"
};
const IOC_ENTITY_TYPES = new Set([
  "ip",
  "domain",
  "url",
  "md5",
  "sha1",
  "sha256",
  "sha512",
  "ssdeep",
  "hash",
  "file_hash",
  "ioc"
]);

function asNonEmptyString(value) {
  const parsed = String(value ?? "").trim();
  return parsed.length > 0 ? parsed : null;
}

function isIocEntityType(entityType) {
  const parsed = asNonEmptyString(entityType);
  return !!parsed && IOC_ENTITY_TYPES.has(parsed.toLowerCase());
}

function getIocCanonicalName(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const subject = payload.subject;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
    return null;
  }
  if (!isIocEntityType(subject.entity_type)) {
    return null;
  }
  return asNonEmptyString(subject.canonical_name);
}

function ensureIocSubjectCanonicalName(command, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }
  const hasSubject = payload.subject && typeof payload.subject === "object" && !Array.isArray(payload.subject);
  if (!hasSubject) {
    return;
  }
  if (!["claim-evidence", "ioc-assessment"].includes(command)) {
    return;
  }
  const entityType = payload.subject.entity_type;
  if (!isIocEntityType(entityType)) {
    return;
  }
  if (getIocCanonicalName(payload)) {
    return;
  }
  throw new Error(
    `IOC subject payload for '${command}' must include subject.canonical_name. ` +
    "Use exact query mode when canonical_name is unavailable."
  );
}

function shouldFallbackToExactIocQuery(command, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }

  if (command === "ioc-assessment") {
    const iocStatus = asNonEmptyString(result?.metadata?.ioc_lookup_status)?.toLowerCase();
    return iocStatus === "no_match";
  }

  if (command === "claim-evidence") {
    const claimType = asNonEmptyString(result.claim_type)?.toLowerCase();
    const status = asNonEmptyString(result.status)?.toLowerCase();
    const itemCount = Array.isArray(result.items) ? result.items.length : 0;
    return claimType === "observed_in_the_wild" && (status === "no_evidence" || itemCount === 0);
  }

  return false;
}

function buildExactIocQueryPayload(payload, canonicalName) {
  const data = { ...payload, query: canonicalName };
  delete data.subject;
  return data;
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalIntEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function loadConfig() {
  return {
    baseUrl: requiredEnv("KYBERIS_BASE_URL").replace(/\/+$/, ""),
    apiKeyId: requiredEnv("KYBERIS_API_KEY_ID"),
    apiKeySecret: requiredEnv("KYBERIS_API_KEY_SECRET"),
    timeoutSeconds: Math.max(1, optionalIntEnv("KYBERIS_TIMEOUT_SECONDS", 20)),
    maxRetries: Math.max(0, optionalIntEnv("KYBERIS_MAX_RETRIES", 2))
  };
}

function usage() {
  const commands = Object.keys(ALLOWED_COMMANDS).sort().join(", ");
  return [
    "Usage:",
    "  kyberis-client <command> --json '<payload>' [--pretty]",
    "",
    "Commands:",
    `  ${commands}`,
    "",
    "Required env:",
    "  KYBERIS_BASE_URL, KYBERIS_API_KEY_ID, KYBERIS_API_KEY_SECRET"
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }

  const command = argv[0];
  if (!command || !(command in ALLOWED_COMMANDS)) {
    throw new Error(`Unsupported or missing command.\n\n${usage()}`);
  }

  let jsonPayload = null;
  let pretty = false;

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      jsonPayload = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--pretty") {
      pretty = true;
      continue;
    }
    throw new Error(`Unknown arg '${token}'.\n\n${usage()}`);
  }

  if (!jsonPayload) {
    throw new Error(`Missing --json payload.\n\n${usage()}`);
  }

  let payload;
  try {
    payload = JSON.parse(jsonPayload);
  } catch {
    throw new Error("--json must be valid JSON");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload must be a JSON object");
  }

  return { command, payload, pretty };
}

function boundedPayload(command, payload) {
  const data = { ...payload };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.parseInt(String(value), 10)));

  if (Object.hasOwn(data, "agent_context")) {
    const ctx = data.agent_context;
    if (ctx && typeof ctx === "object" && !Array.isArray(ctx) && typeof ctx.workflow_stage === "string") {
      const stage = String(ctx.workflow_stage).trim().toLowerCase();
      if (WORKFLOW_STAGES.has(stage)) {
        data.agent_context = { ...ctx, workflow_stage: stage };
      }
    }
  }

  if (command === "entity-resolution") {
    if (Object.hasOwn(data, "max_candidates")) {
      const resolution = (data.resolution && typeof data.resolution === "object" && !Array.isArray(data.resolution))
        ? { ...data.resolution }
        : {};
      resolution.max_results = clamp(data.max_candidates, 1, 25);
      data.resolution = resolution;
      delete data.max_candidates;
    } else if (
      data.resolution &&
      typeof data.resolution === "object" &&
      !Array.isArray(data.resolution) &&
      Object.hasOwn(data.resolution, "max_results")
    ) {
      data.resolution = {
        ...data.resolution,
        max_results: clamp(data.resolution.max_results, 1, 25)
      };
    }
  }
  if (command === "claim-evidence") {
    if (Object.hasOwn(data, "max_items")) {
      data.max_results = clamp(data.max_items, 1, 50);
      delete data.max_items;
    }
    if (Object.hasOwn(data, "max_results")) {
      data.max_results = clamp(data.max_results, 1, 50);
    }
  }
  if (command === "relationships") {
    if (Array.isArray(data.relationship_types)) {
      data.relationship_types = data.relationship_types.map((value) => {
        const key = String(value || "").trim().toLowerCase();
        return LEGACY_RELATIONSHIP_TYPES[key] || key;
      });
    }
    if (Object.hasOwn(data, "max_items")) {
      data.max_results = clamp(data.max_items, 1, 50);
      delete data.max_items;
    }
    if (Object.hasOwn(data, "max_results")) {
      data.max_results = clamp(data.max_results, 1, 50);
    }
  }
  if (command === "prioritize") {
    if (data.environment && typeof data.environment === "object" && !Array.isArray(data.environment)) {
      const env = { ...data.environment };

      const capabilitySet = new Set(
        Array.isArray(env.capabilities)
          ? env.capabilities.map((value) => String(value || "").trim()).filter((value) => value.length > 0)
          : []
      );

      if (Array.isArray(env.capability_tags)) {
        for (const raw of env.capability_tags) {
          const value = String(raw || "").trim();
          if (value) capabilitySet.add(value);
        }
        delete env.capability_tags;
      }

      if (Array.isArray(env.identity_stack)) {
        for (const raw of env.identity_stack) {
          const value = String(raw || "").trim();
          if (!value) continue;
          capabilitySet.add(value);
          const mapped = IDENTITY_STACK_TO_CAPABILITIES[String(value).toLowerCase()];
          if (mapped) capabilitySet.add(mapped);
        }
        delete env.identity_stack;
      }

      if (capabilitySet.size > 0) {
        env.capabilities = Array.from(capabilitySet).slice(0, 50);
      }

      data.environment = env;
    }

    if (Object.hasOwn(data, "limit")) {
      data.max_items = clamp(data.limit, 1, 100);
      delete data.limit;
    }
    if (Object.hasOwn(data, "max_items")) {
      data.max_items = clamp(data.max_items, 1, 100);
    }
  }
  if (command === "hunt-pivots") {
    const options = (data.options && typeof data.options === "object" && !Array.isArray(data.options))
      ? { ...data.options }
      : {};
    if (Object.hasOwn(data, "max_pivots")) {
      options.max_pivots = clamp(data.max_pivots, 1, 20);
      delete data.max_pivots;
    }
    if (Object.hasOwn(options, "max_pivots")) {
      options.max_pivots = clamp(options.max_pivots, 1, 20);
    }
    if (Object.keys(options).length > 0) {
      data.options = options;
    }
  }
  if (command === "intel-search") {
    if (Object.hasOwn(data, "max_results")) {
      data.max_results = clamp(data.max_results, 1, 50);
    }
    if (Object.hasOwn(data, "time_window_days")) {
      data.time_window_days = clamp(data.time_window_days, 1, 3650);
    }
    if (Array.isArray(data.source_filters)) {
      data.source_filters = data.source_filters
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value, idx, arr) => value.length > 0 && value.length <= 64 && arr.indexOf(value) === idx)
        .slice(0, 20);
    }
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ApiError extends Error {
  constructor(status, payload) {
    const message = payload && typeof payload === "object" && !Array.isArray(payload)
      ? String(payload.message || payload.error_code || payload.reason || `HTTP ${status}`)
      : `HTTP ${status}`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function parseJsonObject(text) {
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function errorPayloadFromResponse(status, text, statusText) {
  const parsed = parseJsonObject(text);
  if (parsed) {
    return {
      status_code: status,
      ...parsed
    };
  }
  return {
    error_code: `http_${status}`,
    message: String(text || statusText || `HTTP ${status}`).trim(),
    status_code: status
  };
}

async function callEndpoint(config, command, payload) {
  const bounded = boundedPayload(command, payload);
  ensureIocSubjectCanonicalName(command, bounded);

  const endpoint = ALLOWED_COMMANDS[command];
  const url = `${config.baseUrl}${endpoint}`;
  const body = JSON.stringify(bounded);

  let lastError = null;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `ApiKey ${config.apiKeyId}:${config.apiKeySecret}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body,
        signal: controller.signal
      });
      clearTimeout(timeout);

      const text = await response.text();
      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < config.maxRetries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new ApiError(response.status, errorPayloadFromResponse(response.status, text, response.statusText));
      }

      const parsed = text ? JSON.parse(text) : {};
      const canonicalName = getIocCanonicalName(bounded);
      const hasExactQuery = asNonEmptyString(bounded.query);

      if (!hasExactQuery && canonicalName && shouldFallbackToExactIocQuery(command, parsed)) {
        const fallbackPayload = boundedPayload(command, buildExactIocQueryPayload(bounded, canonicalName));
        const fallbackBody = JSON.stringify(fallbackPayload);
        const fallbackController = new AbortController();
        const fallbackTimeout = setTimeout(() => fallbackController.abort(), config.timeoutSeconds * 1000);
        try {
          const fallbackResponse = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `ApiKey ${config.apiKeyId}:${config.apiKeySecret}`,
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: fallbackBody,
            signal: fallbackController.signal
          });

          const fallbackText = await fallbackResponse.text();
          if (!fallbackResponse.ok) {
            return parsed;
          }
          const fallbackParsed = fallbackText ? JSON.parse(fallbackText) : {};
          return {
            ...fallbackParsed,
            metadata: {
              ...(fallbackParsed.metadata && typeof fallbackParsed.metadata === "object" ? fallbackParsed.metadata : {}),
              exact_ioc_query_fallback_applied: true
            }
          };
        } finally {
          clearTimeout(fallbackTimeout);
        }
      }

      return parsed;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;

      const retryableNetwork = err && (err.name === "AbortError" || err.name === "TypeError");
      if (retryableNetwork && attempt < config.maxRetries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Request failed");
}

async function main() {
  try {
    const { command, payload, pretty } = parseArgs(process.argv.slice(2));
    const config = loadConfig();
    const result = await callEndpoint(config, command, payload);
    if (pretty) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(JSON.stringify(result));
    }
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(JSON.stringify(err.payload));
      process.exit(1);
    }
    const message = err && typeof err.message === "string" ? err.message : String(err);
    console.error(JSON.stringify({ error_code: "client_error", message }));
    process.exit(1);
  }
}

await main();

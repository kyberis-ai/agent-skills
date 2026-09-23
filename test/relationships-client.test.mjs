import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const helper = fileURLToPath(new URL("../source/codex/bin/kyberis-client.mjs", import.meta.url));

test("HTTP helper preserves ATT&CK traversal fields and response metadata", async (t) => {
  const requests = [];
  const response = {
    status: "ok",
    items: [{ predicate: "detects", direction: "incoming", metadata: { entity: { description: "Authored guidance" }, source_refs: ["mitre:example"] } }],
    metadata: { subject_entity: { external_id: "T1059.001" }, warnings: ["Missing reference"] },
    next_cursor: "opaque-cursor"
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method, body: JSON.parse(body) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const steps = [
    { query: "T1059.001", expected_types: ["technique"], relationship_types: ["detection-strategy"], predicates: ["detects"], direction: "incoming" },
    { subject: { entity_type: "detection-strategy", canonical_id: "detection-strategy--x-mitre-detection-strategy--example" }, relationship_types: ["analytic"], predicates: ["has_analytic"], direction: "outgoing" },
    { query: "AN1252", relationship_types: ["data-component"], predicates: ["requires_data_component"], direction: "outgoing" },
    { subject: { entity_type: "data-component", canonical_id: "data-component--x-mitre-data-component--example" }, relationship_types: ["data-source"], predicates: ["belongs_to_data_source"], direction: "outgoing" },
    { query: "T1059.001", relationship_types: ["tactic"], predicates: ["belongs_to"], direction: "outgoing" }
  ];
  for (const [index, step] of steps.entries()) {
    const payload = {
      ...step,
      agent_context: { objective: "Explore ATT&CK detection guidance", requested_outcome: "Authored guidance", workflow_stage: "relationships", run_id: "test-run", step_id: String(index) },
      platform: "Windows", include_inactive: index % 2 === 0,
      max_results: 10, cursor: "opaque-cursor"
    };
    const { stdout } = await run(process.execPath, [helper, "relationships", "--json", JSON.stringify(payload)], {
      env: { ...process.env, KYBERIS_BASE_URL: `http://127.0.0.1:${server.address().port}`, KYBERIS_API_KEY_ID: "test-id", KYBERIS_API_KEY_SECRET: "test-secret", KYBERIS_MAX_RETRIES: "0" }
    });
    assert.deepEqual(requests.at(-1), { path: "/v2/relationships", method: "POST", body: payload });
    assert.deepEqual(JSON.parse(stdout), response);
  }
});

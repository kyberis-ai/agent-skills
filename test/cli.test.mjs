import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { internals, main } from "../src/cli.mjs";

test("bundle contains shared api reference and manifest for every agent", () => {
  for (const agent of ["codex", "claude", "cursor"]) {
    const bundle = internals.bundleForAgent(agent);
    assert.equal(bundle.manifest.package, "@kyberis-ai/agent-skills");
    assert.equal(bundle.manifest.agent, agent);
    assert.ok(bundle.files.has("SKILL.md"));
    assert.ok(bundle.files.has("references/api-reference.md"));
    assert.ok(String(bundle.files.get("references/api-reference.md")).includes("/v2/"));
  }
});

test("codex bundle preserves executable helper and OpenAI metadata overlays", () => {
  const bundle = internals.bundleForAgent("codex");
  assert.ok(bundle.files.has("agents/openai.yaml"));
  const openaiYaml = String(bundle.files.get("agents/openai.yaml"));
  assert.ok(openaiYaml.includes("$kyberis"));
  assert.ok(openaiYaml.includes("./assets/kyberis-small.png"));
  assert.ok(openaiYaml.includes("./assets/kyberis.png"));
  assert.ok(openaiYaml.includes("https://mcp.kyberis.ai/"));
  assert.ok(bundle.files.has("assets/kyberis-small.png"));
  assert.ok(bundle.files.has("assets/kyberis.png"));
  assert.ok(bundle.files.has("bin/kyberis-client.mjs"));
  assert.ok(bundle.files.has("package.json"));
  assert.ok(!bundle.files.has("references/api-contract.md"));
});

test("install refuses to overwrite unmanaged existing directory unless forced", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-skill-"));
  fs.writeFileSync(path.join(target, "local.txt"), "local edit");
  assert.throws(
    () => internals.writeBundle(target, internals.bundleForAgent("claude"), { force: false }),
    /not managed/
  );
  internals.writeBundle(target, internals.bundleForAgent("claude"), { force: true });
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(target, ".kyberis-skill.json")));
});

test("install command supports custom directory", async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-install-"));
  await main(["install", "cursor", "--dir", target]);
  const manifest = internals.readManifest(target);
  assert.equal(manifest.agent, "cursor");
  assert.equal(manifest.package, "@kyberis-ai/agent-skills");
  assert.ok(manifest.installedAt);
});

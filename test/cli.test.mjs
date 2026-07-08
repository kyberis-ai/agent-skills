import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import { internals, main } from "../src/cli.mjs";

test("bundle contains shared api reference and manifest for every agent", () => {
  for (const agent of ["codex", "claude", "cursor", "windsurf", "github-copilot", "generic"]) {
    const bundle = internals.bundleForAgent(agent);
    assert.equal(bundle.manifest.package, "@kyberis-ai/agent-skills");
    assert.equal(bundle.manifest.agent, agent);
    assert.ok(bundle.files.has("SKILL.md"));
    assert.ok(bundle.files.has("references/api-reference.md"));
    assert.ok(String(bundle.files.get("references/api-reference.md")).includes("/v2/"));
  }
});

test("generic bundle supports unsupported agents", async () => {
  const bundle = internals.bundleForAgent("generic");
  assert.ok(bundle.files.has("SKILL.md"));
  assert.ok(bundle.files.has("references/api-reference.md"));
  const skill = String(bundle.files.get("SKILL.md"));
  assert.ok(skill.includes("Generic Agent Skill"));
  assert.ok(skill.includes("https://mcp.kyberis.ai/"));
  assert.ok(skill.includes("Do not apply it to general source code editing"));
  await assert.rejects(() => main(["install", "generic"]), /generic installs require --dir/);
});

test("windsurf bundle uses cascade skill metadata for threat investigation", () => {
  const bundle = internals.bundleForAgent("windsurf");
  assert.ok(bundle.files.has("SKILL.md"));
  const skill = String(bundle.files.get("SKILL.md"));
  assert.ok(skill.includes("Guides Windsurf Cascade"));
  assert.ok(skill.includes("https://mcp.kyberis.ai/"));
  assert.ok(skill.includes("@kyberis"));
  assert.ok(skill.includes("Do not apply it to general source code editing"));
});

test("cursor bundle includes an agent-requested rule for threat investigation", () => {
  const bundle = internals.bundleForAgent("cursor");
  assert.ok(bundle.files.has("rules/kyberis.mdc"));
  const rule = String(bundle.files.get("rules/kyberis.mdc"));
  assert.ok(rule.includes("alwaysApply: false"));
  assert.ok(rule.includes("https://mcp.kyberis.ai/"));
  assert.ok(rule.includes("threat investigation"));
  assert.ok(rule.includes("Do not apply Kyberis to general source code editing"));
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
  await main(["install", "generic", "--dir", target]);
  const manifest = internals.readManifest(target);
  assert.equal(manifest.agent, "generic");
  assert.equal(manifest.package, "@kyberis-ai/agent-skills");
  assert.ok(manifest.installedAt);
});

test("github-copilot bundle includes an auto-discovered instructions file for threat investigation", () => {
  const bundle = internals.bundleForAgent("github-copilot");
  assert.ok(bundle.files.has("instructions/kyberis.instructions.md"));
  const instructions = String(bundle.files.get("instructions/kyberis.instructions.md"));
  assert.ok(instructions.includes("applyTo:"));
  assert.ok(instructions.includes("https://mcp.kyberis.ai/"));
  assert.ok(instructions.includes("Do not apply Kyberis to general source code editing"));
});

test("github-copilot install requires a valid --scope", async () => {
  await assert.rejects(() => main(["install", "github-copilot"]), /requires --scope/);
  await assert.rejects(
    () => main(["install", "github-copilot", "--scope", "bogus"]),
    /Expected --scope to be one of: project, user/
  );
});

test("github-copilot target resolution differs by scope", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-project-"));
  const project = internals.githubCopilotTargets("project", { dir: projectRoot });
  assert.equal(project.skillDir, path.join(projectRoot, ".github", "skills", "kyberis"));
  assert.equal(project.instructionsFile, path.join(projectRoot, ".github", "instructions", "kyberis.instructions.md"));

  const user = internals.githubCopilotTargets("user", {});
  assert.equal(user.skillDir, internals.defaultInstallDirs["github-copilot"]);
  assert.equal(user.instructionsDir, path.join(user.skillDir, "instructions"));

  const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-user-dir-"));
  const userCustom = internals.githubCopilotTargets("user", { dir: customDir });
  assert.equal(userCustom.skillDir, customDir);
  assert.equal(userCustom.instructionsDir, path.join(customDir, "instructions"));
});

test("github-copilot project-scope install writes the skill bundle and instructions file, and is idempotent", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-project-"));
  await main(["install", "github-copilot", "--scope", "project", "--dir", projectRoot]);

  const skillDir = path.join(projectRoot, ".github", "skills", "kyberis");
  const instructionsFile = path.join(projectRoot, ".github", "instructions", "kyberis.instructions.md");
  assert.ok(fs.existsSync(path.join(skillDir, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(skillDir, "references", "api-reference.md")));
  assert.ok(fs.existsSync(instructionsFile));
  const manifest = internals.readManifest(skillDir);
  assert.equal(manifest.agent, "github-copilot");

  const instructionsBefore = fs.readFileSync(instructionsFile, "utf8");

  await main(["install", "github-copilot", "--scope", "project", "--dir", projectRoot]);
  assert.equal(fs.readFileSync(instructionsFile, "utf8"), instructionsBefore);

  fs.writeFileSync(instructionsFile, "local edit");
  await assert.rejects(
    () => main(["install", "github-copilot", "--scope", "project", "--dir", projectRoot]),
    /already exists and differs/
  );
  await main(["install", "github-copilot", "--scope", "project", "--dir", projectRoot, "--force"]);
  assert.equal(fs.readFileSync(instructionsFile, "utf8"), instructionsBefore);
});

test("github-copilot user-scope install registers a chat.instructionsFilesLocations entry without duplicating it", async () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-user-"));
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-settings-"));
  const settingsFile = path.join(settingsDir, "settings.json");
  const previousEnv = process.env.KYBERIS_VSCODE_SETTINGS_FILE;
  process.env.KYBERIS_VSCODE_SETTINGS_FILE = settingsFile;
  try {
    await main(["install", "github-copilot", "--scope", "user", "--dir", skillDir]);
    const instructionsFile = path.join(skillDir, "instructions", "kyberis.instructions.md");
    assert.ok(fs.existsSync(instructionsFile));

    let settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    let locations = settings["chat.instructionsFilesLocations"];
    let keys = Object.keys(locations);
    assert.equal(keys.length, 1);
    assert.equal(locations[keys[0]], true);
    assert.ok(keys[0].endsWith("/instructions"), `expected a folder entry, got ${keys[0]}`);

    await main(["install", "github-copilot", "--scope", "user", "--dir", skillDir]);
    settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    locations = settings["chat.instructionsFilesLocations"];
    assert.equal(Object.keys(locations).length, 1);
  } finally {
    if (previousEnv === undefined) delete process.env.KYBERIS_VSCODE_SETTINGS_FILE;
    else process.env.KYBERIS_VSCODE_SETTINGS_FILE = previousEnv;
  }
});

test("tildeRelativePath prefers a home-relative (~) form for paths under the home directory", () => {
  const underHome = path.join(os.homedir(), "kyberis-test-subdir", "instructions");
  assert.equal(internals.tildeRelativePath(underHome), "~/kyberis-test-subdir/instructions");

  const outsideHome = path.resolve(path.sep, "definitely-outside-home-dir", "instructions");
  assert.equal(internals.tildeRelativePath(outsideHome), null);
});

test("github-copilot user-scope install reports an actionable error for an unparsable settings.json", async () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-user-"));
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-settings-"));
  const settingsFile = path.join(settingsDir, "settings.json");
  fs.writeFileSync(settingsFile, "{ // comment\n  \"foo\": true\n}");
  const previousEnv = process.env.KYBERIS_VSCODE_SETTINGS_FILE;
  process.env.KYBERIS_VSCODE_SETTINGS_FILE = settingsFile;
  try {
    await assert.rejects(
      () => main(["install", "github-copilot", "--scope", "user", "--dir", skillDir]),
      /Could not parse/
    );
  } finally {
    if (previousEnv === undefined) delete process.env.KYBERIS_VSCODE_SETTINGS_FILE;
    else process.env.KYBERIS_VSCODE_SETTINGS_FILE = previousEnv;
  }
});

test("github-copilot install reports an actionable error when the skill directory cannot be created", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-blocker-"));
  const blockerFile = path.join(parent, "blocker");
  fs.writeFileSync(blockerFile, "not a directory");
  // blockerFile is a regular file, so mkdirSync(recursive: true) for any path under it
  // fails with a genuine filesystem error (ENOTDIR), not one of writeBundle's own checks.
  const unwritableRoot = path.join(blockerFile, "project-root");

  await assert.rejects(
    () => main(["install", "github-copilot", "--scope", "project", "--dir", unwritableRoot]),
    (error) => {
      assert.ok(error.message.startsWith("Could not write GitHub Copilot skill files to"));
      assert.ok(error.message.includes("ENOTDIR") || /not a directory/i.test(error.message));
      return true;
    }
  );
});

test("github-copilot user-scope install reports an actionable error when settings.json cannot be written", async () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-user-"));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-blocker-"));
  const blockerFile = path.join(parent, "blocker");
  fs.writeFileSync(blockerFile, "not a directory");
  const unwritableSettingsFile = path.join(blockerFile, "User", "settings.json");

  const previousEnv = process.env.KYBERIS_VSCODE_SETTINGS_FILE;
  process.env.KYBERIS_VSCODE_SETTINGS_FILE = unwritableSettingsFile;
  try {
    await assert.rejects(
      () => main(["install", "github-copilot", "--scope", "user", "--dir", skillDir]),
      /Could not update VS Code user settings at/
    );
  } finally {
    if (previousEnv === undefined) delete process.env.KYBERIS_VSCODE_SETTINGS_FILE;
    else process.env.KYBERIS_VSCODE_SETTINGS_FILE = previousEnv;
  }
});

test("github-copilot install still reports writeBundle's own actionable errors unwrapped", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kyberis-copilot-project-"));
  const skillDir = path.join(projectRoot, ".github", "skills", "kyberis");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "local.txt"), "unmanaged local content");

  await assert.rejects(
    () => main(["install", "github-copilot", "--scope", "project", "--dir", projectRoot]),
    /not managed by @kyberis-ai\/agent-skills/
  );
});

test("github-copilot user-scope install rejects unsupported platforms unless an override is set", () => {
  const previousEnv = process.env.KYBERIS_VSCODE_SETTINGS_FILE;
  delete process.env.KYBERIS_VSCODE_SETTINGS_FILE;
  mock.method(os, "platform", () => "aix");
  try {
    assert.throws(() => internals.vsCodeUserSettingsFile(), /not supported on platform 'aix'/);
  } finally {
    mock.restoreAll();
    if (previousEnv !== undefined) process.env.KYBERIS_VSCODE_SETTINGS_FILE = previousEnv;
  }
});

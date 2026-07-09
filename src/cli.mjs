import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc, modify as modifyJsonc, applyEdits, printParseErrorCode } from "jsonc-parser";

const PACKAGE_NAME = "@kyberis-ai/agent-skills";
const SKILL_NAME = "kyberis";
const AGENTS = new Set(["codex", "claude", "cursor", "windsurf", "github-copilot", "generic"]);
const SCOPES = new Set(["project", "user"]);
// GitHub Copilot's Agent Skills feature (the same SKILL.md-based open standard this package
// already targets for Codex/Claude/Cursor/Windsurf) auto-discovers project skills under
// .github/skills/, .claude/skills/, .agents/skills/ and personal skills under ~/.copilot/skills/,
// ~/.claude/skills/, ~/.agents/skills/ — no settings.json registration required for those default
// locations. chat.agentSkillsLocations only extends discovery to additional, non-default
// directories (e.g. a custom --dir); it takes folder globs like ".github/skills/**". This is
// unrelated to the older chat.instructionsFilesLocations / deprecated
// github.copilot.chat.codeGeneration.instructions settings, which govern free-text custom
// instructions rather than Agent Skills. Confirmed 2026-07-09 against
// https://code.visualstudio.com/docs/agent-customization/agent-skills and
// https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/ — re-check if
// user-scope custom-`--dir` installs stop showing up in Copilot on a newer VS Code/Copilot release.
const CHAT_AGENT_SKILLS_LOCATIONS_KEY = "chat.agentSkillsLocations";
const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), "..");
const sourceRoot = path.join(packageRoot, "source");

const defaultInstallDirs = {
  codex: path.join(os.homedir(), ".codex", "skills", SKILL_NAME),
  claude: path.join(os.homedir(), ".claude", "skills", SKILL_NAME),
  cursor: path.join(os.homedir(), ".cursor", "skills", SKILL_NAME),
  windsurf: path.join(os.homedir(), ".codeium", "windsurf", "skills", SKILL_NAME),
  "github-copilot": path.join(os.homedir(), ".copilot", "skills", SKILL_NAME),
};

const defaultCursorRuleFile = path.join(os.homedir(), ".cursor", "rules", `${SKILL_NAME}.mdc`);

const repoSkillDirs = {
  codex: path.join(".codex", "skills", SKILL_NAME),
  claude: path.join(".claude", "skills", SKILL_NAME),
  cursor: path.join(".cursor", "skills", SKILL_NAME),
  windsurf: path.join(".windsurf", "skills", SKILL_NAME),
  "github-copilot": path.join(".github", "skills", SKILL_NAME),
};

const repoCursorRuleFile = path.join(".cursor", "rules", `${SKILL_NAME}.mdc`);

function usage() {
  return `Usage:
  kyberis-agent-skills install <codex|claude|cursor|windsurf> [--dir <path>] [--force]
  kyberis-agent-skills install github-copilot --scope <project|user> [--dir <path>] [--force]
  kyberis-agent-skills install generic --dir <path> [--force]
  kyberis-agent-skills update [--force]
  kyberis-agent-skills status [codex|claude|cursor|windsurf|generic] [--dir <path>]
  kyberis-agent-skills status github-copilot --scope <project|user> [--dir <path>]
  kyberis-agent-skills sync
  kyberis-agent-skills check
  kyberis-agent-skills --help
`;
}

function packageVersion() {
  const data = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  return String(data.version || "0.0.0");
}

function parseOptions(argv) {
  const options = { force: false, dir: "", scope: "" };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--force") {
      options.force = true;
    } else if (token === "--dir") {
      options.dir = String(argv[++i] || "").trim();
      if (!options.dir) throw new Error("--dir requires a path");
    } else if (token === "--scope") {
      options.scope = String(argv[++i] || "").trim();
      if (!options.scope) throw new Error("--scope requires a value");
    } else if (token === "-h" || token === "--help") {
      options.help = true;
    } else {
      positional.push(token);
    }
  }
  return { options, positional };
}

function assertAgent(agent) {
  if (!AGENTS.has(agent)) {
    throw new Error(`Expected one of: ${Array.from(AGENTS).join(", ")}`);
  }
}

function assertScope(scope) {
  if (!scope) {
    throw new Error("github-copilot requires --scope <project|user>");
  }
  if (!SCOPES.has(scope)) {
    throw new Error(`Expected --scope to be one of: ${Array.from(SCOPES).join(", ")}`);
  }
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}

function readPackageBundleFiles(agent) {
  assertAgent(agent);
  const agentRoot = path.join(sourceRoot, agent);
  const sharedReference = path.join(sourceRoot, "shared", "api-reference.md");
  const files = new Map();

  for (const file of walkFiles(agentRoot)) {
    const rel = path.relative(agentRoot, file).split(path.sep).join("/");
    files.set(rel, fs.readFileSync(file));
  }
  files.set("references/api-reference.md", fs.readFileSync(sharedReference));
  return files;
}

function contentHash(files) {
  const hash = crypto.createHash("sha256");
  for (const [rel, body] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (rel === ".kyberis-skill.json") continue;
    hash.update(rel);
    hash.update("\0");
    hash.update(body);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function bundleForAgent(agent, { installedAt = null } = {}) {
  const files = readPackageBundleFiles(agent);
  const hash = contentHash(files);
  const manifest = {
    package: PACKAGE_NAME,
    version: packageVersion(),
    skill: SKILL_NAME,
    agent,
    contentHash: hash,
  };
  if (installedAt) manifest.installedAt = installedAt;
  files.set(".kyberis-skill.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { files, hash, manifest };
}

function cursorRuleFromBundle(bundle) {
  const rule = bundle.files.get("rules/kyberis.mdc");
  if (!rule) throw new Error("Cursor bundle is missing rules/kyberis.mdc");
  return rule;
}

function writeCursorRule(ruleFile, bundle, { force = false } = {}) {
  const body = cursorRuleFromBundle(bundle);
  if (!force && fs.existsSync(ruleFile)) {
    const existing = fs.readFileSync(ruleFile);
    if (!Buffer.from(existing).equals(Buffer.from(body))) {
      throw new Error(`${ruleFile} already exists and differs from the Kyberis Cursor rule. Use --force to overwrite.`);
    }
  }
  fs.mkdirSync(path.dirname(ruleFile), { recursive: true });
  fs.writeFileSync(ruleFile, body);
}

function vsCodeUserSettingsFile() {
  if (process.env.KYBERIS_VSCODE_SETTINGS_FILE) {
    return path.resolve(process.env.KYBERIS_VSCODE_SETTINGS_FILE);
  }
  const platform = os.platform();
  if (platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error("Cannot locate the VS Code user settings file: the APPDATA environment variable is not set.");
    }
    return path.join(appData, "Code", "User", "settings.json");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "settings.json");
  }
  if (platform === "linux") {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(xdgConfig, "Code", "User", "settings.json");
  }
  throw new Error(
    `github-copilot user-scope install is not supported on platform '${platform}'. Set KYBERIS_VSCODE_SETTINGS_FILE to override the settings.json path.`
  );
}

function readSettingsText(file) {
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

// Tolerant of comments and trailing commas (VS Code settings.json is edited as JSONC), but still
// surfaces genuine syntax errors as an actionable message rather than silently losing settings.
function parseJsoncObject(text, file) {
  if (!text.trim()) return {};
  const errors = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const [{ error, offset }] = errors;
    throw new Error(
      `Could not parse ${file} as JSON near offset ${offset} (${printParseErrorCode(error)}). Fix the syntax, or add this entry to "${CHAT_AGENT_SKILLS_LOCATIONS_KEY}" manually.`
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} does not contain a JSON object; cannot register the Kyberis GitHub Copilot skill location.`);
  }
  return parsed;
}

// Home-directory-relative form ("~/...") so the glob works regardless of which workspace is open;
// chat.agentSkillsLocations resolves plain relative paths from the workspace root, not home.
function tildeRelativePath(targetDir) {
  const relative = path.relative(os.homedir(), targetDir);
  if (relative.startsWith("..")) return null;
  return `~/${relative.split(path.sep).join("/")}`;
}

function toForwardSlashes(p) {
  return p.split(path.sep).join("/");
}

// chat.agentSkillsLocations entries are skills-root directories (e.g. ".github/skills/**", one
// level above individual "<skill-name>/SKILL.md" folders), not the skill's own folder.
function agentSkillsLocationGlob(skillDir) {
  const skillsRoot = path.dirname(skillDir);
  const base = tildeRelativePath(skillsRoot) || toForwardSlashes(path.resolve(skillsRoot));
  return `${base.replace(/\/$/, "")}/**`;
}

function registerVsCodeCopilotSkillsLocation(settingsFile, locationGlob) {
  const originalText = readSettingsText(settingsFile);
  const settings = parseJsoncObject(originalText, settingsFile);
  const existingLocations =
    typeof settings[CHAT_AGENT_SKILLS_LOCATIONS_KEY] === "object" && settings[CHAT_AGENT_SKILLS_LOCATIONS_KEY] !== null
      ? settings[CHAT_AGENT_SKILLS_LOCATIONS_KEY]
      : {};
  if (existingLocations[locationGlob] === true) return { registered: false, key: locationGlob };

  const edits = modifyJsonc(originalText, [CHAT_AGENT_SKILLS_LOCATIONS_KEY, locationGlob], true, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  const updatedText = applyEdits(originalText, edits);
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, updatedText);
  } catch (error) {
    throw new Error(`Could not update VS Code user settings at ${settingsFile}: ${error.message}`);
  }
  return { registered: true, key: locationGlob };
}

function githubCopilotTargets(scope, options) {
  assertScope(scope);
  if (scope === "project") {
    const root = path.resolve(options.dir || process.cwd());
    return { skillDir: path.join(root, ".github", "skills", SKILL_NAME) };
  }
  const skillDir = path.resolve(options.dir || defaultInstallDirs["github-copilot"]);
  return { skillDir, isDefaultLocation: skillDir === path.resolve(defaultInstallDirs["github-copilot"]) };
}

function installGithubCopilot(options) {
  const targets = githubCopilotTargets(options.scope, options);
  const { skillDir } = targets;
  const bundle = bundleForAgent("github-copilot", { installedAt: new Date().toISOString() });
  try {
    writeBundle(skillDir, bundle, { force: options.force, installMode: true });
  } catch (error) {
    // writeBundle's own "already exists"/"has local changes" errors are already actionable
    // (no .code); only wrap genuine filesystem failures (EACCES, EROFS, ENOTDIR, ...).
    if (error && error.code) {
      throw new Error(`Could not write GitHub Copilot skill files to ${skillDir}: ${error.message}`);
    }
    throw error;
  }
  console.log(`Installed Kyberis GitHub Copilot skill to ${skillDir}`);

  if (options.scope === "project") {
    console.log("GitHub Copilot auto-discovers project skills under .github/skills/ — no further configuration needed.");
    return;
  }
  if (targets.isDefaultLocation) {
    console.log("GitHub Copilot auto-discovers personal skills under ~/.copilot/skills/ — no further configuration needed.");
    return;
  }

  const settingsFile = vsCodeUserSettingsFile();
  const locationGlob = agentSkillsLocationGlob(skillDir);
  const { registered } = registerVsCodeCopilotSkillsLocation(settingsFile, locationGlob);
  console.log(
    registered
      ? `Registered ${locationGlob} in ${settingsFile} (${CHAT_AGENT_SKILLS_LOCATIONS_KEY}) since --dir is outside the default ~/.copilot/skills location`
      : `${locationGlob} is already registered in ${settingsFile} (${CHAT_AGENT_SKILLS_LOCATIONS_KEY})`
  );
}

function currentFiles(targetDir) {
  const files = new Map();
  for (const file of walkFiles(targetDir)) {
    const rel = path.relative(targetDir, file).split(path.sep).join("/");
    if (rel === ".kyberis-skill.json") continue;
    files.set(rel, fs.readFileSync(file));
  }
  return files;
}

function readManifest(targetDir) {
  const manifestPath = path.join(targetDir, ".kyberis-skill.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function targetIsEmpty(targetDir) {
  return !fs.existsSync(targetDir) || walkFiles(targetDir).length === 0;
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function writeBundle(targetDir, bundle, { force = false, installMode = false } = {}) {
  const manifest = readManifest(targetDir);
  if (!force && !targetIsEmpty(targetDir)) {
    if (!manifest || manifest.package !== PACKAGE_NAME || manifest.skill !== SKILL_NAME) {
      throw new Error(`${targetDir} already exists and is not managed by ${PACKAGE_NAME}. Use --force to overwrite.`);
    }
    const existingHash = contentHash(currentFiles(targetDir));
    if (existingHash !== manifest.contentHash) {
      throw new Error(`${targetDir} has local changes. Use --force to overwrite.`);
    }
  }

  fs.mkdirSync(targetDir, { recursive: true });
  removeDirContents(targetDir);
  for (const [rel, body] of bundle.files) {
    const dest = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    if (rel.endsWith(".mjs") && rel.startsWith("bin/")) fs.chmodSync(dest, 0o755);
  }

  if (installMode) {
    const manifestPath = path.join(targetDir, ".kyberis-skill.json");
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    data.installedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function isStandalonePackageRoot(dir) {
  const packageJson = path.join(dir, "package.json");
  if (!fs.existsSync(packageJson)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(packageJson, "utf8"));
    return data.name === PACKAGE_NAME && fs.existsSync(path.join(dir, "source"));
  } catch {
    return false;
  }
}

function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      if (fs.existsSync(path.join(dir, "packages", "agent-skills")) || isStandalonePackageRoot(dir)) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate the @kyberis-ai/agent-skills repository root");
    dir = parent;
  }
}

function install(agent, options) {
  assertAgent(agent);
  if (agent === "github-copilot") {
    assertScope(options.scope);
    installGithubCopilot(options);
    return;
  }
  if (agent === "generic" && !options.dir) {
    throw new Error("generic installs require --dir <path>");
  }
  const target = path.resolve(options.dir || defaultInstallDirs[agent]);
  const bundle = bundleForAgent(agent, { installedAt: new Date().toISOString() });
  writeBundle(target, bundle, { force: options.force, installMode: true });
  console.log(`Installed Kyberis ${agent} skill to ${target}`);
  if (agent === "cursor" && (!options.dir || target === path.resolve(defaultInstallDirs.cursor))) {
    writeCursorRule(defaultCursorRuleFile, bundle, { force: options.force });
    console.log(`Installed Kyberis Cursor rule to ${defaultCursorRuleFile}`);
  }
}

function status(agent, options) {
  assertAgent(agent);
  if (agent === "generic" && !options.dir) {
    console.log("generic: provide --dir <path> to inspect a generic installation");
    return false;
  }
  if (agent === "github-copilot" && !options.scope) {
    console.log("github-copilot: provide --scope <project|user> to inspect an installation");
    return false;
  }
  const target =
    agent === "github-copilot"
      ? githubCopilotTargets(options.scope, options).skillDir
      : path.resolve(options.dir || defaultInstallDirs[agent]);
  const manifest = readManifest(target);
  if (!manifest) {
    console.log(`${agent}: not installed at ${target}`);
    return false;
  }
  const expected = bundleForAgent(agent);
  const existingHash = contentHash(currentFiles(target));
  const state = existingHash === expected.hash ? "up to date" : "modified or out of date";
  console.log(`${agent}: ${state} at ${target} (${manifest.version || "unknown"})`);
  return existingHash === expected.hash;
}

function updateAll(options) {
  let installed = 0;
  for (const agent of AGENTS) {
    if (agent === "generic") continue;
    const target = path.resolve(defaultInstallDirs[agent]);
    const manifest = readManifest(target);
    if (!manifest || manifest.package !== PACKAGE_NAME || manifest.skill !== SKILL_NAME) continue;
    const agentOptions = agent === "github-copilot" ? { ...options, scope: "user", dir: target } : { ...options, dir: target };
    install(agent, agentOptions);
    installed += 1;
  }
  if (installed === 0) console.log("No installed Kyberis skills found.");
}

function syncRepo() {
  const repoRoot = findRepoRoot();
  for (const agent of AGENTS) {
    if (!repoSkillDirs[agent]) continue;
    const target = path.join(repoRoot, repoSkillDirs[agent]);
    const bundle = bundleForAgent(agent);
    writeBundle(target, bundle, { force: true });
    console.log(`Synced ${agent} skill to ${path.relative(repoRoot, target)}`);
    if (agent === "cursor") {
      const ruleFile = path.join(repoRoot, repoCursorRuleFile);
      writeCursorRule(ruleFile, bundle, { force: true });
      console.log(`Synced cursor rule to ${path.relative(repoRoot, ruleFile)}`);
    }
  }
}

function checkRepo() {
  const repoRoot = findRepoRoot();
  const mismatches = [];
  for (const agent of AGENTS) {
    if (!repoSkillDirs[agent]) continue;
    const target = path.join(repoRoot, repoSkillDirs[agent]);
    const expected = bundleForAgent(agent);
    if (agent === "cursor") {
      const ruleFile = path.join(repoRoot, repoCursorRuleFile);
      if (!fs.existsSync(ruleFile) || !Buffer.from(fs.readFileSync(ruleFile)).equals(Buffer.from(cursorRuleFromBundle(expected)))) {
        mismatches.push(`cursor:${repoCursorRuleFile}`);
      }
    }
    const existing = currentFiles(target);
    const existingWithManifest = new Map(existing);
    const manifest = readManifest(target);
    if (manifest) existingWithManifest.set(".kyberis-skill.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    const expectedRels = new Set(expected.files.keys());
    const existingRels = new Set(existingWithManifest.keys());
    for (const rel of expectedRels) {
      const a = expected.files.get(rel);
      const b = existingWithManifest.get(rel);
      if (!b || !Buffer.from(a).equals(Buffer.from(b))) mismatches.push(`${agent}:${rel}`);
    }
    for (const rel of existingRels) {
      if (!expectedRels.has(rel)) mismatches.push(`${agent}:${rel}`);
    }
  }
  if (mismatches.length) {
    console.error("Generated Kyberis skill files are out of sync:");
    for (const item of mismatches) console.error(`  ${item}`);
    console.error("Run: npm run sync");
    process.exitCode = 1;
    return;
  }
  console.log("Generated Kyberis skill files are up to date.");
}

export async function main(argv) {
  const { options, positional } = parseOptions(argv);
  const command = positional[0];
  if (options.help || !command) {
    console.log(usage());
    return;
  }
  if (command === "install") {
    const agent = positional[1];
    install(agent, options);
  } else if (command === "update") {
    updateAll(options);
  } else if (command === "status") {
    const agent = positional[1];
    if (agent) status(agent, options);
    else for (const item of AGENTS) status(item, options);
  } else if (command === "sync") {
    syncRepo();
  } else if (command === "check") {
    checkRepo();
  } else {
    throw new Error(`Unknown command '${command}'.\n\n${usage()}`);
  }
}

export const internals = {
  bundleForAgent,
  contentHash,
  defaultInstallDirs,
  readManifest,
  status,
  writeBundle,
  writeCursorRule,
  githubCopilotTargets,
  registerVsCodeCopilotSkillsLocation,
  agentSkillsLocationGlob,
  vsCodeUserSettingsFile,
  tildeRelativePath,
};

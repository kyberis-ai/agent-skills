# @kyberis-ai/agent-skills

Installer and canonical source for Kyberis agent skills for Codex, Claude, Cursor, Windsurf, GitHub Copilot, and generic agents.

## Install a skill

```bash
npx -y @kyberis-ai/agent-skills install codex
npx -y @kyberis-ai/agent-skills install claude
npx -y @kyberis-ai/agent-skills install cursor
npx -y @kyberis-ai/agent-skills install windsurf
npx -y @kyberis-ai/agent-skills install github-copilot --scope project
npx -y @kyberis-ai/agent-skills install github-copilot --scope user
npx -y @kyberis-ai/agent-skills install generic --dir ./kyberis-agent-skill
```

The installer writes the Kyberis skill into the agent's local skill directory:

- Codex: `~/.codex/skills/kyberis`
- Claude: `~/.claude/skills/kyberis`
- Cursor: `~/.cursor/skills/kyberis` plus `~/.cursor/rules/kyberis.mdc` for automatic Agent selection
- Windsurf: `~/.codeium/windsurf/skills/kyberis`
- GitHub Copilot (`--scope project`): `<repo>/.github/skills/kyberis` — GitHub Copilot's Agent Skills feature auto-discovers this by default
- GitHub Copilot (`--scope user`): `~/.copilot/skills/kyberis` — also auto-discovered by default; a custom `--dir` outside that default location is registered via `chat.agentSkillsLocations` in your VS Code user `settings.json`
- Generic: the directory passed with `--dir`

Use `--dir <path>` to install to a custom directory. Generic installs require `--dir` because unsupported agents do not share a standard skill path. `github-copilot` installs require `--scope <project|user>`; `--dir` optionally overrides the project root (project scope) or the skill bundle directory (user scope).

### GitHub Copilot

GitHub Copilot's [Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills) feature (the same `SKILL.md`-based open standard this package already targets for Codex/Claude/Cursor/Windsurf) auto-discovers skills from a fixed set of default directories, with no settings.json changes required in the common case:

- Project scope writes to `.github/skills/kyberis`, one of the default project skill locations, so committing it is enough:

  ```bash
  cd my-repo
  npx -y @kyberis-ai/agent-skills install github-copilot --scope project
  ```

- User scope writes to `~/.copilot/skills/kyberis` by default, one of the default personal skill locations that applies across all of your repositories:

  ```bash
  npx -y @kyberis-ai/agent-skills install github-copilot --scope user
  ```

If you pass `--dir` to relocate a user-scope install outside `~/.copilot/skills`, the installer registers that directory's parent as a `chat.agentSkillsLocations` glob (e.g. `~/custom/skills/**`) in your VS Code user `settings.json` so Copilot still finds it — this is the only case that touches `settings.json`. That update preserves comments and formatting in an existing JSONC settings file, and is safe to re-run.

VS Code's user `settings.json` location is resolved per-OS (`%APPDATA%\Code\User\settings.json` on Windows, `~/Library/Application Support/Code/User/settings.json` on macOS, `$XDG_CONFIG_HOME/Code/User/settings.json` or `~/.config/Code/User/settings.json` on Linux). Set `KYBERIS_VSCODE_SETTINGS_FILE` to point at a different settings file (for example, VS Code Insiders) if needed.

See `src/cli.mjs` for the source/date this default-location and setting-name behavior was confirmed against VS Code/GitHub's docs, and re-check if a `--dir` install stops showing up in Copilot after a VS Code/Copilot update.

## Generic agents

For agents that are not directly supported, install the generic bundle and then point the agent at the generated folder or import its `SKILL.md` and `references/api-reference.md` files according to that agent's custom instruction mechanism.

```bash
npx -y @kyberis-ai/agent-skills install generic --dir ./kyberis-agent-skill
```

## Update installed skills

```bash
npx -y @kyberis-ai/agent-skills@latest update
```

`update` refreshes any installed Kyberis skill that has a Kyberis-generated manifest. If local edits are detected, the installer refuses to overwrite unless `--force` is provided.

## Commands

```bash
kyberis-agent-skills install <codex|claude|cursor|windsurf> [--dir <path>] [--force]
kyberis-agent-skills install github-copilot --scope <project|user> [--dir <path>] [--force]
kyberis-agent-skills install generic --dir <path> [--force]
kyberis-agent-skills update [--force]
kyberis-agent-skills status [codex|claude|cursor|windsurf|generic] [--dir <path>]
kyberis-agent-skills status github-copilot --scope <project|user> [--dir <path>]
kyberis-agent-skills sync
kyberis-agent-skills check
```

`sync` and `check` are repository maintenance commands. They keep `.codex/skills/kyberis`, `.claude/skills/kyberis`, `.cursor/skills/kyberis`, `.cursor/rules/kyberis.mdc`, `.windsurf/skills/kyberis`, and `.github/skills/kyberis` in sync with this package's canonical source.

## Runtime setup

The skill prefers a configured Kyberis MCP server. Direct REST fallback uses the `/v2` API prefix and requires:

```bash
export KYBERIS_BASE_URL="https://api.kyberis.ai"
export KYBERIS_API_KEY_ID="<key_id>"
export KYBERIS_API_KEY_SECRET="<secret>"
```

## Contributing

Issues and pull requests are welcome.

This repository contains the canonical source for the Kyberis agent skill installer and generated skill bundles. When changing skill content, edit files under `source/` first, then run:

```bash
npm run sync
npm run check
npm test
npm pack --dry-run
```

Generated skill directories such as `.codex/`, `.claude/`, `.cursor/`, `.windsurf/`, and `.github/` should stay in sync with `source/`.

By contributing, you agree that your contributions are licensed under the Apache License 2.0.

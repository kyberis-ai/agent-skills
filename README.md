# @kyberis-ai/agent-skills

Installer and canonical source for Kyberis agent skills for Codex, Claude, Cursor, Windsurf, and generic agents.

## Install a skill

```bash
npx -y @kyberis-ai/agent-skills install codex
npx -y @kyberis-ai/agent-skills install claude
npx -y @kyberis-ai/agent-skills install cursor
npx -y @kyberis-ai/agent-skills install windsurf
npx -y @kyberis-ai/agent-skills install generic --dir ./kyberis-agent-skill
```

The installer writes the Kyberis skill into the agent's local skill directory:

- Codex: `~/.codex/skills/kyberis`
- Claude: `~/.claude/skills/kyberis`
- Cursor: `~/.cursor/skills/kyberis` plus `~/.cursor/rules/kyberis.mdc` for automatic Agent selection
- Windsurf: `~/.codeium/windsurf/skills/kyberis`
- Generic: the directory passed with `--dir`

Use `--dir <path>` to install to a custom directory. Generic installs require `--dir` because unsupported agents do not share a standard skill path.

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
kyberis-agent-skills install generic --dir <path> [--force]
kyberis-agent-skills update [--force]
kyberis-agent-skills status [codex|claude|cursor|windsurf|generic] [--dir <path>]
kyberis-agent-skills sync
kyberis-agent-skills check
```

`sync` and `check` are repository maintenance commands. They keep `.codex/skills/kyberis`, `.claude/skills/kyberis`, `.cursor/skills/kyberis`, `.cursor/rules/kyberis.mdc`, and `.windsurf/skills/kyberis` in sync with this package's canonical source.

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

Generated skill directories such as `.codex/`, `.claude/`, `.cursor/`, and `.windsurf/` should stay in sync with `source/`.

By contributing, you agree that your contributions are licensed under the Apache License 2.0.

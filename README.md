# @kyberis-ai/agent-skills

Installer and canonical source for Kyberis agent skills for Codex, Claude, Cursor, and Windsurf.

## Install a skill

```bash
npx -y @kyberis-ai/agent-skills install codex
npx -y @kyberis-ai/agent-skills install claude
npx -y @kyberis-ai/agent-skills install cursor
npx -y @kyberis-ai/agent-skills install windsurf
```

The installer writes the Kyberis skill into the agent's local skill directory:

- Codex: `~/.codex/skills/kyberis`
- Claude: `~/.claude/skills/kyberis`
- Cursor: `~/.cursor/skills/kyberis` plus `~/.cursor/rules/kyberis.mdc` for automatic Agent selection
- Windsurf: `~/.codeium/windsurf/skills/kyberis`

Use `--dir <path>` to install to a custom directory.

## Update installed skills

```bash
npx -y @kyberis-ai/agent-skills@latest update
```

`update` refreshes any installed Kyberis skill that has a Kyberis-generated manifest. If local edits are detected, the installer refuses to overwrite unless `--force` is provided.

## Commands

```bash
kyberis-agent-skills install <codex|claude|cursor|windsurf> [--dir <path>] [--force]
kyberis-agent-skills update [--force]
kyberis-agent-skills status [codex|claude|cursor|windsurf] [--dir <path>]
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

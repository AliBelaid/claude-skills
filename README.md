# Claude skills

Skills for Claude Code (and any agent that reads `SKILL.md`). Packaged as the plugin `dev-workflow-skills` in the marketplace `ali-claude-skills`.

| Skill | What it does |
|---|---|
| `app-guide-video` | Records a web app's screens with Playwright (1920×1080, 100% zoom), turns them into small MP4 clips, and combines them into one narrated video (sped up, under a size limit). `scripts/run_flow.py` runs a whole multi-chapter flow, passes IDs between chapters, and runs hooks. Works for any app with a login. |
| `ultrathink` | A careful reasoning method for hard questions: assumptions, hypotheses, evidence, then a verified answer. |
| `github-search` | Searches GitHub (repos, code, issues, PRs, releases) with the `gh` CLI and checks a project's health and licence before use. |
| `network-troubleshooting` | Layer-by-layer diagnosis of connection problems: DNS, route, port, TLS certificate, HTTP. macOS, Windows and Linux. |

## Install as a plugin (recommended)

In Claude Code:

```
/plugin marketplace add AliBelaid/claude-skills
/plugin install dev-workflow-skills@ali-claude-skills
```

## Install by copying

Copy the folders you want into your skills directory:

```bash
mkdir -p ~/.claude/skills
cp -R plugins/dev-workflow-skills/skills/<skill-name> ~/.claude/skills/
```

Then start a new Claude Code session. Skills load from `~/.claude/skills/`.

## Requirements
- `app-guide-video`: Node 18+, Playwright (`playwright-core`), Chrome, ffmpeg. Narration uses macOS `say` by default.
- `github-search`: GitHub CLI (`gh`), logged in with `gh auth login`.
- `network-troubleshooting`: standard OS tools (`dig`, `openssl`, `curl`, `ss` or PowerShell networking cmdlets).

## Safety
- Nothing here stores passwords or tokens. Secrets are read from environment variables.
- `app-guide-video` creates data when it runs. Use a local or demo copy of the app.
- `network-troubleshooting` runs read-only checks by default and only on hosts you are allowed to test.

## Licence

MIT. See `LICENSE`.

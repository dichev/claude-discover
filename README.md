# Claude Discover


Reads from `~/.claude/projects/**/*.jsonl`.

## Dev

```
npm install
npm run dev
```

## Production

**macOS:**
- double-click `start.command` (auto-updates and starts the app)

**Windows:**
```
npm install
npm run build
npm start
```

## Verifying token/cost calculations

`bin/usage.mjs` prints the app's per-period token usage and cost as a terminal table. 
Compare it against [ccusage](https://github.com/ryoppippi/ccusage) in UTC to verify the numbers — the two should match:

```
node bin/usage.mjs monthly --timezone UTC
npx ccusage claude monthly -z UTC
```

## Optional: capture API requests

Claude Code doesn't save your system prompt, CLAUDE.md and memory instructions in its session logs, so this app can't show them as a context. Use the **Capture proxy → Activate** button in the app's status bar to launch a local logging proxy that records Claude Code's raw API traffic — the captured system prompts and memory files then show up in the Conversation tab, and the full requests/responses in the Requests tab.

## Optional: status line and retention

The app's status bar can also configure Claude Code itself — each footer item has an **Activate/Deactivate** button in its tooltip: **Status line** installs `bin/claude/statusline.mjs` as your Claude Code status line (showing context/token usage and rate limits), and **Session logs retained** raises `cleanupPeriodDays` so transcripts stay browsable for a year.

Older versions of this app installed a capture-context hook, retired in favor of the proxy — `node bin/remove-context-logs-and-hooks.mjs` removes its settings.json entries and leftover `<session>.context.ndjson` sidecars (dry-run; `--force` to remove).

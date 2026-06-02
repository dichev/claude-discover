# Claude Discover


Reads from `~/.claude/projects/**/*.jsonl`.

## Dev

```
npm install
npm run setup-hook
npm run dev
```

## Production

**macOS:**
- double-click `start.command` (auto-updates and starts the app)

**Windows:**
```
npm install
npm run setup-hook # optional
npm run build
npm start
```

## Verifying token/cost calculations

`bin/usage.mjs` prints the app's per-period token usage and cost as a terminal table. 
Compare it against [ccusage](https://github.com/ryoppippi/ccusage) (which is in UTC) to verify the numbers — the two should match:

```
node bin/usage.mjs monthly --timezone UTC
npx ccusage monthly
```

## Optional: capture initial context

Claude Code doesn't save your CLAUDE.md and memory instructions in its session logs, so this app can't show them as a context. You can install a Claude hook that snapshots that context alongside each session in a separate file:

- `<session>.jsonl` — the transcript
- `<session>.context.ndjson` — the context snapshot

Then your CLAUDE.md and memory content show up in the Conversation and JSONL tabs. 
```
npm run setup-hook   # auto-installs the hook into <CLAUDE_DIR>/settings.json
```

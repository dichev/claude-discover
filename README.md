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

## Optional: capture initial context (CLAUDE.md)

Claude Code doesn't save your CLAUDE.md instructions in its session logs, so this app can't show them as a context. You can install a Claude hook that logs that context alongside each session in a separate file:

- `<session>.jsonl` — the transcript
- `<session>.context.ndjson` — the context snapshot

Then your CLAUDE.md content shows up in the Conversation and JSONL tabs. Run `npm run setup-hook` to install the hook into `<CLAUDE_DIR>/settings.json`.

### Notes

- Only sessions started **after** the hook is installed will have captured context. Past sessions remain unsnapshotted.
- The hook captures CLAUDE.md / memory files Claude Code reports via the `InstructionsLoaded` event (project, user-global, nested, includes). On `SessionStart` it also snapshots the project's auto-memory `MEMORY.md` from disk — Claude Code doesn't fire a hook for auto-memory, so this is a best-effort guess based on the conventional path; we can't confirm the model actually loaded it, or that the on-disk contents match what was injected. It does not capture per-turn `<system-reminder>` blocks (skill listings, deferred tools, auto-mode banner).
- Files larger than 1 MB are recorded as a reference only (no content).
- Errors are logged to `<CLAUDE_DIR>/.claude-discover.hook.error.log` so a broken hook never blocks a session.

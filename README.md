# Agentic Workflow


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

## Optional: capture initial context (CLAUDE.md)

Claude Code's jsonl transcripts don't record CLAUDE.md. Wire the bundled hook into `~/.claude/settings.json` to snapshot them into a `<session>.context.ndjson`:

```json
{
  "hooks": {
    "InstructionsLoaded": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/agentic-workflow/bin/capture-context.hook.mjs" }] }
    ]
  }
}
```

On Windows use forward slashes (`D:/AI/...`) — backslashes get eaten as shell escapes. After this, captured instructions appear inline in the Conversation and JSONL tabs.

### Notes

- Only sessions started **after** the hook is installed will have captured context. Past sessions remain unsnapshotted.
- The hook captures CLAUDE.md / memory files Claude Code reports via the `InstructionsLoaded` event (project, user-global, nested, includes). It does **not** capture Claude Code's auto-memory (`MEMORY.md`) — that's injected directly into the system prompt and never fires a hook. It also does not capture per-turn `<system-reminder>` blocks (skill listings, deferred tools, auto-mode banner).
- Files larger than 1 MB are recorded as a reference only (no content).
- Errors are logged to `~/.claude/capture-context.error.log` so a broken hook never blocks a session.

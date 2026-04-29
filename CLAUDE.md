# CLAUDE.md

Read-only Electron desktop browser for local Claude Code session transcripts.

## Commands

- `npm run dev` — Vite dev server + Electron.
- `npm run build` / `npm start` — build / preview.
- No tests, lint, or typecheck configured.

## Architecture
- Two processes. All disk I/O lives in `electron/` (main + preload); the renderer (`src/`) reaches it only through `window.discover` exposed via `contextBridge`.
- Data source: `~/.claude/projects/**/*.jsonl` (sessions).
- Electron backend uses classes; React frontend uses functional style
- Built with **electron-vite**

## Style
- No semicolons in JS/JSX

## UI testing

With `npm run dev` running, use the Playwright MCP server (configured in `.mcp.json`) to inspect the frontend. It connects to the Electron app over CDP at `http://localhost:9333` — use the `mcp__playwright__*` tools to navigate, snapshot, click, evaluate, etc.

The CDP port (`9333`) is configured in `electron/main.js` via `app.commandLine.appendSwitch('remote-debugging-port', '9333')` when not packaged.

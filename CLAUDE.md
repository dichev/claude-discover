# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read-only Electron desktop browser for local Claude Code session transcripts.

## How to install and update the app on macOS
```
git fetch
git reset --hard origin/main
npm install
npm run build
npm start
```

## Commands

- `npm run dev` — Vite dev server + Electron.
- `npm run build` / `npm start` — build / preview.
- No tests, lint, or typecheck configured.

## Architecture
- Two processes. All disk I/O lives in `electron/` (main + preload); the renderer (`src/`) reaches it only through `window.api` exposed via `contextBridge`.
- Data source: `~/.claude/projects/**/*.jsonl` (sessions).
- Date-scoped: the frontend picks a single date and the backend returns sessions only for that date. Neither side needs to handle multi-day ranges.
- Electron backend uses classes (`electron/services/`); React frontend uses functional style.
- Built with **electron-vite**

## IPC surface (`window.api`)
- `listSessions(date)` — returns session metadata array for a `yyyy-MM-dd` date string; also pushes live updates via `onSessionsUpdate`.
- `readSession(id, offset, date)` — streams conversation entries for a session.
- `getWorkHours()` / `setWorkHours(data)` — persist daily work-hour settings.

## Key frontend components
- `GanttChart` — timeline swimlane view across the day; drives `sourceFilter` and `cwdFilter`.
- `SessionList` — filterable list of sessions for the selected day.
- `SessionDetail` / `ConversationView` — renders a single session's message thread.
- `DailySummary` — aggregated stats (cost, tokens, time) for the day.

## Style
- No semicolons in JS/JSX
- IPC channel names use `namespace:kebab-case-action` (e.g. `sessions:read-log-file`, not `sessions:readLogFile`)

## UI testing

With `npm run dev` running, use the Playwright MCP server (configured in `.mcp.json`) to inspect the frontend. It connects to the Electron app over CDP at `http://localhost:9333` — use the `mcp__playwright__*` tools to navigate, snapshot, click, evaluate, etc.

The CDP port (`9333`) is configured in `electron/main.js` via `app.commandLine.appendSwitch('remote-debugging-port', '9333')` when not packaged.

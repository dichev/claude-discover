# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

Read-only Electron desktop browser for local Claude Code session transcripts and Claude API requests.

Windows is the default OS, but we support also macOS and Linux. 

## Commands

- `npm run dev` — Vite dev server + Electron.
- `npm run build` / `npm start` — build / run the built app.
- `vitest run --reporter=tree` — run the Vitest suite.
- `node bin/proxy.mjs --restart` — start/restart the API request-capture proxy in the foreground (does not touch settings.json).
- `node bin/usage.mjs` — print per-period token usage/cost from local transcripts
- UI testing: `npm run dev`, then the `mcp__playwright__*` tools (attach over CDP port `9333`, dev-only).


## File structure

Not a hard constraint — restructure when it serves the code, just update this tree.

```
.
├── bin/                            standalone scripts, no imports from src/ 
│   ├── claude/
│   │   ├── hooks.mjs               single dispatcher for every Claude Code hook this app installs
│   │   └── statusline.mjs          the installed statusLine command
│   ├── proxy.config.js             proxy config (port, routes, ping body, log paths) — imported by bin/ and src/main/
│   ├── proxy.mjs                   API request-capture logging proxy
│   └── usage.mjs                   CLI: per-period token usage/cost table
├── cache/                          pricing rates — committed seed + daily LiteLLM refresh
├── src/
│   ├── main/                       main process (OOP): entry point, app menu, path/config resolution
│   │   ├── requests/               captured-request reading & parsing
│   │   ├── services/               backend services + the StatusBar switchers
│   │   ├── sessions/               transcript scanning, caching & parsing
│   │   └── windows/                the app window + the find-bar overlay
│   ├── preload/                    contextBridge preloads (main window + find overlay)
│   └── renderer/                   React frontend (functional)
│       ├── agent/                  analysis-agent UI + prompt template
│       ├── assets/                 images imported by the UI
│       ├── find/                   standalone find-bar page (own renderer entry)
│       ├── sessions/               session list + detail views (Conversation/JSONL/Requests/Agent tabs)
│       ├── timeline/               period views (Daily/Weekly/Monthly)
│       ├── ui/                     generic primitives + the status bar
│       └── utils/                  shared hooks & helpers
├── test/                           Vitest suites + fixtures
└── electron.vite.config.js         build config: main, two preloads, two renderer entries
```

## Architecture

- Two processes. All disk I/O lives in `src/main/` and `src/preload/`; the renderer (`src/renderer/`) reaches it only through `window.api` exposed via `contextBridge`.
- Renderer runs with `sandbox: true` (plus `contextIsolation`, no `nodeIntegration`). Sandboxed preloads must be **single self-contained CommonJS files** — the preload build outputs `.cjs`, and each preload may `require('electron')` only. Don't add cross-file imports to `src/preload/*` (the shared `subscribe` helper is inlined in each preload, kept in sync by hand); a shared chunk can't be `require`d in the sandbox.
- Data source: `<CLAUDE_DIR>/projects/**/*.jsonl` (sessions). `CLAUDE_DIR` is resolved in `src/main/paths.js` — user override in `~/.claude-discover/config.json` (`claudeDir`, plus the source-switcher's `recents`) wins over `$CLAUDE_CONFIG_DIR`, which wins over `~/.claude`. Read/persist that file only via the `Config` service (`src/main/services/Config.js`).
- Date-scoped: the frontend picks a single date and the backend returns sessions only for that date — neither side handles multi-day ranges. Period range math is shared: `periodBounds` in `SessionsService.js`, mirrored by `src/renderer/utils/period.js`.
- Session scanning (`src/main/sessions/`): `SessionsScanner` watches the projects dir via chokidar and, after one full walk, serves scans from the watcher-fed `StatCache` instead of re-walking disk; `SessionFile`/`SessionParser` parse individual `.jsonl` files; `MetaCache` caches session metas keyed by size+mtime.
- `SessionsService.scan(period, { watch })` is the single scan entry point: `watch:true` (UI) streams `update` events per dir batch and returns the cache immediately; `watch:false` (CLIs/tests like `bin/usage.mjs`) awaits the full scan and returns the deduped sessions with no emits.
- Long-lived backend services that push to the renderer extend `EventEmitter` — wire listeners with `service.on(event, cb)` before calling `start()`.
- Agent feature: `AgentRunner` (main) runs `@anthropic-ai/claude-agent-sdk`'s `query()` in-process and streams `text_delta` chunks to the renderer over `agent:output`. Renderer side is `src/renderer/agent/`; the prompt template `ANALYZE_PROMPT.md` is imported via Vite's `?raw`.
- Pricing: `Pricing` computes per-session USD cost. Seed rates in `cache/prices.json`, refreshed daily from LiteLLM into `cache/prices.current.json`; a refresh that changes the table emits `update`, on which `SessionsService` drops its meta cache and reparses the watched period (costs are baked into metas at parse time); dated/versioned model variants collapse to one id and `priceFor` matches by longest key prefix. "Fast" sessions (`usage.speed === "fast"`) bill at a per-model `fastModeMplr`; when the multiplier is unknown, `SessionParser` flags `fastPricingUnknown` and falls back to 1×.
- Instructions capture: transcripts never record the system prompt or the loaded CLAUDE.md / memory files, so `readSession` extracts them from the captured API requests (`RequestFile.readInstructions()`) and returns them as a separate `instructions` list alongside `items` — claudeMd sections deduped by path, system prompts by hash, tool definitions per tool name; first sight wins. The renderer merges them into the conversation by timestamp in `transcript.js`'s `flatten(items, instructions)`, shown by `ConversationView`'s `InstructionFile`; `JsonlView` stays raw transcript only.
- Request capture: `bin/proxy.mjs` is a logging proxy that forwards Claude Code's API traffic verbatim to `api.anthropic.com` and appends one NDJSON record per request (any endpoint, count_tokens included) to `~/.claude-discover/requests/<sessionId>.requests.jsonl` — raw request + headers (credentials redacted) + response with headers (SSE streams reassembled by `assembleSSE`). The requests dir is **global** (`PROJECT_DIR` in `bin/proxy.config.js`; its `$CLAUDE_DISCOVER_DIR` override is used only by tests): session ids are unique, so one flat dir serves every Claude dir/config on the machine and the proxy needs no per-dir config, restart, or notion of which Claude dir a request belongs to. Capture must never fail or delay a request — errors go to `~/.claude-discover/proxy.error.log`. Port `41414` (`$CLAUDE_DISCOVER_PORT`/`$CLAUDE_DISCOVER_UPSTREAM` overrides used only by tests); at startup it verifies the upstream is reachable and exits with code 2 if not; `--restart` replaces a running instance via the loopback-only `/claude-discover/exit` control route. `GET /claude-discover/ping` is answered directly, never forwarded — `ProxySwitch` probes it for the StatusBar.
  - Dedup keeps logs linear: `system`/`tools`/each message is logged in full (`{ $hash, value }`) only the first time its hash appears in the session, then as `{ $ref }` — recursively, so any nested object/array element (content blocks, tool schemas) is deduped individually too. The seen-set is warmed from the log on restart. Readers must resolve refs by scanning the whole file before period-filtering — a ref's target may live in an out-of-range record. That reading lives in `src/main/requests/` (`RequestFile` does file I/O, `RequestParser` ref resolution + `classifyRequest` + memory-file extraction) and surfaces in the renderer's `RequestsView` via `readRequests`.
  - Claude Code is pointed at the proxy by the StatusBar's Activate button (see the **proxy** switch below): `env.ANTHROPIC_BASE_URL` plus `ENABLE_TOOL_SEARCH=true` (Claude Code otherwise disables Tool Search under any custom base URL; our proxy forwards the round-trip fine), plus a `SessionStart` hook running `bin/claude/hooks.mjs` (the hook dispatcher — future hooks are new branches in it, not new scripts). The hook pings the proxy and revives it detached when down — covering the case where the env keys survived a PC restart while the process didn't — warning on stderr only (a SessionStart hook's stdout is injected into context).
- Find bar: native Chromium find (`webContents.findInPage`) rendered in a **separate `WebContentsView` overlay**, never in the app DOM — `findInPage` matches `<input>` values, so an in-page box would count itself, and its focus would trap next/prev on the first match. `src/main/windows/FindBar.js` owns the view and loads the standalone bar in `src/renderer/find/` with its **own preload** (`src/preload/findPreload.js`), so the find IPC is exposed only to the find view. `CmdOrCtrl+F` shows it; `Escape` is routed through `buildAppMenu`'s `onEscape` to close the bar when open. The `find:*` IPC handlers delegate to `FindBar`, which acts on the app content (`this.win.webContents`) — never on `e.sender` (the find view). Stale results from superseded keystrokes are dropped via Chromium's monotonic `requestId`.

## IPC surface (`window.api`)

- `listSessions(date)` — session metadata array for a `yyyy-MM-dd` date; live updates pushed via `onSessionsUpdate`.
- `onScanProgress(cb)` — scan progress `{ done, total, scanning }` (project-dir counts) driving the StatusBar loading bar; rides its own event and is not emitted on the `watch:false` path.
- `readSession(id, date, granularity)` — conversation entries plus captured instructions (used by `ConversationView` and `JsonlView`; backend filters lines to the period). Always parses the whole file — live updates re-read it on `fileSize` change so the parser's running token totals stay correct.
- `readRequests(id, date, granularity)` — the session's captured API requests, `$ref`s resolved and period-filtered; `[]` when no log exists. Feeds `RequestsView`.
- `getSwitchStatus(name)` / `activateSwitch(name)` / `deactivateSwitch(name)` — one generic surface for the StatusBar switches, backed by `Switchers` (`src/main/services/switchers/`). Each `*Switch` holds pure feature logic — `status()` plus `activate()`/`deactivate()` that do the work or **throw** a friendly message; `Switchers.#attempt` maps every outcome to fresh status plus an optional `error` string alerted by the tooltip button. A new switch is a new `*Switch` class plus a `#switches` map entry. `StatusSwitch.jsx`'s `useSwitch` polls status every 5s so external settings.json edits show up live; a `StatusSwitch` given a custom `button` label renders an action button that always activates.
  - **proxy** — `{ running, configured }` (ping probe + whether `env.ANTHROPIC_BASE_URL` points at the proxy); configured + not running ⇒ Claude Code can't reach the API, shown as ⚠ DOWN. Activate spawns the proxy detached via `ELECTRON_RUN_AS_NODE` (so it outlives the app) and writes settings.json (env keys + revive hook) only once the proxy is up — a failed activate never changes it, and a foreign base URL is never overwritten (activate errors instead). Deactivate exits the proxy through the control route and removes the env keys and hook. `ProxySwitch` is the sole owner of that config; the proxy's port, route paths and ping body are defined once in `bin/proxy.config.js` (the only proxy file the app imports; the renderer doesn't import from bin/, so StatusBar's tooltip hardcodes the URL).
  - **statusline** — `{ installed }`. Activate installs `bin/claude/statusline.mjs` as the settings.json `statusLine` command; a different configured status line is never overwritten — activate errors instead.
  - **retention** — `{ days, raised }` (`days` defaults to Claude Code's 30; `raised` = ≥ 365). Activate raises `cleanupPeriodDays` to 365 so a year of transcripts stays browsable (an already-higher value is left as is); deactivate removes the setting.
  - **claudedir** — `{ dir }`. Action-style ("Change directory", no off state — deactivate throws): opens a folder picker, persists the choice to `~/.claude-discover/config.json` and relaunches. The File menu's source-switcher reuses `ClaudeDirSwitch`'s browse/switch logic.
- `getWorkHours()` / `setWorkHours(data)` — persist daily work-hour settings.
- `runAgentPrompt(text, systemTools)` / `onAgentOutput(cb)` — start the analysis agent and subscribe to its streamed output.
- `findInPage` / `stopFind` / `findClose` / `onFindResult` / `onFindOpen` — native find-in-page, exposed by the find overlay's own preload on **its** `window.api`, not the main window's (see Find bar).
- `openLink(href, baseFile)` — open a link from rendered markdown via the OS shell: http(s)/mailto → `shell.openExternal`; relative paths → resolved against `baseFile`'s dir and opened with `shell.openPath`. The renderer has no navigation guard, so `ui/Markdown.jsx` intercepts every link click and hands it here; local links render clickable only when the caller passes a `basePath` (instruction/memory files pass their own `file_path`).

## Frontend layout

- `src/renderer/timeline/` — granularity selected via `Toolbar`'s tabs: `GanttChart` (swimlane; drives `sourceFilter`/`projectFilter`; composes `HeatStrip`, `TimeAxis`, `WorkTimeOverlay`) and `PeriodSummary` (aggregated stats, includes `CostBreakdownChart`).
- `src/renderer/sessions/` — `SessionList` (picker, left pane), `Session` (detail container with the tabs), `SessionSummary` (right-hand metadata column).
- `src/renderer/sessions/view/` — the pieces `Session` composes: `ConversationView`, `JsonlView`, `RequestsView` (Postman-like inspector for captured requests), `AgentView` (builds the markdown payload sent to the agent; the run/stream UI is `agent/AgentOutput.jsx`), and `transcript.js` — the pure transcript model (`flatten`/`groupTurns`/`tokenPoints`/…) shared by `ConversationView`, `MarkdownSession` and `SessionList`.
- `src/renderer/sessions/MarkdownSession.js` — `markdownSession(meta, items, truncated)` renders a session (summary + transcript) to the markdown payload fed to the agent and shown in the Agent tab. It duplicates information from `ConversationView.jsx` and `SessionSummary.jsx` — when you add, remove, or change fields/blocks in either of those files, also update `MarkdownSession.js` to keep them in sync.
- `src/renderer/ui/` — generic primitives (`Toggle`, `Markdown`) plus `StatusBar` (footer with the switch tooltips). `Markdown` is the single ReactMarkdown wrapper — GFM + syntax highlighting, safe links via `openLink`, chunked lazy mounting for huge texts, and opt-in fence repair (`autoFence`) for text never authored as markdown. Every markdown surface renders through it; **don't instantiate ReactMarkdown directly**.
- `src/renderer/utils/useLocalStorage.js` — `useLocalStorage(key, initial)` is a `useState` drop-in persisted to `localStorage`; use it for any UI preference that should survive reloads. Its `clearOutdatedLocalStorage()` (called from `main.jsx`) wipes storage on major/minor version bumps — don't rely on values surviving releases.
- `src/renderer/styles.css` — app-wide CSS, imported by `main.jsx`. Component styles live next to their component.

## Claude Code settings (settings.json)

- Everything this app writes into `<CLAUDE_DIR>/settings.json` is owned by a switch in `src/main/services/switchers/` (see IPC surface). There is no setup script.
- Switches go through `src/main/services/ClaudeSettings.js` — a thin settings.json wrapper with hook / statusLine / env helpers and `save()`, which refuses to write if the file changed on disk since load (mtime guard).
- Hooks and the status line are matched by **basename** of the script file so a stale absolute path is repaired in place. `STATUSLINE_PATH` (`src/main/paths.js`) resolves relative to the source tree, so the installed command always points at this checkout.

## Code Style

- **Backend (`src/main/`) is OOP** — every service/module is a class
- **Frontend (`src/renderer/`) is functional** — React components are function components, state is hooks, shared logic lives in custom hooks
- No semicolons in JS/JSX
- Single-argument arrow functions: omit parens (`x => ...`, not `(x) => ...`)
- Align consecutive React `use*` hook declarations: pad the destructured pair with spaces so the `=` (and the hook calls after it) line up in a column.
- IPC channel names use `namespace:kebab-case-action` (e.g. `sessions:read-log-file`, not `sessions:readLogFile`)
- Prefer clean single-line code comments, over multiline explanations
- No lint or typecheck configured.
- When adding an OS-specific fix, add comment `// @macOS` or `// @linux`

## UI testing / debugging

**Ask before running Playwright UI testing** — don't drive the app via Playwright MCP unless the user has confirmed.

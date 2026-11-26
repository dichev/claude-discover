# CLAUDE.md

An Electron desktop app that reads **your local Claude Code data** and shows it as a timeline: sessions, conversations, token usage/cost, and (optionally) the raw API traffic captured by a bundled local proxy. Everything is local — no API keys, no telemetry. Published to npm as `claude-discover` (`npx claude-discover`).

Developed on Windows; macOS and Linux are also supported.

## Commands

```bash
npm run dev           # electron-vite dev — hot reload, renderer on :5555, CDP on :9333 (kills a dev already holding them)
npm run build         # electron-vite build → out/{main,preload,renderer}
npm start             # run the built app (electron .)
npm test              # vitest run --reporter=tree
npm run test:live     # same + the live passes (real ~/.claude vs ccusage, LiteLLM prices) — gates publish:patch
npm run lint          # eslint . — must pass after every change (style rules live in eslint.config.js)
npm run proxy         # run the capture proxy standalone (bin/proxy.mjs --restart)
npm run smoke:local   # npm pack + launch the tarball via npx (npx cache, no shortcuts)
npm run smoke:global  # npm pack + npm i -g the tarball and launch it (npm uninstall -g claude-discover after)
```

To verify token/cost math against `ccusage` (must match to the cent — pin UTC on both sides):
```bash
node test/scripts/usage.mjs monthly --timezone UTC
npx ccusage claude monthly -z UTC
```

## File structure

Not a hard constraint — restructure when it serves the code, just update this tree.

```
.
├── bin/                            standalone scripts, no imports from src/
│   ├── claude-discover.mjs         npm bin entry — spawns the local Electron binary on the package root (npx claude-discover)
│   ├── claude/
│   │   └── statusline.mjs          the installed statusLine command
│   ├── proxy.config.js             proxy config (port, routes, ping body, log paths) — imported by bin/ and src/main/
│   └── proxy.mjs                   API request-capture logging proxy
├── src/
│   ├── main/                       main process (OOP): entry point, app wiring & menu (Application), path/config resolution
│   │   ├── config/                 the app's own config: ConfigFile (~/.claude-discover/config.json) + pricing seed
│   │   ├── mcp/                    the MCP server other Claude Code sessions list sessions through: its HTTP endpoint, its tools (tools/: one class each, its reply's mustache template beside it as .md, what they share in utils.js), and how sessions read on screen, for the tools to answer with (sessions/fromRenderer.js)
│   │   ├── requests/               API-request reading & parsing (the proxy's log + the transcript's own request records)
│   │   ├── services/               backend services (LoginService = a generic per-OS login service) + the StatusBar switchers
│   │   ├── sessions/               transcript scanning, caching, parsing & reading (SessionsReader: a period's sessions, a transcript's records), each turn's MCP servers (request tools + debug log) (utils/: the file watchers; usage/: what a reply bills — token buckets, the advisor's calls)
│   │   └── windows/                the app window (find bar: electron-find-overlay) + the tray icon it hides to
│   ├── preload/                    contextBridge preload (main window)
│   ├── shared/                     pure helpers both main and renderer import (Claude Code's listing formats, the user's own attachment types, a reply's context size, offline Claude token counts in tokenizer/)
│   └── renderer/                   React frontend (functional)
│       ├── agent/                  AI agent hook (analyze + ask), output + prompt templates
│       ├── assets/                 images imported by the UI
│       ├── sessions/               session list + detail views (Conversation/JSONL/Requests tabs) + the summary's context breakdown (context/) and its events to jump to, also named beside the conversation's timeline dots: compactions, rewinds, mode/model/effort changes, … (events/)
│       ├── timeline/               period views (Daily/Weekly/Monthly) + the work-hours band
│       ├── ui/                     generic primitives + the status bar
│       ├── usage/                  what /usage says is using the plan's limits, shown in the empty detail pane
│       └── utils/                  shared hooks & helpers
├── test/                           Vitest suites + fixtures
│   └── scripts/                    repo-only CLIs, never shipped in the npm tarball
│       ├── tokenizer-vocab.mjs     regenerates the tokenizer's vocab.json from ctok's measured vocabulary
│       └── usage.mjs               per-period token usage/cost table (imports src/)
├── electron.vite.config.js         build config: main, preload, renderer
└── eslint.config.js                lint rules
```

## Architecture

Three-process Electron split:

- **`src/main/`** — all disk and network access. Node ESM.
- **`src/preload/`** — renderers↔main API surface (`window.api`); every IPC channel is registered in `src/main/Application.js`. The preload is sandboxed, so it must stay a single self-contained CommonJS file — no cross-file imports.
- **`src/renderer/`** — React 19+. Runs under a strict CSP, so anything that would need a remote fetch or an inline script will break the app.

Four independent data sources feed the UI; the comment atop each class named here explains what its source logs and the quirks of reading it:

1. **Session transcripts** — `<CLAUDE_DIR>/projects/**/*.jsonl`, append-only, written by Claude Code. They also log the loop's own API requests, which `TranscriptInstructions` reads into System rows and `McpTools` into MCP blocks.
2. **Captured API requests** — `~/.claude-discover/requests/<sessionId>.requests.jsonl`, written by `bin/proxy.mjs` only while capture is on and read by `RequestFile`. Feeds the API Requests tab and the Conversation view's Proxy blocks.
3. **Model prices** (`Pricing`) — `src/main/config/prices.seed.json` seed, refreshed daily from LiteLLM into `~/.claude-discover/prices.current.json`.
4. **Debug logs** — `<CLAUDE_DIR>/debug/<sessionId>.txt`, written only by sessions run with `--debug`. `McpDebugLog` only fills in the transcript's MCP blocks, never adds its own.

Everything is date-scoped: the renderer requests one period at a time and the backend returns sessions only for it — neither side handles multi-day ranges. The one exception is a transcript opened from a file (File → Open session file…/Ctrl+O, or dropped on the window): `SessionsService.openFile` reads it whole, from anywhere on disk, and the detail pane shows it on its own, outside the timeline and the list, with no dedup or live updates.

Paths are centralized in `src/main/paths.js` (Claude side) and `bin/proxy.config.js` (proxy side; shared by `bin/` and `src/main/`, deliberately not by the renderer).

### Session scanning pipeline

`SessionsScanner` (walk + watch) → `SessionFile` (stream lines) → `SessionParser` (fold into a meta) → `MetaCache` → `SessionsReader` (dedup, pricing: a period's sessions, a transcript's records) → `SessionsService` (the window's period and opened file, IPC updates).

Token totals must match `ccusage` to the cent, and each stage has rules they depend on (no directory pruned from the walk, resumed and branched ids counted once, a streamed reply counted by its growth, re-logged records, whole-file parsing, period edges). They're commented where they're enforced — read `SessionsScanner`, `SessionParser` and `SessionsReader` before changing what's counted, and run the usage check above after.

### Add-ons

Optional features, secondary to the core timeline. The switchable ones are a class in `src/main/services/switchers/` with `status()/activate()/deactivate()`, toggled from the StatusBar; switches not marked keep-active are undone on quit.

Each is explained atop its own file: the capture proxy (`bin/proxy.mjs`, `ProxySwitch`, `LoginService`), plan limits (`RateLimits`, `UsageInsights`), statusline (`StatuslineSwitch`), MCP tools (`McpSwitch`, `McpEndpoint`), Claude settings (`ClaudeSettingsSwitch`), Claude dir (`ClaudeDirSwitch`), deep links (`DeepLink`), the tray (`AppTray`), shortcuts and auto update (`src/main/updater.js`, the `NpmUpdater` from [`electron-update-from-npm`](https://github.com/dichev/electron-update-from-npm)). Hard rule for the proxy: **capture must never fail, delay, or alter a request**.

### Dev-only bits

`src/main/debug.js` is dynamically imported only under `import.meta.env.DEV`; it opens the CDP port `9333` that `.mcp.json`'s playwright server attaches to, uses a separate `userData` profile so dev and the packaged app don't fight, and installs React DevTools only when `REACT_DEVTOOLS` is set (see UI testing below). `test/prod-build.test.js` asserts it is compiled entirely out of the production bundle.

## Code Conventions

- **Backend (`src/main/`) is OOP** — every service/module is a class
- **Frontend (`src/renderer/`) is functional** — function components, hooks for state, shared logic in custom hooks
- The React Compiler (`react({ compiler: true })`, the plugin's Rust port) memoizes the renderer — don't add `memo`/`useMemo`/`useCallback` by hand, except `memo` on a component rendered in a list's loop (the compiler doesn't cache per item)
- Renderer never imports from `bin/` or `src/main/`; the only channel is `window.api` (`src/shared/` pure helpers excepted)
- Main imports from `src/renderer/` only through `src/main/mcp/sessions/fromRenderer.js`, and only pure modules of how sessions read on screen (eslint enforces the one file)
- Every markdown surface renders through `ui/Markdown.jsx` — never instantiate ReactMarkdown directly
- `MarkdownSession.js` duplicates fields from `ConversationView.jsx`/`SessionSummary.jsx` by hand — changing either means updating it too
- IPC channel names are `namespace:kebab-case-action` (e.g. `sessions:read-requests`)
- Align consecutive `use*` hook declarations so the `=` signs line up in a column
- Comments are clean single lines that explain *why* (races, platform quirks, billing subtleties), not *what*
- A feature's quirks and the reasons behind them go in a comment atop its class, not in this file, which only maps where things are
- Tag OS-specific fixes with a `// @macOS` or `// @linux` comment
- No typecheck configured

## UI testing / debugging

**Ask before running Playwright UI testing** — don't drive the app via Playwright MCP unless the user has confirmed.

React DevTools is off in dev by default (it slows the UI); when you need it, start dev with `REACT_DEVTOOLS=1 npm run dev`.

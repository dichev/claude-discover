# CLAUDE.md

An Electron desktop app that reads **your local Claude Code data** and shows it as a timeline: sessions, conversations, token usage/cost, and (optionally) the raw API traffic captured by a bundled local proxy. Everything is local — no API keys, no telemetry. Published to npm as `claude-discover` (`npx claude-discover`).

Developed on Windows; macOS and Linux are also supported.

## Commands

```bash
npm run dev      # electron-vite dev — hot reload, renderer on :5555, CDP on :9333
npm run build    # electron-vite build → out/{main,preload,renderer}
npm start        # run the built app (electron .)
npm test         # vitest run --reporter=tree
npm run proxy    # run the capture proxy standalone (bin/proxy.mjs --restart)
npm run smoke    # npm pack + install-and-launch the tarball
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
│   │   ├── hooks.mjs               single dispatcher for every Claude Code hook this app installs
│   │   └── statusline.mjs          the installed statusLine command
│   ├── proxy.config.js             proxy config (port, routes, ping body, log paths) — imported by bin/ and src/main/
│   └── proxy.mjs                   API request-capture logging proxy
├── src/
│   ├── main/                       main process (OOP): entry point, app menu, path/config resolution
│   │   ├── config/                 the app's own config: ConfigFile (~/.claude-discover/config.json) + pricing seed
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
│       ├── timeline/               period views (Daily/Weekly/Monthly) + the work-hours band
│       ├── ui/                     generic primitives + the status bar
│       └── utils/                  shared hooks & helpers
├── test/                           Vitest suites + fixtures
│   └── scripts/                    repo-only CLIs, never shipped in the npm tarball
│       ├── package-mac.mjs         @macOS repackages dist/claude-discover.app when stale + registers the scheme
│       └── usage.mjs               per-period token usage/cost table (imports src/)
└── electron.vite.config.js         build config: main, two preloads, two renderer entries
```

## Architecture

Three-process Electron split:

- **`src/main/`** — all disk and network access. Node ESM.
- **`src/preload/`** — renderers↔main API surface (`window.api`); every IPC channel is registered in `src/main/main.js`. Preloads are sandboxed, so each must stay a single self-contained CommonJS file — no cross-file imports (the shared `subscribe` helper is inlined in each by hand).
- **`src/renderer/`** — React 19+. Runs under a strict CSP, so anything that would need a remote fetch or an inline script will break the app.

Three independent data sources feed the UI:

1. **Session transcripts** — `<CLAUDE_DIR>/projects/**/*.jsonl`, append-only, written by Claude Code.
2. **Captured API requests** — `~/.claude-discover/requests/<sessionId>.requests.jsonl`, written by `bin/proxy.mjs` only while capture is on.
3. **Model prices** — `src/main/config/prices.seed.json` seed, refreshed daily from LiteLLM into `~/.claude-discover/prices.current.json`.

Everything is date-scoped: the renderer requests one period at a time and the backend returns sessions only for it — neither side handles multi-day ranges.

Paths are centralized in `src/main/paths.js` (Claude side) and `bin/proxy.config.js` (proxy side; shared by `bin/` and `src/main/`, deliberately not by the renderer).

### Session scanning pipeline

`SessionsScanner` (walk + watch) → `SessionFile` (stream lines) → `SessionParser` (fold into a meta) → `MetaCache` → `SessionsService` (dedup, pricing, IPC updates).

Invariants — token totals break if any of these are bypassed:

- Resume/fork duplicates message ids verbatim; `SessionsService._dedupSessions` excludes the overlap.
- A streamed reply spans several jsonl lines sharing `message.id` with growing `output_tokens`; the parser counts only the growth per line, clamped at 0 (rewinds re-append zeroed usage that was still billed).
- Sessions are always parsed from byte 0, never resumed at an offset.
- The walk can't prune by directory mtime (Windows doesn't bump it on append), and subagent transcripts nest arbitrarily deep.
- `SessionsService.periodBounds` must stay in sync with `src/renderer/utils/period.js` (weeks start Monday).

### Add-ons

Optional features, secondary to the core timeline. The switchable ones are a class in `src/main/services/switchers/` with `status()/activate()/deactivate()`, toggled from the StatusBar; switches not marked keep-active are undone on quit.

- **Capture proxy** (`bin/proxy.mjs`) — a loopback-only tee proxy on `127.0.0.1:41414` that logs raw API traffic; `ProxySwitch` points Claude Code at it via `env.ANTHROPIC_BASE_URL` in `<CLAUDE_DIR>/settings.json` and never overwrites a foreign base URL. Hard rule: **capture must never fail, delay, or alter a request** — errors go to `~/.claude-discover/proxy.error.log`, auth headers are redacted. Logs dedup bulk values as `{ $hash, value }`/`{ $ref }` pairs; subagent requests land in the parent's log file, distinguished by the `x-claude-code-agent-id` header. `ProxySwitch` also installs `bin/claude/hooks.mjs` as a `SessionStart` hook: the base URL outlives a proxy crash or PC restart, so without it every request would hit a dead port.
- **Statusline** — installs `bin/claude/statusline.mjs` as Claude Code's statusLine command.
- **Retention** — raises Claude Code's `cleanupPeriodDays` so transcripts aren't swept before this app can browse them.
- **Claude dir** — switches which Claude data directory the app reads from (relaunches the app on it).
- **Deep links** (not a switcher) — `claude-discover://session?id=<sessionId>&date=<yyyy-MM-dd>` opens a session from another app. `DeepLink` does the routing; only the scheme registration is OS-specific — @windows registers on every launch and the link arrives in a second launch's argv, @macOS declares it in the packaged `.app` plist (`node test/scripts/package-mac.mjs`) and it arrives as an `open-url` event.

### Dev-only bits

`src/main/debug.js` is dynamically imported only under `import.meta.env.DEV`; it opens the CDP port `9333` that `.mcp.json`'s playwright server attaches to, and uses a separate `userData` profile so dev and the packaged app don't fight. `test/prod-build.test.js` asserts it is compiled entirely out of the production bundle.

## Code Conventions

- **Backend (`src/main/`) is OOP** — every service/module is a class
- **Frontend (`src/renderer/`) is functional** — function components, hooks for state, shared logic in custom hooks
- Renderer never imports from `bin/` or `src/main/`; the only channel is `window.api`
- Every markdown surface renders through `ui/Markdown.jsx` — never instantiate ReactMarkdown directly
- `MarkdownSession.js` duplicates fields from `ConversationView.jsx`/`SessionSummary.jsx` by hand — changing either means updating it too
- IPC channel names are `namespace:kebab-case-action` (e.g. `sessions:read-requests`)
- No semicolons; single-argument arrows omit parens (`x => ...`, not `(x) => ...`)
- Align consecutive `use*` hook declarations so the `=` signs line up in a column
- Comments are clean single lines that explain *why* (races, platform quirks, billing subtleties), not *what*
- Tag OS-specific fixes with a `// @macOS` or `// @linux` comment
- No lint or typecheck configured

## UI testing / debugging

**Ask before running Playwright UI testing** — don't drive the app via Playwright MCP unless the user has confirmed.

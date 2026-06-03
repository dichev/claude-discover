// Generates the committed dummy transcripts under test/fixtures/claude/projects/.
// Hand-authored to exercise accounting corner cases — NOT harvested live data, which
// wouldn't reliably cover them. Content is stripped (placeholder text only); every
// field that token/cost accounting reads (usage, model, ids, timestamps, version,
// isSidechain) is real-shaped. Timestamps are pinned to a long-past, always-completed
// week (Mon 2025-03-10 .. Sun 2025-03-16, month 2025-03) so the period selection is
// stable forever. Re-run with: node test/fixtures/build-fixtures.mjs
//
// Corner cases covered: multiple models; 5m+1h cache-write split; a cache-creation total
// with no split object; fast mode; a streamed reply (multi-line msgId growth); a
// multi-day session (per-line, not per-file, day attribution); a UTC-midnight boundary
// pair; a sidechain replay of a parent turn AND a non-sidechain resume replay across
// files (both deduped); a synthetic no-usage notice (skipped); deep subagents/workflows/
// nesting; and two separate projects.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude', 'projects')

let uuidN = 0
const usage = ({ input = 0, output = 0, cacheRead = 0, cc5m = 0, cc1h = 0, fast = false, noSplit = false }) => {
  const u = {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cc5m + cc1h,
    service_tier: 'standard',
    speed: fast ? 'fast' : 'standard',
  }
  // Older transcripts report a cache-creation total with no 5m/1h breakdown object.
  if (!noSplit) u.cache_creation = { ephemeral_5m_input_tokens: cc5m, ephemeral_1h_input_tokens: cc1h }
  return u
}
const asst = ({ ts, model, rid, mid, sessionId, sidechain = false, u = null, text = '(redacted)' }) => {
  const message = { id: mid, role: 'assistant', type: 'message', model, content: [{ type: 'text', text }] }
  if (u) message.usage = u // real <synthetic> notices carry no usage — omit it so both tools skip the line
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    requestId: rid,
    sessionId,
    version: '2.0.21',
    isSidechain: sidechain,
    uuid: `u${++uuidN}`,
    parentUuid: null,
    cwd: '/work/demo',
    gitBranch: 'main',
    message,
  })
}

function writeFile(rel, lines) {
  const full = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, lines.join('\n') + '\n')
  return rel
}

fs.rmSync(ROOT, { recursive: true, force: true })

// proj-alpha/main-session.jsonl — primary session. NOTE it is intentionally a single
// session file whose lines fall on 03-11, 03-12 AND 03-13: day attribution must be
// per-line, not per-file, so each daily bucket below must hold only that day's lines.
writeFile('proj-alpha/main-session.jsonl', [
  // e1: opus standard, 5m cache write
  asst({ ts: '2025-03-11T10:00:00Z', model: 'claude-opus-4-7', rid: 'rA', mid: 'M1', sessionId: 'S1', u: usage({ input: 100, output: 200, cacheRead: 1000, cc5m: 300 }) }),
  // e2: second model (haiku) — per-model pricing
  asst({ ts: '2025-03-11T10:05:00Z', model: 'claude-haiku-4-5', rid: 'rB', mid: 'M2', sessionId: 'S1', u: usage({ input: 50, output: 80, cacheRead: 200 }) }),
  // e3: streamed reply — two lines share msgId+requestId, output grows; both tools must land on the final (150), not 40+150
  asst({ ts: '2025-03-12T09:00:00Z', model: 'claude-opus-4-7', rid: 'rC', mid: 'M3', sessionId: 'S1', u: usage({ input: 60, output: 40, cacheRead: 500, cc5m: 100 }) }),
  asst({ ts: '2025-03-12T09:00:01Z', model: 'claude-opus-4-7', rid: 'rC', mid: 'M3', sessionId: 'S1', u: usage({ input: 60, output: 150, cacheRead: 500, cc5m: 100 }) }),
  // e4: 1h ephemeral cache split alongside 5m
  asst({ ts: '2025-03-12T09:10:00Z', model: 'claude-opus-4-7', rid: 'rD', mid: 'M4', sessionId: 'S1', u: usage({ input: 30, output: 90, cacheRead: 800, cc5m: 200, cc1h: 300 }) }),
  // e5: fast mode — same tokens, different (multiplied) cost
  asst({ ts: '2025-03-13T14:00:00Z', model: 'claude-opus-4-7', rid: 'rE', mid: 'M5', sessionId: 'S1', u: usage({ input: 20, output: 70, cacheRead: 400, fast: true }) }),
  // e6: synthetic notice (e.g. "limit reached") — no usage block, like the real ones; both tools skip it
  asst({ ts: '2025-03-13T14:01:00Z', model: '<synthetic>', rid: 'rF', mid: 'M6', sessionId: 'S1', text: 'Prompt is too long' }),
  // e10: cache-creation total with no 5m/1h split object (older transcript format)
  asst({ ts: '2025-03-13T14:02:00Z', model: 'claude-opus-4-7', rid: 'rK', mid: 'M9', sessionId: 'S1', u: usage({ input: 10, output: 20, cacheRead: 100, cc5m: 400, noSplit: true }) }),
  // e11/e12: a pair straddling UTC midnight — must land in 03-12 and 03-13 respectively
  asst({ ts: '2025-03-12T23:59:30Z', model: 'claude-opus-4-7', rid: 'rL', mid: 'M10', sessionId: 'S1', u: usage({ input: 5, output: 15, cacheRead: 50 }) }),
  asst({ ts: '2025-03-13T00:00:30Z', model: 'claude-opus-4-7', rid: 'rM', mid: 'M11', sessionId: 'S1', u: usage({ input: 5, output: 15, cacheRead: 50 }) }),
])

// proj-alpha/resumed.jsonl — a resumed session (separate file) that replays an earlier
// turn verbatim (same msgId+requestId, NOT a sidechain) plus one new turn. The replay
// must be deduped to a single count; the new turn must be added.
writeFile('proj-alpha/resumed.jsonl', [
  // replay of e2 (M2) verbatim — deduped across files
  asst({ ts: '2025-03-11T10:05:00Z', model: 'claude-haiku-4-5', rid: 'rB', mid: 'M2', sessionId: 'S1b', u: usage({ input: 50, output: 80, cacheRead: 200 }) }),
  // a genuinely new turn in the resumed session
  asst({ ts: '2025-03-13T15:00:00Z', model: 'claude-opus-4-7', rid: 'rJ', mid: 'M12', sessionId: 'S1b', u: usage({ input: 15, output: 45, cacheRead: 250, cc5m: 50 }) }),
])

// Deeply-nested subagent transcript — exercises full recursion + sidechain handling
writeFile('proj-alpha/main-session/subagents/workflows/wf_demo/agent-1.jsonl', [
  // e7: genuine sidechain turn (unique msgId) — counted by both
  asst({ ts: '2025-03-12T11:00:00Z', model: 'claude-opus-4-7', rid: 'rG', mid: 'M7', sessionId: 'S1sub', sidechain: true, u: usage({ input: 25, output: 65, cacheRead: 700 }) }),
  // e8: sidechain REPLAY of parent M1 with a new requestId — must be deduped to M1's single count
  asst({ ts: '2025-03-11T10:00:00Z', model: 'claude-opus-4-7', rid: 'rH', mid: 'M1', sessionId: 'S1sub', sidechain: true, u: usage({ input: 100, output: 200, cacheRead: 1000, cc5m: 300 }) }),
])

// Second project — separate top-level dir
writeFile('proj-beta/another.jsonl', [
  // e9: haiku in another project on the latest day
  asst({ ts: '2025-03-13T16:00:00Z', model: 'claude-haiku-4-5', rid: 'rI', mid: 'M8', sessionId: 'S2', u: usage({ input: 70, output: 110, cacheRead: 300, cc5m: 50 }) }),
])

// Sidecar that must be ignored by the scanner (.ndjson, not .jsonl)
fs.writeFileSync(path.join(ROOT, 'proj-alpha', 'main-session.context.ndjson'), '{"junk":true}\n')

console.log('fixtures written under', ROOT)

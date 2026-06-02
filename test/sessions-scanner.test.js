// Regression coverage for SessionsScanner.scan() — the two ways it used to drop
// real transcripts from a period:
//   1. an active long-running session whose project dir mtime predates the period
//      (Windows: appending a file does not bump its parent dir mtime)
//   2. a subagent transcript nested deeper than <session>/subagents/
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionsScanner } from '../src/main/sessions/SessionsScanner.js'

const DAY_MS = 24 * 3600 * 1000
const now = Date.now()
const day = { start: now - DAY_MS, end: now + DAY_MS }
const inWindow = new Date(now)               // mtime >= day.start
const stale = new Date(now - 10 * DAY_MS)    // mtime <  day.start

let root
const rel = {
  active: 'projA/active-session.jsonl',                              // dir is stale, file is fresh
  nested: 'projA/sess1/subagents/workflows/wf_x/agent-1.jsonl',      // deeply nested subagent
  stale:  'projB/old-session.jsonl',                                 // genuinely out of period
}

function write(relPath, mtime) {
  const full = path.join(root, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, '{"type":"summary"}\n')
  fs.utimesSync(full, mtime, mtime)
  return full
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'))
  write(rel.active, inWindow)
  write(rel.nested, inWindow)
  write(rel.stale, stale)
  // Backdate projA's own mtime AFTER its files exist — the old dir-mtime prune would
  // then skip the whole subtree even though active-session.jsonl is in the period.
  fs.utimesSync(path.join(root, 'projA'), stale, stale)
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('SessionsScanner.scan', () => {
  async function scannedPaths() {
    const seen = []
    let batches = 0
    await new SessionsScanner({ root }).scan(day, {
      onFile: (fp, stat) => { seen.push({ rel: path.relative(root, fp).replace(/\\/g, '/'), stat }); return true },
      onBatchDone: () => { batches++ },
    })
    return { seen, batches }
  }

  it('finds an active session even when its project dir mtime predates the period', async () => {
    const { seen } = await scannedPaths()
    expect(seen.map(s => s.rel)).toContain(rel.active)
  })

  it('recurses into deeply-nested subagent/workflow transcripts', async () => {
    const { seen } = await scannedPaths()
    expect(seen.map(s => s.rel)).toContain(rel.nested)
  })

  it('still prunes files whose own mtime is before the period', async () => {
    const { seen } = await scannedPaths()
    expect(seen.map(s => s.rel)).not.toContain(rel.stale)
  })

  it('passes a stat with each file and flushes a batch when files are found', async () => {
    const { seen, batches } = await scannedPaths()
    expect(seen.every(s => s.stat && s.stat.mtimeMs >= day.start)).toBe(true)
    expect(batches).toBeGreaterThan(0)
  })
})

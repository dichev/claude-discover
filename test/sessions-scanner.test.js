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

// Period entirely in the past — files created NOW carry a real (unfakeable) birthtime
// after its end, exercising the created-after-period prune.
const pastDay = { start: now - 10 * DAY_MS, end: now - 8 * DAY_MS }
const inPastDay = new Date(now - 9 * DAY_MS)
const future = new Date(now + 3600_000)

let root
const rel = {
  active: 'projA/active-session.jsonl',                              // dir is stale, file is fresh
  nested: 'projA/sess1/subagents/workflows/wf_x/agent-1.jsonl',      // deeply nested subagent
  stale:  'projB/old-session.jsonl',                                 // genuinely out of period
  copied: 'projB/copied-session.jsonl',                              // mtime in pastDay, birthtime now (mtime-preserving copy)
  future: 'projB/future-session.jsonl',                              // birthtime now, mtime an hour later (a long session created after pastDay)
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
  write(rel.copied, inPastDay)
  write(rel.future, future)
  // Backdate projA's own mtime AFTER its files exist — the old dir-mtime prune would
  // then skip the whole subtree even though active-session.jsonl is in the period.
  fs.utimesSync(path.join(root, 'projA'), stale, stale)
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('SessionsScanner.scan', () => {
  async function scannedPaths(period = day) {
    const seen = []
    let batches = 0
    await new SessionsScanner({ root }).scan(period, {
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

  it('prunes files created after the period ends', async () => {
    if (fs.statSync(path.join(root, rel.future)).birthtimeMs === 0) return // fs without creation time — prune is disabled there
    const { seen } = await scannedPaths(pastDay)
    expect(seen.map(s => s.rel)).not.toContain(rel.future)
  })

  it('keeps files whose birthtime is not meaningfully older than mtime (copies and restores)', async () => {
    const { seen } = await scannedPaths(pastDay)
    expect(seen.map(s => s.rel)).toContain(rel.copied) // mtime-preserving copy: birthtime > mtime
    expect(seen.map(s => s.rel)).toContain(rel.active) // instant-written file: birthtime ≈ mtime, stat says nothing about content age
  })

  it('passes a stat with each file and flushes a batch when files are found', async () => {
    const { seen, batches } = await scannedPaths()
    expect(seen.every(s => s.stat && s.stat.mtimeMs >= day.start)).toBe(true)
    expect(batches).toBeGreaterThan(0)
  })
})

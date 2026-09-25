// Both watchers must report a new transcript, an append and a deletion — including in
// subdirectories created after the watch started (subagent transcripts land there).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileWatcher, EventFileWatcher, IntervalFileWatcher } from '../src/main/sessions/utils/FileWatcher.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

describe.each([['EventFileWatcher', EventFileWatcher], ['IntervalFileWatcher', IntervalFileWatcher]])('%s', (_name, Watcher) => {
  let root, watcher, events, known

  // Events arrive asynchronously, so wait for the expected one instead of sleeping a fixed time
  const waitFor = (kind, rel) => vi.waitFor(() => {
    const hit = events.find(e => e.kind === kind && e.path === path.join(root, rel))
    if (!hit) throw new Error(`no ${kind} for ${rel}; saw ${JSON.stringify(events)}`)
    return hit
  }, { timeout: 4000, interval: 20 })

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watch-'))
    events = []
    known = new Map() // the caller's stats, kept current through the events — what StatCache does in the app
    watcher = new Watcher(root, {
      filter: p => p.endsWith('.jsonl'),
      onChange: (p, stat) => { known.set(p, stat); events.push({ kind: 'change', path: p, size: stat.size }) },
      onUnlink: p => { known.delete(p); events.push({ kind: 'unlink', path: p }) },
      onDrop: () => events.push({ kind: 'drop' }),
      baseline: () => known,
      settleMs: 20,
      intervalMs: 30,
    })
  })

  afterEach(() => {
    watcher.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reports a new transcript', async () => {
    fs.writeFileSync(path.join(root, 'a.jsonl'), '{}\n')
    await waitFor('change', 'a.jsonl')
  })

  it('reports an append with a fresh stat', async () => {
    const fp = path.join(root, 'b.jsonl')
    fs.writeFileSync(fp, '{}\n')
    await waitFor('change', 'b.jsonl')
    events.length = 0
    fs.appendFileSync(fp, '{"more":1}\n')
    const { size } = await waitFor('change', 'b.jsonl')
    expect(size).toBe(fs.statSync(fp).size)
  })

  it('reports a deletion', async () => {
    const fp = path.join(root, 'c.jsonl')
    fs.writeFileSync(fp, '{}\n')
    await waitFor('change', 'c.jsonl')
    fs.rmSync(fp)
    await waitFor('unlink', 'c.jsonl')
  })

  it('recurses into subdirectories created after the watch started', async () => {
    const rel = path.join('sess1', 'subagents', 'workflows', 'wf_x', 'agent-1.jsonl')
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), '{}\n')
    await waitFor('change', rel)
  })

  it('ignores paths the filter rejects', async () => {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'x')
    fs.writeFileSync(path.join(root, 'd.jsonl'), '{}\n')
    await waitFor('change', 'd.jsonl') // the .jsonl arriving proves the .txt had its chance
    expect(events.some(e => e.path?.endsWith('.txt'))).toBe(false)
  })

  it('coalesces a burst of appends into one event', async () => {
    const fp = path.join(root, 'e.jsonl')
    fs.writeFileSync(fp, '{}\n')
    await waitFor('change', 'e.jsonl')
    events.length = 0
    for (let i = 0; i < 20; i++) {
      fs.appendFileSync(fp, `{"n":${i}}\n`)
    }
    await waitFor('change', 'e.jsonl')
    await sleep(100)
    expect(events.length).toBe(1)
  })

  it('reports nothing after close()', async () => {
    const fp = path.join(root, 'f.jsonl')
    fs.writeFileSync(fp, '{}\n')
    watcher.close() // before its settle timer fires
    await sleep(100)
    expect(events).toEqual([])
  })
})

// The interval watcher diffs each re-listing against the caller's baseline, so it reports only what changed since then
describe('IntervalFileWatcher baseline', () => {
  let root, watcher, events

  const start = (baseline, dir = root, opts = {}) => {
    watcher = new IntervalFileWatcher(dir, {
      filter: p => p.endsWith('.jsonl'),
      onChange: p => events.push({ kind: 'change', path: p }),
      onUnlink: p => events.push({ kind: 'unlink', path: p }),
      baseline,
      intervalMs: 30,
      ...opts,
    })
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'interval-watch-'))
    events = []
    fs.writeFileSync(path.join(root, 'old.jsonl'), '{}\n')
  })

  afterEach(() => {
    watcher.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('stays silent about files already in the baseline', async () => {
    const fp = path.join(root, 'old.jsonl')
    start(() => new Map([[fp, fs.statSync(fp)]]))
    await sleep(150)
    expect(events).toEqual([])
  })

  it('skips passes until there is a baseline', async () => {
    start(() => null)
    await sleep(150)
    expect(events).toEqual([])
  })

  it('an unreachable root reports no deletions', async () => {
    const gone = path.join(root, 'offline')
    start(() => new Map([[path.join(gone, 'a.jsonl'), {}]]), gone)
    await sleep(150)
    expect(events).toEqual([])
  })

  it('leaves files idle past hotMs to the periodic sweep', async () => {
    const fp = path.join(root, 'old.jsonl')
    const cold = { size: 0, mtimeMs: Date.now() - 3_600_000 } // stale on purpose: any stat would report a change
    start(() => new Map([[fp, cold]]), root, { sweepEvery: 5 })
    await sleep(80) // 2 checks, no sweep yet
    expect(events).toEqual([])
    await vi.waitFor(() => expect(events).toEqual([{ kind: 'change', path: fp }]), { timeout: 2000 })
  })
})

// FileWatcher prefers OS events and switches to interval checks when fs.watch refuses the root or fails later
describe('FileWatcher', () => {
  let root, watcher
  const opts = { filter: () => true, onChange() {}, onUnlink() {}, onDrop() {}, baseline: () => null }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    watcher.close()
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('uses OS events where it can', () => {
    watcher = new FileWatcher(root, opts)
    expect(watcher.mode).toBe('event')
  })

  it('checks on an interval where fs.watch refuses the root', () => {
    watcher = new FileWatcher(path.join(root, 'missing'), opts)
    expect(watcher.mode).toBe('interval')
  })

  it('switches to interval checks when the watch fails later', () => {
    const handle = Object.assign(new EventEmitter(), { close() {} })
    vi.spyOn(fs, 'watch').mockReturnValue(handle)
    watcher = new FileWatcher(root, opts)
    expect(watcher.mode).toBe('event')
    handle.emit('error', new Error('boom'))
    expect(watcher.mode).toBe('interval')
  })
})

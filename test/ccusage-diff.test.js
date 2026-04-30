// Cross-check our token + cost aggregation against `ccusage daily`.
// Runs SessionReader over every .jsonl in ~/.claude/projects, sums token
// totals + cost, and compares to ccusage's summed daily output.
// Skipped when no local transcripts exist.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { SessionReader } from '../electron/services/SessionReader.js'
import { scanSession } from '../electron/services/SessionParser.js'
import { dedupSessions } from '../electron/services/SessionsService.js'

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects')
const COST_TOL_ABS = 0.01
const COST_TOL_REL = 0.005

// Mirrors what the running app does to populate DailySummary:
//   - scanSession for each .jsonl   (parses + per-file dedup + per-session cost)
//   - dedupSessions across all metas (cross-session dedup of resumed/forked sessions)
//   - sum per-session tokens + per-session cost   (DailySummary.jsx:8-20)
async function ourTotals() {
  const entries = await fsp.readdir(PROJECTS_ROOT, { recursive: true, withFileTypes: true })
  const metas = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
    const m = await scanSession(new SessionReader(path.join(e.parentPath, e.name)))
    if (m) metas.push(m)
  }
  const deduped = await dedupSessions(metas, null)
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let cost = 0
  for (const m of deduped) {
    totals.input += m.tokens.input
    totals.output += m.tokens.output
    totals.cacheRead += m.tokens.cacheRead
    totals.cacheCreation += m.tokens.cacheCreation
    cost += m.cost || 0
  }
  return { totals, cost }
}

function ccusageTotals() {
  const res = spawnSync('npx --prefer-offline ccusage daily --json -m calculate', {
    encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  })
  if (res.status !== 0 || !res.stdout) throw new Error(`ccusage failed: ${res.stderr || '(no output)'}`)
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let cost = 0
  for (const d of JSON.parse(res.stdout).daily) {
    totals.input += d.inputTokens
    totals.output += d.outputTokens
    totals.cacheRead += d.cacheReadTokens
    totals.cacheCreation += d.cacheCreationTokens
    cost += d.totalCost
  }
  return { totals, cost }
}

describe.skipIf(!fs.existsSync(PROJECTS_ROOT))('ccusage diff', () => {
  // ccusage runs first (fast), then our scan — so our scan can only have seen
  // strictly more data, and any live writes during the ~15s gap show up as
  // ours > theirs (not the other way around).
  let theirs
  let ours

  it('reads ccusage totals', () => {
    theirs = ccusageTotals()
  }, 120_000)

  it('reads our totals', async () => {
    ours = await ourTotals()
  }, 120_000)

  it('matches on tokens and cost', () => {
    for (const k of Object.keys(theirs.totals)) {
      const delta = ours.totals[k] - theirs.totals[k]
      const rel = theirs.totals[k] > 0 ? delta / theirs.totals[k] : 0
      expect(delta, `${k}: ours=${ours.totals[k]} ccusage=${theirs.totals[k]} delta=${delta}`).toBeGreaterThanOrEqual(0)
      expect(rel, `${k} relative drift too large`).toBeLessThan(0.001)
    }
    const costDelta = Math.abs(ours.cost - theirs.cost)
    expect(costDelta <= COST_TOL_ABS || costDelta / theirs.cost <= COST_TOL_REL).toBe(true)
  })
})

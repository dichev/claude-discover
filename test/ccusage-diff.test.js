// Cross-check our token + cost accounting against ccusage, per period, for each
// granularity (daily / weekly / monthly).
//
// ccusage buckets every usage entry by its UTC calendar date (the --timezone flag
// doesn't move these numbers) and starts weeks on Monday — so this test builds
// *UTC* period ranges to match ccusage's conventions. The app's own views bucket
// by local time (a UX choice, a different layer); here we only verify that the
// underlying accounting matches ccusage entry-for-entry.
//
// ccusage runs before our scan, so for any *completed* period our scan saw exactly
// the same entries → token totals match exactly and cost matches within rounding.
// The single *in-progress* period (the one containing "now") can change between the
// two reads, so we skip it.
// Skipped when no local transcripts exist.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { SessionFile } from '../src/main/sessions/SessionFile.js'
import { scanSession, dedupSessions } from '../src/main/services/SessionsService.js'
import { Pricing } from '../src/main/services/Pricing.js'

const pricing = new Pricing()

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects')
const COST_TOL_ABS = 0.01
const COST_TOL_REL = 0.005
const DAY_MS = 24 * 3600 * 1000

// Listed once and reused across every bucket/granularity.
let FILES = null
async function jsonlFiles() {
  if (!FILES) {
    const entries = await fsp.readdir(PROJECTS_ROOT, { recursive: true, withFileTypes: true })
    FILES = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => path.join(e.parentPath, e.name))
  }
  return FILES
}

// Mirrors the app's PeriodSummary pipeline, scoped to a UTC range:
//   scanSession(range) per file → dedupSessions(range) → sum tokens + cost.
async function ourTotalsForRange(range) {
  const metas = []
  for (const fp of await jsonlFiles()) {
    const m = await scanSession(new SessionFile(fp), { pricing, range })
    if (m) metas.push(m)
  }
  const deduped = await dedupSessions(metas, pricing, range)
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let cost = 0
  for (const m of deduped) {
    totals.input += m.tokens.input
    totals.output += m.tokens.output
    totals.cacheRead += m.tokens.cacheRead
    totals.cacheCreation += m.tokens.cacheCreation
    // ccusage prices all cache writes at the 5-min rate and applies the per-model
    // fast multiplier — so price standard and fast buckets separately, as the app does.
    cost += (pricing.costUSD(m.tokensByModel, { ignoreCache1hPremium: true }) || 0)
          + (pricing.costUSD(m.tokensByModelFast, { ignoreCache1hPremium: true, fast: true }) || 0)
  }
  return { totals, cost }
}

// ccusage buckets for a subcommand → [{ period, totals, cost }].
function ccusageBuckets(subcommand) {
  const res = spawnSync(`npx --prefer-offline ccusage ${subcommand} --json -m calculate`, {
    encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  })
  if (res.status !== 0 || !res.stdout) throw new Error(`ccusage ${subcommand} failed: ${res.stderr || '(no output)'}`)
  return JSON.parse(res.stdout)[subcommand].map(d => ({
    period: d.period,
    totals: { input: d.inputTokens, output: d.outputTokens, cacheRead: d.cacheReadTokens, cacheCreation: d.cacheCreationTokens },
    cost: d.totalCost,
  }))
}

// The UTC range a ccusage `period` label denotes, per granularity.
function rangeFor(granularity, period) {
  if (granularity === 'monthly') {
    const [y, m] = period.split('-').map(Number)
    return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) - 1 }
  }
  const start = Date.parse(period + 'T00:00:00.000Z') // daily by date, weekly by its Monday
  const days = granularity === 'weekly' ? 7 : 1
  return { start, end: start + days * DAY_MS - 1 }
}

describe.skipIf(!fs.existsSync(PROJECTS_ROOT))('ccusage diff', () => {
  const now = Date.now()

  for (const granularity of ['daily', 'weekly', 'monthly']) {
    describe(granularity, () => {
      const compared = [] // completed periods only: { period, totals, cost, ours }

      // ccusage first (fast), then our scans — so our scan saw the same data. We
      // skip the in-progress period (it can change between the two reads); every
      // completed period is immutable, so it must match exactly.
      beforeAll(async () => {
        for (const b of ccusageBuckets(granularity)) {
          const range = rangeFor(granularity, b.period)
          if (range.end < now) compared.push({ ...b, ours: await ourTotalsForRange(range) })
        }
      }, 180_000)

      it('matches every completed period (exact tokens, cost within rounding)', () => {
        expect(compared.length, 'no completed periods to compare').toBeGreaterThan(0)
        for (const { period, totals, cost, ours } of compared) {
          for (const k of Object.keys(totals)) {
            expect(ours.totals[k], `${granularity} ${period} ${k}`).toBe(totals[k])
          }
          const drift = Math.abs(ours.cost - cost)
          expect(drift <= COST_TOL_ABS || drift / cost <= COST_TOL_REL, `${granularity} ${period} cost: ours=${ours.cost} ccusage=${cost}`).toBe(true)
        }
      })
    })
  }
})

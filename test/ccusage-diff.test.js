// Cross-check our token/cost accounting against the ccusage CLI, per granularity.
// Both sides are pinned to UTC (ccusage via -z UTC, us via periodBounds' tz context)
// so bucketing matches across machines — ccusage otherwise groups by the local zone.
// We compare the most recent period but skip today's (this week's / this month's): the
// in-progress bucket can shift between the two reads, while a completed one cannot.
// Skipped when no transcripts exist.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { tz } from '@date-fns/tz'
import { SessionsService, periodBounds } from '../src/main/services/SessionsService.js'
import { Pricing } from '../src/main/services/Pricing.js'

const pricing = new Pricing()
const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects')
const COST_TOL_ABS = 0.01
const COST_TOL_REL = 0.005
const GRANULARITY = { daily: 'day', weekly: 'week', monthly: 'month' } // ccusage subcommand → periodBounds

const day = ms => new Date(ms).toISOString().slice(0, 10)


async function ourTotals(period, range) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let cost = 0
  const service = new SessionsService({ root: PROJECTS_ROOT })
  for (const m of await service.scan(range)) {
    totals.input += m.tokens.input
    totals.output += m.tokens.output
    totals.cacheRead += m.tokens.cacheRead
    totals.cacheCreation += m.tokens.cacheCreation
    // ccusage prices every cache write at the 5-min rate with the per-model fast
    // multiplier, so bill standard and fast buckets separately, as the app does.
    cost += (pricing.costUSD(m.tokensByModel, { ignoreCache1hPremium: true }) || 0)
          + (pricing.costUSD(m.tokensByModelFast, { ignoreCache1hPremium: true, fast: true }) || 0)
  }
  return { period, totals, cost }
}

function ccusageTotals(subcommand) {
  const res = spawnSync(`npx ccusage ${subcommand} --json -m calculate -z UTC`, {
    encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  })
  if (res.status !== 0 || !res.stdout) throw new Error(`ccusage ${subcommand} failed: ${res.stderr || '(no output)'}`)
  return JSON.parse(res.stdout)[subcommand].map(d => ({
    period: d.period,
    totals: {
      input: d.inputTokens,
      output: d.outputTokens,
      cacheRead: d.cacheReadTokens,
      cacheCreation: d.cacheCreationTokens
    },
    cost: d.totalCost,
  }))
}

describe.skipIf(!fs.existsSync(PROJECTS_ROOT))('ccusage diff', () => {
  const now = Date.now()

  for (const [subcommand, gran] of Object.entries(GRANULARITY)) {
    const rangeOf = b => periodBounds(b.period, gran, tz('UTC'))
    const ccusage = ccusageTotals(subcommand).filter(b => rangeOf(b).end < now).at(-1) // latest completed, skip today
    const label = !ccusage ? '(none)' : gran === 'week' ? `${day(rangeOf(ccusage).start)} - ${day(rangeOf(ccusage).end)}` : ccusage.period

    it.concurrent(`${subcommand} ${label} matches (exact tokens, cost within rounding)`, async () => {
      expect(ccusage, 'no completed period to compare').toBeTruthy()
      const ours = await ourTotals(ccusage.period, rangeOf(ccusage))
      for (const k of Object.keys(ccusage.totals)) {
        expect(ours.totals[k], k).toBe(ccusage.totals[k])
      }
      const drift = Math.abs(ours.cost - ccusage.cost)
      expect(drift <= COST_TOL_ABS || drift / ccusage.cost <= COST_TOL_REL, `cost: ours=${ours.cost} ccusage=${ccusage.cost}`).toBe(true)
    }, 180_000)
  }
})

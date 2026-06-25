// Cross-checks our token/cost accounting against the ccusage CLI, per granularity, in two
// passes: against the live ~/.claude, and against a committed fixture of hand-authored dummy
// transcripts that deliberately exercise the accounting corner cases (see build-fixtures.mjs).
// The live pass is best-effort — it compares only the latest completed period, since the
// in-progress one can shift between the two reads — while the frozen fixture compares every
// bucket. Both pin UTC so day/week/month bucketing matches across machines.
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tz } from '@date-fns/tz'
import { SessionsService, periodBounds } from '../src/main/services/SessionsService.js'
import { Pricing } from '../src/main/services/Pricing.js'

const COST_TOL_ABS = 0.01
const COST_TOL_REL = 0.005


const pricing = new Pricing()

async function ourTotals(claudeDir, range) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let cost = 0
  const service = new SessionsService({ root: path.join(claudeDir, 'projects') })
  for (const m of await service.scan(range)) {
    totals.input += m.tokens.input
    totals.output += m.tokens.output
    totals.cacheRead += m.tokens.cacheRead
    totals.cacheCreation += m.tokens.cacheCreation
    cost += (pricing.costUSD(m.tokensByModel) || 0)
          + (pricing.costUSD(m.tokensByModelFast, { fast: true }) || 0)
  }
  return { totals, cost }
}

function ccusageTotals(subcommand, claudeDir) {
  const res = spawnSync(`npx ccusage@latest ${subcommand} --json -m calculate -z UTC`, {
    encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
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


const CASES = [
  { // live: best-effort against the real tree
    name: 'live',
    claudeDir: path.join(os.homedir(), '.claude'),
    select: (buckets, rangeOf) => buckets.filter(b => rangeOf(b).end < Date.now()).slice(-1), // only the latest completed bucket is stable, so skip the today's in-progress one
  },
  { // fixture: frozen in a past, always-completed week
    name: 'fixture',
    claudeDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude'),
    select: buckets => buckets,
  },
]


for (const { name, claudeDir, select } of CASES) {
  describe(`ccusage diff (${name})`, () => {
    for (const [subcommand, gran] of Object.entries({ daily: 'day', weekly: 'week', monthly: 'month' })) {
      it(`${subcommand} matches (exact tokens, cost within rounding)`, async () => {
        const rangeOf = b => periodBounds(b.period, gran, tz('UTC'))
        const ccusage = select(ccusageTotals(subcommand, claudeDir), rangeOf)
        expect(ccusage.length, 'no buckets to compare').toBeGreaterThan(0)
        for (const b of ccusage) {
          const ours = await ourTotals(claudeDir, rangeOf(b))
          for (const k of Object.keys(b.totals)) {
            expect(ours.totals[k], `${subcommand} ${b.period} ${k}`).toBe(b.totals[k])
          }
          const drift = Math.abs(ours.cost - b.cost)
          expect(drift <= COST_TOL_ABS || drift / b.cost <= COST_TOL_REL, `${subcommand} ${b.period} cost: ours=${ours.cost} ccusage=${b.cost}`).toBe(true)
        }
      }, 30_000)
    }
  })
}

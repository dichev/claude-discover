// Cross-checks our token/cost accounting against the ccusage CLI, on a committed
// fixture (test/fixtures/claude/projects/) rather than the live ~/.claude — so the
// comparison is deterministic and isn't perturbed by transcripts being written while
// the test runs. The fixture is hand-authored dummy data (see build-fixtures.mjs):
// content is stripped, but every field accounting reads (usage, model, ids, version,
// isSidechain, timestamp) is real-shaped, and it deliberately covers the corner cases —
// multiple models, 5m+1h cache splits (and a no-split total), fast mode, a streamed
// reply, a multi-day session (per-line day attribution), a UTC-midnight boundary, a
// sidechain replay and a non-sidechain resume replay (both deduped), a synthetic no-usage
// notice, deep subagents/ nesting, and two projects. We compare every bucket ccusage
// reports. Both sides are pinned to UTC so bucketing matches across machines.
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tz } from '@date-fns/tz'
import { SessionsService, periodBounds } from '../src/main/services/SessionsService.js'
import { Pricing } from '../src/main/services/Pricing.js'

const pricing = new Pricing()
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude')
const PROJECTS_ROOT = path.join(FIXTURE_DIR, 'projects')
const COST_TOL_ABS = 0.01
const COST_TOL_REL = 0.005
const GRANULARITY = { daily: 'day', weekly: 'week', monthly: 'month' } // ccusage subcommand → periodBounds

async function ourTotals(range) {
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
  return { totals, cost }
}

function ccusageTotals(subcommand) {
  const res = spawnSync(`npx ccusage ${subcommand} --json -m calculate -z UTC`, {
    encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDE_CONFIG_DIR: FIXTURE_DIR }, // pin ccusage to the fixture, not ~/.claude
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

describe('ccusage diff', () => {
  for (const [subcommand, gran] of Object.entries(GRANULARITY)) {
    it(`${subcommand} matches ccusage on the fixture (exact tokens, cost within rounding)`, async () => {
      const buckets = ccusageTotals(subcommand)
      expect(buckets.length, 'no buckets from ccusage').toBeGreaterThan(0)
      for (const b of buckets) {
        const ours = await ourTotals(periodBounds(b.period, gran, tz('UTC')))
        for (const k of Object.keys(b.totals)) {
          expect(ours.totals[k], `${subcommand} ${b.period} ${k}`).toBe(b.totals[k])
        }
        const drift = Math.abs(ours.cost - b.cost)
        expect(drift <= COST_TOL_ABS || drift / b.cost <= COST_TOL_REL, `${subcommand} ${b.period} cost: ours=${ours.cost} ccusage=${b.cost}`).toBe(true)
      }
    }, 180_000)
  }
})

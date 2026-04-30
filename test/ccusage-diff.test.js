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
import { costUSD } from '../electron/services/Pricing.js'

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects')
const COST_TOL_ABS = 0.01
const COST_TOL_REL = 0.005

async function ourTotals() {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  const byModel = {}
  const entries = await fsp.readdir(PROJECTS_ROOT, { recursive: true, withFileTypes: true })
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
    const meta = await new SessionReader(path.join(e.parentPath, e.name)).scanMetadata(null, null)
    if (!meta) continue
    totals.input += meta.tokens.input
    totals.output += meta.tokens.output
    totals.cacheRead += meta.tokens.cacheRead
    totals.cacheCreation += meta.tokens.cacheCreation
    for (const [m, t] of Object.entries(meta.tokensByModel)) {
      const b = byModel[m] || (byModel[m] = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation5m: 0, cacheCreation1h: 0 })
      for (const k of Object.keys(b)) b[k] += t[k]
    }
  }
  return { totals, cost: costUSD(byModel) }
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
  it('matches ccusage on tokens and cost', async () => {
    const ours = await ourTotals()
    const theirs = ccusageTotals()
    expect(ours.totals).toEqual(theirs.totals)
    const costDelta = Math.abs(ours.cost - theirs.cost)
    expect(costDelta <= COST_TOL_ABS || costDelta / theirs.cost <= COST_TOL_REL).toBe(true)
  }, 120_000)
})

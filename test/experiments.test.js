import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, it, expect } from 'vitest'
import { SessionParser } from '../src/main/sessions/SessionParser.js'
import { Experiments } from '../src/main/sessions/Experiments.js'
import { experimentLanes, experimentLabel } from '../src/renderer/experiments/experiments.js'

const latch = atis => ({ type: 'atis-latch', atis, sessionId: 's1' })
const experimentOf = records => {
  const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl' })
  for (const r of records) parser.feed(r)
  return parser.meta.experiment
}

describe('experiments', () => {
  it('reads the session\'s experiment id, unwrapping the old v1 form, and ignores a blank one', () => {
    expect(experimentOf([latch('')])).toBe(null)
    expect(experimentOf([latch('06b45b2ae5149077'), latch('')])).toBe('06b45b2ae5149077')
    expect(experimentOf([latch('v1.e8ea04fa13f77d5e.CICzNGsllVAYtGoZ.8e9298b0.mpucUk')])).toBe('e8ea04fa13f77d5e')
  })

  it('reads each current experiment\'s name and the settings only its slots carry', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd-exp-')), '.claude.json')
    const common = { cedar_basin: '2027-08-31' }
    fs.writeFileSync(file, JSON.stringify({ clientDataCacheSlots: {
      a: { model: 'claude-opus-5-5', entrypoint: 'cli', at: '200', data: { ...common, atis: 'abc', experimentKey: 'claude_code_x_experiment', guide: 'text', map: { a: 'b' } } },
      b: { model: 'claude-opus-5-5', entrypoint: 'sdk-ts', at: '300', data: { ...common, atis: 'abc', experimentKey: 'claude_code_x_experiment', guide: 'text v2' } },
      c: { model: 'claude-haiku-5-5', entrypoint: 'cli', at: '100', data: { ...common, per_turn_effort: true } },
    } }))
    const experiments = await new Experiments(file).get()
    expect(Object.fromEntries(experiments)).toEqual({ abc: {
      name: 'claude_code_x_experiment', models: ['claude-opus-5-5'], cachedAt: 300,
      settings: { guide: 'text v2' },
    } })
    expect(await new Experiments(file + '.missing').get()).toEqual(new Map())
  })

  it('leaves out the settings another experiment on the same model has too', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd-exp-')), '.claude.json')
    fs.writeFileSync(file, JSON.stringify({ clientDataCacheSlots: {
      a: { model: 'claude-opus-5-5', at: '1', data: { atis: 'one', games: 'rule', map: { x: 'y' } } },
      b: { model: 'claude-opus-5-5', at: '2', data: { atis: 'two', games: 'rule', map: { x: 'z' } } },
      c: { model: 'claude-sonnet-5-5', at: '3', data: { atis: 'three', games: 'rule' } },
    } }))
    const experiments = await new Experiments(file).get()
    expect([...experiments].map(([id, e]) => [id, Object.keys(e.settings)])).toEqual([['one', ['map']], ['two', ['map']], ['three', ['games']]])
  })

  it('lays out a lane per experiment, merging its sessions\' overlapping spans', () => {
    const lanes = experimentLanes([
      { experiment: 'bbbb', activityPeriods: [{ start: 50, end: 60 }] },
      { experiment: 'aaaa', experimentName: 'claude_code_x_experiment', activityPeriods: [{ start: 10, end: 20 }, { start: 40, end: 45 }] },
      { experiment: 'aaaa', activityPeriods: [{ start: 15, end: 30 }] },
      { experiment: null, activityPeriods: [{ start: 0, end: 100 }] },
    ])
    expect(lanes).toEqual([
      { id: 'aaaa', name: 'claude_code_x_experiment', sessions: 2, spans: [{ start: 10, end: 30 }, { start: 40, end: 45 }] },
      { id: 'bbbb', name: null, sessions: 1, spans: [{ start: 50, end: 60 }] },
    ])
    expect(experimentLabel('aaaa', 'claude_code_x_experiment')).toBe('x')
    expect(experimentLabel('06b45b2ae5149077', null)).toBe('06b45b2a')
  })
})

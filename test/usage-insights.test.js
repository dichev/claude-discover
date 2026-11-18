// src/main/services/UsageInsights.js: /usage's transcript scan on its own schedule, each day's last scan kept as history
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { format } from 'date-fns'
import { UsageInsights } from '../src/main/services/UsageInsights.js'

let file
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-insights-')), 'usage-insights.jsonl')
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => vi.useRealTimers())

const runner = () => ({ usage: vi.fn(async () => ({ behaviors: { day: {}, week: {} } })) })
const at     = iso => new Date(iso).getTime() // local time, as the days are
const today  = () => ({ date: format(Date.now(), 'yyyy-MM-dd'), granularity: 'day' })
const saved  = () => new Promise(resolve => setTimeout(resolve, 20)) // the snapshot is written after the answer

describe('UsageInsights', () => {
  it('scans on the first ask, then only by its schedule or when forced', async () => {
    const r = runner()
    const insights = new UsageInsights(r, { file })
    expect(await insights.get(today())).toMatchObject({ day: {}, week: {} })
    expect(r.usage).toHaveBeenCalledWith({ behaviors: true })
    await insights.get(today())
    expect(r.usage).toHaveBeenCalledTimes(1)
    await insights.get({ ...today(), force: true }) // a page reload
    expect(r.usage).toHaveBeenCalledTimes(2)
  })

  it('rescans hourly only after Claude Code wrote a transcript', async () => {
    vi.setSystemTime(at('2026-11-10T10:00'))
    const r = runner()
    const insights = new UsageInsights(r, { file })
    await insights.get(today())
    insights.markActive()
    vi.setSystemTime(at('2026-11-10T10:59'))
    insights.tick()
    expect(r.usage).toHaveBeenCalledTimes(1)
    vi.setSystemTime(at('2026-11-10T11:00'))
    insights.tick()
    expect(r.usage).toHaveBeenCalledTimes(2)
    vi.setSystemTime(at('2026-11-10T13:00'))
    insights.tick() // idle since
    expect(r.usage).toHaveBeenCalledTimes(2)
  })

  it("scans once more at the day's close, if there was activity", async () => {
    vi.setSystemTime(at('2026-11-10T23:30'))
    const r = runner()
    const insights = new UsageInsights(r, { file })
    await insights.get(today())
    insights.markActive()
    vi.setSystemTime(at('2026-11-10T23:55'))
    insights.tick()
    expect(r.usage).toHaveBeenCalledTimes(2)
  })

  it("keeps each day's last scan, shown for past periods", async () => {
    const insights = new UsageInsights(runner(), { file })
    for (const time of ['2026-11-10T09:00', '2026-11-10T18:00', '2026-11-12T08:00']) {
      vi.setSystemTime(at(time))
      await insights.get({ ...today(), force: true })
      await saved()
    }
    vi.setSystemTime(at('2026-11-20T10:00'))
    expect((await insights.get({ date: '2026-11-10', granularity: 'day' })).at).toBe(at('2026-11-10T18:00'))
    expect(await insights.get({ date: '2026-11-11', granularity: 'day' })).toBeNull()
    expect((await insights.get({ date: '2026-11-11', granularity: 'week' })).at).toBe(at('2026-11-12T08:00'))
  })

  it('hands each scan to `onScan` as it starts', async () => {
    const onScan = vi.fn()
    await new UsageInsights(runner(), { file, onScan }).get(today())
    expect(await onScan.mock.calls[0][0]).toMatchObject({ behaviors: { day: {}, week: {} } })
  })

  it('keeps showing the last scan when one fails, and is null without any', async () => {
    const r = runner()
    const insights = new UsageInsights(r, { file })
    const first = await insights.get(today())
    r.usage.mockRejectedValueOnce(new Error('timeout'))
    expect(await insights.get({ ...today(), force: true })).toBe(first)
    expect(await new UsageInsights({ usage: async () => { throw new Error('unknown control request') } }, { file }).get(today())).toBeNull()
  })
})

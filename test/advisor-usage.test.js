// The advisor tool's second model bills its own tokens, listed only among the reply's usage iterations:
// they count once per call, under the advisor's model, and stay out of the conversation's context.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Pricing } from '../src/main/services/Pricing.js'
import { SessionParser } from '../src/main/sessions/SessionParser.js'
import { SessionsService } from '../src/main/services/SessionsService.js'
import { markdownSession } from '../src/renderer/sessions/MarkdownSession.js'
import seed from '../src/main/config/prices.seed.json' with { type: 'json' }

// claude-opus-4-7: input $5, output $25 per 1M; claude-fable-5-2: input $8, output $40
const pricing = new Pricing()
pricing.prices = seed

const at = minute => new Date(Date.UTC(2026, 10, 13, 10, minute)).toISOString()
const advisorIt = (input, output) => ({ type: 'advisor_message', model: 'claude-fable-5-2', input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
const executorIt = (input, output) => ({ type: 'message', input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
// One line of a reply: the executor's usage on top, each advisor call among the iterations
const line = (id, minute, iterations, uuid = `${id}-${minute}`) => ({
  type: 'assistant', uuid, timestamp: at(minute),
  message: { id, role: 'assistant', model: 'claude-opus-4-7', content: [], usage: { input_tokens: 1000, output_tokens: 100, iterations } },
})
const oneCall = [executorIt(500, 50), advisorIt(100_000, 5000), executorIt(500, 50)]
const twoCalls = [executorIt(500, 50), advisorIt(100_000, 5000), executorIt(250, 25), advisorIt(50_000, 2000), executorIt(250, 25)]

const parse = (records, opts = {}) => {
  const parser = new SessionParser({ sessionId: 's1', filePath: 's1.jsonl', pricing, ...opts })
  for (const r of records) {
    parser.feed(r)
  }
  return parser.finalize(0)
}

describe('SessionParser — advisor tokens', () => {
  it('counts an advisor call under its own model, apart from the context size', () => {
    const meta = parse([line('m1', 0, oneCall)])
    expect(meta.advisor).toMatchObject({ calls: 1, totalTokens: 105_000, byModel: { 'claude-fable-5-2': { input: 100_000, output: 5000 } } })
    expect(meta.advisor.cost).toBeCloseTo(1, 6) // 0.8 + 0.2
    expect(meta.tokens).toMatchObject({ input: 101_000, output: 5100 })
    expect(meta.totalTokens).toBe(106_100)
    expect(meta.cost).toBeCloseTo(1.0075, 6) // + the executor's 0.005 + 0.0025
    expect(meta.costByType.input + meta.costByType.output).toBeCloseTo(meta.cost, 6)
    expect(meta.costSamples.reduce((sum, s) => sum + s.cost, 0)).toBeCloseTo(meta.cost, 6)
    expect(meta.lastContextTokens).toBe(500) // the last executor call's prompt, not the reply's summed usage
    expect(meta.models).toEqual(['claude-opus-4-7'])
  })

  it('counts each advisor call in a reply', () => {
    const meta = parse([line('m1', 0, twoCalls)])
    expect(meta.advisor).toMatchObject({ calls: 2, totalTokens: 157_000 })
    expect(meta.advisor.cost).toBeCloseTo(1.2 + 0.28, 6)
  })

  it('counts a reply once across the lines repeating its usage', () => {
    const meta = parse([
      line('m1', 0, oneCall.slice(0, 2)), // streamed before the second call was listed
      line('m1', 1, twoCalls),
      line('m1', 2, twoCalls),
    ])
    expect(meta.advisor).toMatchObject({ calls: 2, totalTokens: 157_000 })
    expect(meta.tokens.input).toBe(151_000)
  })

  it('counts a reply streamed across the period start in the period it began', () => {
    const range = { start: Date.parse(at(1)), end: Date.parse(at(59)) }
    const meta = parse([line('m1', 0, oneCall), line('m1', 2, oneCall), line('m2', 3, oneCall)], { range })
    expect(meta.advisor).toMatchObject({ calls: 1, totalTokens: 105_000 })
  })

  it('reprices only the executor\'s cache, so the advisor suggests no saving', () => {
    const meta = parse([line('m1', 0, oneCall)])
    expect(meta.cacheCosts['5m']).toBeCloseTo(meta.cost, 6)
  })
})

describe('SessionsService — advisor tokens', () => {
  it('counts a resumed session\'s copy of an advisor call once', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-'))
    const write = (name, records) => {
      fs.mkdirSync(path.join(root, 'proj'), { recursive: true })
      fs.writeFileSync(path.join(root, 'proj', name), records.map(r => JSON.stringify(r)).join('\n') + '\n')
    }
    const user = (uuid, minute) => ({ type: 'user', uuid, timestamp: at(minute), cwd: '/proj', message: { role: 'user', content: 'go' } })
    write('first.jsonl', [user('u1', 0), line('m1', 1, oneCall, 'a1')])
    write('resumed.jsonl', [line('m1', 1, oneCall, 'a1'), user('u2', 5), line('m2', 6, twoCalls, 'a2')])
    const service = new SessionsService({ root })
    service.pricing.prices = seed
    const sessions = await service.scan({ start: Date.parse(at(0)), end: Date.now() + 3600_000 })
    const byFile = Object.fromEntries(sessions.map(s => [path.basename(s.filePath), s.advisor]))
    expect(byFile['first.jsonl'].calls).toBe(1)
    expect(byFile['resumed.jsonl'].calls).toBe(2) // only its own reply
    const cost = sessions.reduce((sum, s) => sum + s.advisor.cost, 0)
    expect(cost).toBeCloseTo(1 + 1.48, 6)
    fs.rmSync(root, { recursive: true })
  })
})

describe('markdownSession — advisor', () => {
  it('lists the advisor\'s share only when the session called it', () => {
    const summary = records => markdownSession({ ...parse(records), sessionId: 's1' }, []).body
    expect(summary([line('m1', 0, twoCalls)])).toContain('## Potential savings\n- Advisor, 2 calls on claude-fable-5-2: (99%) −$1.48\n')
    expect(summary([line('m1', 0, [executorIt(1000, 100)])])).not.toContain('Advisor')
  })
})

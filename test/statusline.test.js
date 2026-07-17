import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Run bin/claude/statusline.mjs as Claude Code does: spawn node, pipe the status JSON to stdin, read the line back.
const SCRIPT = fileURLToPath(new URL('../bin/claude/statusline.mjs', import.meta.url))
const fixture = name => fileURLToPath(new URL(`fixtures/statusline/${name}`, import.meta.url))
// Most assertions only care about text, so run with NO_COLOR; the color test opts back in.
const run = (input, env = { NO_COLOR: '1' }) => {
  const { stdout, status, stderr } = spawnSync('node', [SCRIPT], { input: JSON.stringify(input), encoding: 'utf-8', env: { ...process.env, ...env } })
  if (status !== 0) throw new Error(`statusline exited ${status}: ${stderr}`)
  return stdout
}

describe('statusline.mjs', () => {
  it('prints just the model name when no other fields are present', () => {
    expect(run({ model: { display_name: 'Claude Sonnet 4.6' } }).trim()).toBe('[Sonnet 4.6]')
  })

  it('renders the context window bar, percentage and cache hit rate', () => {
    const out = run({
      model: { display_name: 'Claude Opus 4.8' },
      context_window: {
        context_window_size: 200_000,
        current_usage: { cache_read_input_tokens: 80_000, cache_creation_input_tokens: 5_000, input_tokens: 3_000 },
      },
    })
    // used = 88k of 200k = 44%, 4 filled bar cells, 80k/88k = 90% cached
    expect(out).toContain('Context: ▓▓▓▓░░░░░░ 44% used (88.0k, 90% cached)')
  })

  it('sums token usage and dedupes assistant lines by message.id', () => {
    // dedup.jsonl: a1 (4700) counted once despite a duplicate line, + a2 (7900) = 12600, across 2 turns
    expect(run({ model: { display_name: 'Claude Opus 4.8' }, transcript_path: fixture('dedup.jsonl') }))
      .toContain('Tokens: 12.6k total (+12.6k, 2 turns)')
  })

  it('resets the per-loop total on a real user prompt but keeps the session total', () => {
    // loop-reset.jsonl: session = 3000 (3.0k), but the second user prompt starts a new loop = 2000 (2.0k), 1 turn
    expect(run({ model: { display_name: 'Claude Opus 4.8' }, transcript_path: fixture('loop-reset.jsonl') }))
      .toContain('Tokens: 3.0k total (+2.0k, 1 turn)')
  })

  it('shows rate-limit reset times and colors a high weekly limit red', () => {
    const now = Math.floor(Date.now() / 1000)
    const out = run({
      model: { display_name: 'Claude Opus 4.8' },
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: now + 9000 },   // 2h 30m, under threshold so uncolored
        seven_day: { used_percentage: 95, resets_at: now + 400_000 }, // 4d 15h, over threshold so red
      },
    }, {}) // colors on
    expect(out).toContain('Usage limit: 42% used (resets in 2h 30m)')
    expect(out).toContain('\x1b[31m95% used (resets in 4d 15h)\x1b[39m') // red wrap
  })

  it('emits no ANSI escapes when NO_COLOR is set', () => {
    const out = run({
      model: { display_name: 'Claude Opus 4.8' },
      rate_limits: { seven_day: { used_percentage: 95, resets_at: Math.floor(Date.now() / 1000) + 400_000 } },
    }, { NO_COLOR: '1' })
    expect(out).not.toMatch(/\x1b\[/)
    expect(out).toContain('Weekly limit: 95% used')
  })
})

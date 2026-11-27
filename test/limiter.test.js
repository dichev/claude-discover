import { describe, it, expect } from 'vitest'
import { Limiter } from '../src/main/sessions/utils/Limiter.js'

const deferred = () => {
  let resolve
  const promise = new Promise(r => resolve = r)
  return { promise, resolve }
}
const tick = () => new Promise(r => setTimeout(r))

describe('Limiter', () => {
  it('runs at most its size at once, the newest waiting first, and passes on what a task returns or throws', async () => {
    const limiter = new Limiter(2)
    const started = []
    const gates   = {}
    const task    = name => limiter.run(() => {
      started.push(name)
      gates[name] = deferred()
      return gates[name].promise
    })
    const runs = ['a', 'b', 'c', 'd'].map(task)
    await tick()
    expect(started).toEqual(['a', 'b'])
    gates.a.resolve('A')
    await tick()
    expect(started).toEqual(['a', 'b', 'd']) // the one asked for last goes first
    gates.b.resolve('B')
    await tick()
    gates.d.resolve('D')
    await tick()
    gates.c.resolve('C')
    expect(await Promise.all(runs)).toEqual(['A', 'B', 'C', 'D'])
    await expect(limiter.run(() => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(await limiter.run(async () => 'still free')).toBe('still free') // a failed task gave its place back
  })
})

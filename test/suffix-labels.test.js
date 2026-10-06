// suffixLabels names each dir by its folder name; dirs whose name collides
// with a different dir's get their parent folder too.
import { describe, it, expect } from 'vitest'
import { suffixLabels } from '../src/main/sessions/SessionParser.js'

describe('suffixLabels', () => {
  it('adds the parent folder to colliding labels, leaves unique ones as the folder name', () => {
    const labels = suffixLabels(['D:\\work\\forge', 'D:\\pesho\\forge', '/users/dev/app'])
    expect([...labels.values()]).toEqual(['work/forge', 'pesho/forge', 'app'])
  })

  it('repeated and missing dirs each map to one label', () => {
    const labels = suffixLabels(['/users/dev/app', '/users/dev/app', undefined])
    expect(labels.get('/users/dev/app')).toBe('app')
    expect(labels.get(undefined)).toBe('(no project)')
  })
})

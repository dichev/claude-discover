// suffixLabels names each dir by its last `depth` path segments; dirs whose
// label collides with a different dir's (tmp/test dirs) get one segment more.
import { describe, it, expect } from 'vitest'
import { suffixLabels } from '../src/main/sessions/SessionParser.js'

describe('suffixLabels', () => {
  it('deepens colliding labels, leaves unique ones at `depth` segments', () => {
    const labels = suffixLabels(['C:\\tmp-1\\app\\run', 'C:\\tmp-2\\app\\run', '/users/dev/app'])
    expect([...labels.values()]).toEqual(['tmp-1/app/run', 'tmp-2/app/run', 'dev/app'])
  })

  it('repeated and missing dirs each map to one label', () => {
    const labels = suffixLabels(['/users/dev/app', '/users/dev/app', undefined])
    expect(labels.get('/users/dev/app')).toBe('dev/app')
    expect(labels.get(undefined)).toBe('(no project)')
  })
})

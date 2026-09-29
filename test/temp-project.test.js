// tempProject folds every session run from a temp dir into one project (the temp root),
// so each fresh run dir doesn't become a project of its own.
import { describe, it, expect } from 'vitest'
import { tempProject } from '../src/main/sessions/SessionParser.js'

const WIN_TMP = 'C:\\Users\\dev\\AppData\\Local\\Temp'

describe('tempProject', () => {
  it('groups under the temp root, tagged with the path below it', () => {
    expect(tempProject(`${WIN_TMP}\\teamflows-exp-Dkl6FZ\\roles\\illustrator`))
      .toEqual({ project: WIN_TMP, tag: 'teamflows-exp-Dkl6FZ/roles/illustrator' })
    expect(tempProject('/tmp/run-a1b2c3/app')).toEqual({ project: '/tmp', tag: 'run-a1b2c3/app' })
    expect(tempProject('/private/var/folders/ab/xyz123/T/run/app').project).toBe('/private/var/folders/ab/xyz123/T')
    expect(tempProject('/var/folders/ab/xyz123/T/run').project).toBe('/var/folders/ab/xyz123/T')
  })

  it('ignores dirs outside temp, and the temp root itself', () => {
    expect(tempProject('D:\\AI\\claude-discover')).toBe(null)
    expect(tempProject('/home/dev/tmp/app')).toBe(null)
    expect(tempProject('/tmp')).toBe(null)
    expect(tempProject(null)).toBe(null)
  })
})

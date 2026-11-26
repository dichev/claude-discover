import { describe, it, expect } from 'vitest'
import { filterSessions } from '../src/renderer/sessions/sessionRows.js'

describe('filterSessions', () => {
  const session  = { sessionId: 'aaa-111', filePath: 'a.jsonl', project: 'D:\\AI\\claude-discover', projectShort: 'AI/claude-discover', aiTitle: 'Fix the filter' }
  const subagent = { sessionId: 'agent-1', parentSessionId: 'aaa-111', filePath: 'a/agent-1.jsonl', agentDescription: 'Explore' }
  const other    = { sessionId: 'bbb-222', filePath: 'b.jsonl', project: 'D:\\other', projectShort: 'other', aiTitle: 'Something else' }
  const found    = text => filterSessions([session, subagent, other], text).map(s => s.sessionId)

  it('gives every session for a blank filter', () => {
    expect(found('  ')).toEqual(['aaa-111', 'agent-1', 'bbb-222'])
  })

  it('finds by what names a session, in any case', () => {
    expect(found('fix THE')).toEqual(['aaa-111'])
  })

  it('finds a path typed with either slash', () => {
    expect(found('ai/claude')).toEqual(['aaa-111'])
    expect(found('AI\\claude')).toEqual(['aaa-111'])
  })

  it('lists a session with its subagents by its id', () => {
    expect(found('aaa-111')).toEqual(['aaa-111', 'agent-1'])
  })
})

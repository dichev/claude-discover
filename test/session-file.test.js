// A subagent spawned by a forked skill opens with a meta prompt, so its name comes only from the meta.json sidecar
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionFile } from '../src/main/sessions/SessionFile.js'

let root
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-file-'))
  const dir = path.join(root, 'proj', 'sess1', 'subagents')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent-1.jsonl'), '')
  fs.writeFileSync(path.join(dir, 'agent-1.meta.json'), '{"name":"code-review","description":"/code-review xhigh"}')
  fs.writeFileSync(path.join(dir, 'agent-2.jsonl'), '')
  fs.writeFileSync(path.join(root, 'proj', 'sess1.jsonl'), '')
  fs.writeFileSync(path.join(root, 'proj', 'sess1.meta.json'), '{"name":"not-an-agent"}')
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('SessionFile.agentMeta', () => {
  it('reads the sidecar beside a subagent transcript', async () => {
    const meta = await new SessionFile(path.join(root, 'proj', 'sess1', 'subagents', 'agent-1.jsonl')).agentMeta()
    expect(meta).toMatchObject({ name: 'code-review', description: '/code-review xhigh' })
  })

  it('is null without a sidecar, or for a top-level session', async () => {
    expect(await new SessionFile(path.join(root, 'proj', 'sess1', 'subagents', 'agent-2.jsonl')).agentMeta()).toBeNull()
    expect(await new SessionFile(path.join(root, 'proj', 'sess1.jsonl')).agentMeta()).toBeNull()
  })
})

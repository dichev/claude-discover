#!/usr/bin/env node
/*
Saves a copy of every instruction file Claude Code loads (CLAUDE.md, memory files, etc.) so we can see later what context the session actually had.

Runs on the InstructionsLoaded, SessionStart and SessionEnd hooks (wired in ~/.claude/settings.json) and appends one JSON line per file to <session>.context.ndjson,
next to the session's .jsonl transcript. Sessions started but never interacted with never get a .jsonl, so their sidecar is orphaned — on SessionEnd we delete
the just-ended session's, and sweep older ones left behind by force-closed sessions. Stays silent on errors so Claude Code doesn't surface them.

Copy-paste into ~/.claude/settings.json (replace the path):
{
  "hooks": {
    "InstructionsLoaded": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/agentic-workflow/bin/capture-context.hook.mjs" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/agentic-workflow/bin/capture-context.hook.mjs" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/agentic-workflow/bin/capture-context.hook.mjs" }] }
    ]
  }
}
*/


import fs from 'node:fs'
import path from 'node:path'
import { text } from 'node:stream/consumers'

const CLAUDE_HOOKS = {
  INSTRUCTIONS_LOADED: 'InstructionsLoaded',
  SESSION_START:       'SessionStart',
  SESSION_END:         'SessionEnd',
}
const RECORD_TYPE = 'instructions-loaded'
const ERROR_LOG = '.agentic-workflow.hook.error.log'
const CLEAR_ORPHAN_LOGS_AFTER_MS = 24 * 60 * 60_000 // Sweep orphan ndjson logs older than this. default: 1 day, set to 0 / false to disable


function readContent(filePath) {
  if (!filePath) return { error: 'no file_path' }
  try {
    return { content: fs.readFileSync(filePath, 'utf8') }
  } catch (e) {
    return { error: String(e.message || e) }
  }
}


async function main() {
  const raw = await text(process.stdin)
  const event = JSON.parse(raw || '{}')
  if (!event.transcript_path) return
  const dir = path.dirname(event.transcript_path)
  const logPath = event.transcript_path.replace('.jsonl', '.context.ndjson')
  const offsetMs = event.load_reason === 'session_start' ? -500 : 0 // Backdate session_start loads by 500ms so they sort above the first transcript events (which they fire just after).

  try {
    let record = null
    if (event.hook_event_name === CLAUDE_HOOKS.INSTRUCTIONS_LOADED) {
      const content = readContent(event.file_path)
      record = {
        type: RECORD_TYPE,
        ...event, // = { file_path, memory_type, load_reason, hook_event_name, ... }
        timestamp: new Date(Date.now() + offsetMs).toISOString(),
        ...content
      }
      fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
    }
    else if (event.hook_event_name === CLAUDE_HOOKS.SESSION_START) {
      // Claude Code does not emit InstructionsLoaded for auto-memory, so capture <projectDir>/memory/MEMORY.md ourselves.
      if (event.source !== 'resume') { // The session already captured MEMORY.md the first time it started; don't append a duplicate on resume.
        const memoryPath = path.join(dir, 'memory', 'MEMORY.md')
        if (!fs.existsSync(memoryPath)) return
        const content = readContent(memoryPath)
        record = {
          type: RECORD_TYPE,
          file_path: memoryPath,
          memory_type: 'Auto',
          load_reason: 'session_start',
          ...event,
          timestamp: new Date(Date.now() + offsetMs).toISOString(),
          ...content,
        }
        fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
      }
    }
    else if (event.hook_event_name === CLAUDE_HOOKS.SESSION_END) {
      // Session ended without ever writing a transcript -> the user never interacted with it.
      if (!fs.existsSync(event.transcript_path)) {
        fs.rmSync(logPath, {force: true}) // drop this session's orphan sidecar
      }
      // Sweep sidecars left by force-closed sessions, old enough that the missing .jsonl means abandoned, not mid-startup.
      if (CLEAR_ORPHAN_LOGS_AFTER_MS) {
        const names = new Set(fs.readdirSync(dir))
        for (const name of names) if (name.endsWith('.context.ndjson')) {
          if (!names.has(name.replace('.context.ndjson', '.jsonl'))) { // sidecar with no transcript
            const ndjsonPath = path.join(dir, name)
            const stat = fs.statSync(ndjsonPath, {throwIfNoEntry: false})
            if (stat && stat.mtimeMs < Date.now() - CLEAR_ORPHAN_LOGS_AFTER_MS) {
              fs.rmSync(ndjsonPath, {force: true})
            }
          }
        }
      }
    }
  }
  catch (err) {
    const claudeDir = path.resolve(event.transcript_path, '../../..') // transcript_path lives at <CLAUDE_DIR>/projects/<project>/<session>.jsonl
    const errLogPath = path.join(claudeDir, ERROR_LOG)
    try { fs.appendFileSync(errLogPath, `${new Date().toISOString()} ${err?.stack || err}\n`) } catch {}
  }
}

main().catch(() => {}).finally(() => process.exit(0))

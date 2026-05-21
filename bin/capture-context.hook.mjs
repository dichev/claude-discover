#!/usr/bin/env node
/*
Saves a copy of every instruction file Claude Code loads (CLAUDE.md, memory files, etc.) so we can see later what context the session actually had.

Runs on the InstructionsLoaded and SessionStart hooks (wired in ~/.claude/settings.json) and appends one JSON line per file to <session>.context.ndjson,
next to the session's .jsonl transcript. Stays silent on errors so Claude Code doesn't surface them to the user.

Copy-paste into ~/.claude/settings.json (replace the path):
{
  "hooks": {
    "InstructionsLoaded": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/agentic-workflow/bin/capture-context.hook.mjs" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/agentic-workflow/bin/capture-context.hook.mjs" }] }
    ]
  }
}
*/


import fs from 'node:fs'
import path from 'node:path'
import { text } from 'node:stream/consumers'

const HOOK_INSTRUCTIONS_LOADED = 'InstructionsLoaded'
const HOOK_SESSION_START       = 'SessionStart'
const RECORD_TYPE              = 'instructions-loaded'
const ERROR_LOG                = '.agentic-workflow.hook.error.log'


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
  const offsetMs = event.load_reason === 'session_start' ? -500 : 0 // Backdate session_start loads by 500ms so they sort above the first transcript events (which they fire just after).

  try {
    let record = null
    if (event.hook_event_name === HOOK_INSTRUCTIONS_LOADED) {
      const content = readContent(event.file_path)
      record = {
        type: RECORD_TYPE,
        ...event, // = { file_path, memory_type, load_reason, hook_event_name, ... }
        timestamp: new Date(Date.now() + offsetMs).toISOString(),
        ...content
      }
    }
    else if (event.hook_event_name === HOOK_SESSION_START) {
      if (event.source !== 'resume') { // The session already captured MEMORY.md the first time it started; don't append a duplicate on resume.
        // Claude Code does not emit InstructionsLoaded for auto-memory, so capture <projectDir>/memory/MEMORY.md ourselves.
        const memoryPath = path.join(path.dirname(event.transcript_path), 'memory', 'MEMORY.md')
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
      }
    }
    else {
      return
    }

    const logPath = event.transcript_path.replace('.jsonl', '.context.ndjson')
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
  }
  catch (err) {
    const claudeDir = path.resolve(event.transcript_path, '../../..') // transcript_path lives at <CLAUDE_DIR>/projects/<project>/<session>.jsonl
    const errLogPath = path.join(claudeDir, ERROR_LOG)
    try { fs.appendFileSync(errLogPath, `${new Date().toISOString()} ${err?.stack || err}\n`) } catch {}
  }
}

main().catch(() => {}).finally(() => process.exit(0))

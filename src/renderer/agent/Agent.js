import { useEffect, useState } from 'react'
import { MAX_LINES, MAX_LINE_CHARS, markdownSession } from '../sessions/MarkdownSession.js'
import ANALYZE_PROMPT from './ANALYZE_PROMPT.md?raw'
import ASK_PROMPT from './ASK_PROMPT.md?raw'
import DIAGNOSE_PROMPT from './DIAGNOSE_PROMPT.md?raw'
import STYLE from './STYLE.md?raw'


const TRUNCATE_NOTE = `  - Note: long content was truncated for display (lines >${MAX_LINE_CHARS} chars, blocks >${MAX_LINES} lines). The original session had the full content — base advice on what was clearly happening, not on the truncation.`
const fill = prompt => String(prompt).replace('{{TRUNCATION_NOTE}}', TRUNCATE_NOTE)
const analyzePrompt  = fill(ANALYZE_PROMPT)
const diagnosePrompt = fill(DIAGNOSE_PROMPT)
const askPrompt      = question => fill(ASK_PROMPT).replace('{{QUESTION}}', () => question)


const EMPTY = { running: false, output: '', error: '' }

// One result per key, so switching back to a session shows its last answer (or the run still streaming)
export function useAgent(key) {
  const [results, setResults] = useState({})
  const patch = (k, fn) => setResults(r => ({ ...r, [k]: { ...(r[k] ?? EMPTY), ...fn(r[k] ?? EMPTY) } }))

  useEffect(() => window.api.onAgentOutput(({ id, chunk }) => patch(id, r => ({ output: r.output + chunk }))), [])

  const run = async (prompt, meta, items, instructions) => {
    patch(key, () => ({ ...EMPTY, running: true }))
    try {
      const { body } = markdownSession(meta, items, instructions)
      // The style goes in as the system prompt: it read briefer than inline, and kept the model from taking the transcript as its own
      const { code } = await window.api.runAgentPrompt(key, `${prompt}\n\n---\n${body}`, String(STYLE))
      if (code !== 0) patch(key, () => ({ error: `Claude exited with code ${code}` }))
    } catch (err) {
      patch(key, () => ({ error: err.message || String(err) }))
    } finally {
      patch(key, () => ({ running: false }))
    }
  }

  const analyze  = (meta, items, instructions) => run(analyzePrompt, meta, items, instructions)
  const diagnose = (meta, items, instructions) => run(diagnosePrompt, meta, items, instructions)
  const ask      = (question, meta, items, instructions) => run(askPrompt(question), meta, items, instructions)

  return { ...(results[key] ?? EMPTY), analyze, diagnose, ask }
}

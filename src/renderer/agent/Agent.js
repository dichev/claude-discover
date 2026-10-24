import { useEffect, useState } from 'react'
import { MAX_LINES, MAX_LINE_CHARS, markdownSession } from '../sessions/MarkdownSession.js'
import ANALYZE_PROMPT from './ANALYZE_PROMPT.md?raw'
import ASK_PROMPT from './ASK_PROMPT.md?raw'


const TRUNCATE_NOTE = `  - Note: long content was truncated for display (lines >${MAX_LINE_CHARS} chars, blocks >${MAX_LINES} lines). The original session had the full content — base advice on what was clearly happening, not on the truncation.`
const analyzePrompt = String(ANALYZE_PROMPT).replace('{{TRUNCATION_NOTE}}', TRUNCATE_NOTE)
const askPrompt     = question => String(ASK_PROMPT).replace('{{TRUNCATION_NOTE}}', TRUNCATE_NOTE).replace('{{QUESTION}}', () => question)


export function useAgent(resetKey) {
  const [running, setRunning] = useState(false)
  const [output, setOutput]   = useState('')
  const [error, setError]     = useState('')

  useEffect(() => window.api.onAgentOutput(chunk => setOutput(p => p + chunk)), [])

  useEffect(() => {
    setError('')
    setRunning(false)
    setOutput('')
  }, [resetKey])

  const run = async (prompt, meta, items, instructions) => {
    setError('')
    setOutput('')
    setRunning(true)
    try {
      const { body } = markdownSession(meta, items, instructions)
      const { code } = await window.api.runAgentPrompt(`${prompt}\n\n---\n${body}`)
      if (code !== 0) setError(`Claude exited with code ${code}`)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setRunning(false)
    }
  }

  const analyze = (meta, items, instructions) => run(analyzePrompt, meta, items, instructions)
  const ask     = (question, meta, items, instructions) => run(askPrompt(question), meta, items, instructions)

  return { running, error, output, analyze, ask }
}

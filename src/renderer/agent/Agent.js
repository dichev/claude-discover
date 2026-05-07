import { useEffect, useState } from 'react'
import { TRUNCATE_LINES, TRUNCATE_LINE_CHARS } from '../sessions/MarkdownSession.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'


const ANALYZE_PROMPT = truncated => `
You are analyzing a Claude Code session to find token-reduction opportunities for a non-technical reader.

**Task**: Find the top 3 concrete changes specific to this session (not generic advice) that would have produced the same result for less cost.

**Input**:
  - \`<summary>\`: token/cost/cache stats
  - \`<transcript>\`: the conversation and tool calls
${truncated ? `  - Note: this is a transcript of a Claude Code session. To keep it compact, long content has been truncated (lines >${TRUNCATE_LINE_CHARS} chars, blocks >${TRUNCATE_LINES} lines). Treat the original session as if those parts were present in full; do not assume the assistant or user actually saw only the truncated form.` : ''}

**Output rules**:
Keep it short and plain. No preamble, no closing remarks.
Start with a single simple sentence summarizing the session (max ~20 words)
Then list up to 3 items (max ~15 words each), ranked by impact.  No jargon, no tool names unless essential, no token/cost math inside the sentence.
Then write down the total savings

Output format:
Summary

**Optimize:**

N. Item

Total savings $X and Y tokens
`.trim()



export function useAgent(resetKey) {
  const [truncated, setTruncated]       = useLocalStorage('agent.truncated', true)
  const [editedPrompt, setEditedPrompt] = useLocalStorage('agent.prompt', '')
  const [running, setRunning]           = useState(false)
  const [output, setOutput]             = useState('')
  const [error, setError]               = useState('')

  const defaultPrompt = ANALYZE_PROMPT(truncated)
  const prompt = editedPrompt || defaultPrompt

  useEffect(() => window.api.onAgentOutput(chunk => setOutput(p => p + chunk)), [])

  useEffect(() => {
    setError('')
    setRunning(false)
    setOutput('')
  }, [resetKey])

  const send = async (text) => {
    setError('')
    setOutput('')
    setRunning(true)
    try {
      const { code } = await window.api.runAgentPrompt(text)
      if (code !== 0) setError(`Claude exited with code ${code}`)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setRunning(false)
    }
  }

  return { running, error, send, prompt, editedPrompt, setEditedPrompt, output, truncated, setTruncated, defaultPrompt }
}

import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import EditableMarkdown from '../ui/EditableMarkdown.jsx'
import { createTypewriter } from '../utils/effects.js'
import { TRUNCATE_LINES, TRUNCATE_LINE_CHARS } from '../sessions/MarkdownSession.js'
import './AgentPrompt.css'

export function buildAgentPrompt(truncated) {
  const note = truncated ? `  - Note: this is a transcript of a Claude Code session. To keep it compact, long content has been truncated (lines >${TRUNCATE_LINE_CHARS} chars, blocks >${TRUNCATE_LINES} lines). Treat the original session as if those parts were present in full; do not assume the assistant or user actually saw only the truncated form.` : ''
  return `
You are analyzing a Claude Code session to find token-reduction opportunities for a non-technical reader.

**Task**: Find the top 3 concrete changes specific to this session (not generic advice) that would have produced the same result for less cost.

**Input**:
  - \`<summary>\`: token/cost/cache stats
  - \`<transcript>\`: the conversation and tool calls
${note}

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
}

export function useAgentPrompt(resetKey) {
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState(() => buildAgentPrompt(true))
  const typer = useRef(null)
  if (!typer.current) typer.current = createTypewriter((chunk) => setOutput((p) => p + chunk))

  const reset = () => {
    typer.current.reset()
    setOutput('')
    setError('')
    setRunning(false)
  }

  useEffect(() => window.api.onAgentOutput(typer.current), [])
  useEffect(() => {
    reset()
    setPrompt(buildAgentPrompt(true))
  }, [resetKey])

  const send = async (text) => {
    reset()
    setRunning(true)
    try {
      const { code } = await window.api.runAgentPrompt(text)
      if (code !== 0) setError(`claude exited with code ${code}`)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setRunning(false)
    }
  }

  return { output, running, error, send, prompt, setPrompt }
}

export function AgentPromptOutput({ output, pretty, running, error }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [output, running, error])

  return (
    <div className="agent-prompt-output" ref={ref}>
      {pretty
        ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{output}</ReactMarkdown></div>
        : <pre className="agent-view-raw">{output}</pre>}
      {running && (
        <div className="agent-prompt-typing" aria-label="Running">
          <span className="dot" /><span className="dot" /><span className="dot" />
        </div>
      )}
      {error && <div className="agent-prompt-error">{error}</div>}
    </div>
  )
}

export default function AgentPrompt({ prompt, onPromptChange, pretty }) {
  return (
    <div className="agent-prompt">
      <div className="agent-view-block">
        <EditableMarkdown source={prompt} styled={pretty} onChange={onPromptChange} storageKey="agent-view-prompt" />
      </div>
    </div>
  )
}

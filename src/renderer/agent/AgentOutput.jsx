import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { createTypewriter } from '../utils/effects.js'
import './AgentOutput.css'

export default function AgentOutput({ output, pretty, running, error }) {
  const [displayed, setDisplayed] = useState(output)
  const lastOutputRef = useRef(output)
  const scrollRef     = useRef(null)
  const typer         = useRef(createTypewriter((chunk) => setDisplayed(p => p + chunk)))

  useEffect(() => {
    const prev = lastOutputRef.current
    lastOutputRef.current = output
    if (output.startsWith(prev)) {
      const diff = output.slice(prev.length)
      if (diff) typer.current(diff)
    } else {
      typer.current.reset()
      setDisplayed(output)
    }
  }, [output])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [displayed, running, error])

  if (!displayed && !running && !error) return null

  return (
    <div className="agent-prompt-output" ref={scrollRef}>
      {pretty
        ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{displayed}</ReactMarkdown></div>
        : <pre className="agent-view-raw">{displayed}</pre>}
      {running && (
        <div className="agent-prompt-typing" aria-label="Running">
          <span className="dot" /><span className="dot" /><span className="dot" />
        </div>
      )}
      {error && <div className="agent-prompt-error">{error}</div>}
    </div>
  )
}

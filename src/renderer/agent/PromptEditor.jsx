import { useState } from 'react'
import Markdown from '../ui/Markdown.jsx'
import './PromptEditor.css'

// Agent prompt editor. Pretty mode renders the prompt as markdown and switches to the raw
// editor on click (blur switches back); raw mode keeps the editor permanently open. An empty
// `edited` means "not edited" — the prompt falls back to `source` (mirrors Agent.js).
export default function PromptEditor({ source, edited, setEdited, pretty }) {
  const [editing, setEditing] = useState(false)
  const value = edited || source

  return (
    <div className="prompt-editor-wrap">
      {edited && edited !== source && (
        <button type="button" className="prompt-editor-reset" onClick={e => { e.stopPropagation(); setEdited('') }}>Reset</button>
      )}
      {pretty && !editing
        ? <Markdown className="prompt-editor-styled" text={value} onClick={() => setEditing(true)} title="Click to edit" />
        : <textarea
            className="prompt-editor-raw"
            value={value}
            spellCheck
            autoFocus={pretty}
            onChange={e => setEdited(e.target.value)}
            onBlur={pretty ? () => setEditing(false) : undefined}
          />}
    </div>
  )
}

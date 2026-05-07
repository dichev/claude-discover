import React, { useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import './EditableMarkdown.css'

export default function EditableMarkdown({ source, edited, setEdited, styled }) {
  const ref = useRef(null)
  const [editing, setEditing] = useState(false)
  const value = edited || source
  const showStyled = styled && !editing

  useLayoutEffect(() => {
    if (!showStyled && ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value
    }
  }, [showStyled, value])

  return (
    <div className="editable-md-wrap">
      {edited && edited !== source && (
        <button type="button" className="editable-md-reset" onClick={e => { e.stopPropagation(); setEdited('') }}>Reset</button>
      )}
      {showStyled
        ? <div className="markdown editable-md-styled" onClick={() => setEditing(true)} title="Click to edit">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{value}</ReactMarkdown>
          </div>
        : <pre
            ref={ref}
            className="editable-md-raw"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            autoFocus={styled}
            onInput={e => setEdited(e.currentTarget.innerText)}
            onBlur={styled ? () => setEditing(false) : undefined}
          />}
    </div>
  )
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { delegate } from 'tippy.js'
import App from './App.jsx'
import { clearOutdatedLocalStorage } from './utils/useLocalStorage.js'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-200.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import 'highlight.js/styles/github-dark.css'
import 'tippy.js/dist/tippy.css'
import './styles.css'

clearOutdatedLocalStorage()

// Plain-text tooltips from title / data-tippy-content. allowHTML stays OFF: these carry
// untrusted transcript fields (session/model/type labels), so tippy must render them as text.
delegate('body', {
  target: '[title], [data-tippy-content]',
  delay: [0, 0],
  content(reference) {
    const title = reference.getAttribute('title')
    reference.removeAttribute('title')
    return title
  },
  onShow(instance) { // re-read data-tippy-content each show so tooltips over live-updating data stay fresh
    const content = instance.reference.getAttribute('data-tippy-content')
    if (content != null) instance.setContent(content)
  }
})

// HTML tooltips, opt-in via data-tippy-html. Only ever set from trusted, numeric content
// (the token-usage breakdown) — never from transcript data. Keep it that way.
delegate('body', {
  target: '[data-tippy-html]',
  delay: [0, 0],
  allowHTML: true,
  content: reference => reference.getAttribute('data-tippy-html'),
  onShow(instance) {
    instance.setContent(instance.reference.getAttribute('data-tippy-html'))
  }
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

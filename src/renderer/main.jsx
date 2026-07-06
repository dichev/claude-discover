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
import './markdown.css'
import './styles.css'

clearOutdatedLocalStorage()

delegate('body', { // replace title attributes with tippy tooltips
  target: '[title], [data-tippy-content]',
  delay: [0, 0],
  allowHTML: true,
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

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

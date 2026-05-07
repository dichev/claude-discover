import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { clearOutdatedLocalStorage } from './utils/useLocalStorage.js'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import 'highlight.js/styles/github-dark.css'
import './markdown.css'
import './styles.css'

clearOutdatedLocalStorage()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

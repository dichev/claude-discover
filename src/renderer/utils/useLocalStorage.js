/* global __APP_VERSION__ */
import { useEffect, useState } from 'react'

const VERSION_KEY = 'version'


export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key)
    try {
      if (raw !== null) return JSON.parse(raw)
    } catch { /* an unparsable value (e.g. a stored "undefined") falls back to the initial one */ }
    return typeof initial === 'function' ? initial() : initial // match React's useState lazy-init signature
  })

  useEffect(() => {
    if (value !== undefined) localStorage.setItem(key, JSON.stringify(value)) // "undefined" isn't JSON, so it would fail to parse back
  }, [key, value])

  return [value, setValue]
}


export function clearOutdatedLocalStorage() {
  const version = localStorage.getItem(VERSION_KEY)
  if (version !== __APP_VERSION__) {
    const [MAJOR, MINOR, PATCH] = __APP_VERSION__.split('.')
    const [major, minor, patch] = (version ?? '').split('.')
    if (MAJOR !== major || MINOR !== minor) {
      localStorage.clear()
    }
    localStorage.setItem(VERSION_KEY, __APP_VERSION__)
  }
}
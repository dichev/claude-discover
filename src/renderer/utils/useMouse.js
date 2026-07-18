import { useEffect, useRef } from 'react'
import { useLocalStorage } from './useLocalStorage.js'

// Font zoom: Shift/Ctrl + wheel changes the scale, middle click with the modifier resets it.
// Attach the returned ref to the element and multiply its font sizes by the scale
// (e.g. via a `--font-scale` CSS variable). Persisted per storageKey.
export function useMouseFontScale(storageKey) {
  const [scale, setScale] = useLocalStorage(storageKey, 1)
  const ref = useRef(null)
  useMouse(ref, {
    onZoom: e => {
      const dir = (e.deltaY || e.deltaX) < 0 ? 1 : -1 // shift+wheel reports the delta on X on some platforms
      setScale(s => Math.min(2, Math.max(0.7, Math.round((s + dir * 0.1) * 10) / 10)))
    },
    onReset: () => setScale(1),
  })
  return [scale, ref]
}


// Mouse gestures on ref's element, each callback optional:
//   onZoom  — Shift/Ctrl + wheel
//   onReset — Shift/Ctrl + middle click
//   onPan   — plain horizontal wheel or plain drag, reported as onPan(dx) in pixels
// Uses native non-passive listeners (React's onWheel is passive, so it can't preventDefault);
// handlers live in a ref, so they see fresh state without re-attaching.
export function useMouse(ref, handlers) {
  const fns = useRef(handlers)
  fns.current = handlers
  useEffect(() => {
    const el = ref.current

    const wheel = e => {
      const { onZoom, onPan } = fns.current
      if (e.shiftKey || e.ctrlKey) {
        if (!onZoom) return
        e.preventDefault()
        onZoom(e)
      } else if (onPan && e.deltaX !== 0) {
        e.preventDefault()
        onPan(e.deltaX)
      }
    }

    const dragToPan = e => {
      let startX = e.clientX
      const move = me => {
        fns.current.onPan(startX - me.clientX) // dragging right moves the view left
        startX = me.clientX
      }
      const up = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    }

    const mousedown = e => {
      const { onReset, onPan } = fns.current
      if (e.shiftKey || e.ctrlKey) {
        if (e.button !== 1 || !onReset) return
        e.preventDefault() // keep Windows autoscroll from kicking in
        onReset(e)
      } else if (onPan) {
        dragToPan(e)
      }
    }

    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('mousedown', mousedown)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('mousedown', mousedown)
    }
  }, [ref])
}


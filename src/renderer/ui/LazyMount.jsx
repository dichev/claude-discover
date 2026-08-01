import { useEffect, useRef, useState } from 'react'

// Defers mounting heavy children until near the viewport, so initial render scales with what's
// visible. The placeholder keeps its attributes, so callers can still query/scroll to it.
// forceMount overrides the viewport check (the find bar sets it, so findInPage sees off-screen
// content); rootRef measures against a scrollable ancestor's clip edge instead of the viewport.
export default function LazyMount({ children, eager = false, forceMount = false, placeholderMinHeight = 120, rootRef = null, style, ...rest }) {
  const ref = useRef(null)
  const [mounted, setMounted] = useState(eager)

  const render = mounted || forceMount

  useEffect(() => {
    if (mounted) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setMounted(true); io.disconnect() }
    }, { root: rootRef?.current ?? null, rootMargin: '600px 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [mounted])

  return (
    <div ref={ref} style={render ? style : { ...style, minHeight: placeholderMinHeight }} {...rest}>
      {render && children}
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'

// Defers mounting heavy children until the wrapper is near the viewport, so initial render
// scales with what's visible. The placeholder div keeps its attributes (className, data-*, etc.)
// so callers can still query/scroll to it before the child has mounted.
// forceMount mounts the child regardless of viewport (read live, not latched) — the transcript
// views pass it while the find bar is open so findInPage can match off-screen content.
// rootRef (a React ref to a scrollable ancestor) makes the preload margin apply at that
// container's clip edge instead of the viewport's — for children inside an inner scroll box.
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

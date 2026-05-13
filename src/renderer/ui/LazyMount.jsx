import React, { useEffect, useRef, useState } from 'react'

// Defers mounting heavy children until the wrapper is near the viewport, so initial render
// scales with what's visible. The placeholder div keeps its attributes (className, data-*, etc.)
// so callers can still query/scroll to it before the child has mounted.
export default function LazyMount({ children, eager = false, placeholderMinHeight = 120, style, ...rest }) {
  const ref = useRef(null)
  const [mounted, setMounted] = useState(eager)

  useEffect(() => {
    if (mounted) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setMounted(true); io.disconnect() }
    }, { rootMargin: '600px 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [mounted])

  return (
    <div ref={ref} style={mounted ? style : { ...style, minHeight: placeholderMinHeight }} {...rest}>
      {mounted && children}
    </div>
  )
}

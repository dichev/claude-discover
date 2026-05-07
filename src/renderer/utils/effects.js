// Drips characters out of a backlog buffer on each animation frame so bursty
// input (e.g. streamed LLM deltas) is revealed smoothly. Drain rate scales
// with backlog so we catch up on big chunks instead of lagging behind.
export function createTypewriter(onText) {
  let buffer = ''
  const tick = () => {
    const n = Math.max(1, Math.ceil(buffer.length / 24))
    onText(buffer.slice(0, n))
    buffer = buffer.slice(n)
    if (buffer) requestAnimationFrame(tick)
  }
  const push = (chunk) => {
    if (!chunk) return
    const wasIdle = !buffer
    buffer += chunk
    if (wasIdle) requestAnimationFrame(tick)
  }
  push.reset = () => { buffer = '' }
  return push
}

// Find bar UI, rendered in its own WebContentsView so the input is NOT part of the searched
// page: findInPage runs on the main content only (no self-match), and focusing this input never
// touches the main content's find anchor — so navigation advances and typing keeps focus.
export class FindBar {
  constructor() {
    this.dom = {
      input: document.getElementById('q'),
      count: document.getElementById('count'),
      prev:  document.getElementById('prev'),
      next:  document.getElementById('next'),
      close: document.getElementById('close'),
    }

    this.lastId = 0   // requestId is monotonic; drop stale results from superseded keystrokes
    this.timer = null

    window.api.onFindResult(r => this.onResult(r))
    window.api.onFindOpen(() => this.onOpen())

    this.dom.input.addEventListener('input', () => this.onInput())
    this.dom.input.addEventListener('keydown', e => this.onKeydown(e))
    this.dom.prev.addEventListener('click', () => this.find(false))
    this.dom.next.addEventListener('click', () => this.find(true))
    this.dom.close.addEventListener('click', () => window.api.findClose())
  }

  render(active, total) {
    this.dom.count.textContent = this.dom.input.value ? `${active} / ${total}` : ''
    this.dom.prev.disabled = this.dom.next.disabled = !total
  }

  onResult(r) {
    if (r.id < this.lastId) return
    this.lastId = r.id
    this.render(r.active, r.total)
  }

  onOpen() {
    this.lastId = 0
    this.dom.input.focus()
    this.dom.input.select()
  }

  // Debounced so fast typing fires one search.
  onInput() {
    clearTimeout(this.timer)
    if (!this.dom.input.value) { window.api.stopFind(); this.render(0, 0); return }
    this.timer = setTimeout(() => this.find(true), 150)
  }

  onKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.find(!e.shiftKey) }
    else if (e.key === 'Escape') { e.preventDefault(); window.api.findClose() }
  }

  // findNext:true reports the first match of a new query (findNext:false searches silently) and
  // continues the session on repeats — so it serves both the initial search and next/prev nav.
  find(forward) {
    if (this.dom.input.value) window.api.findInPage(this.dom.input.value, { forward, findNext: true })
  }
}

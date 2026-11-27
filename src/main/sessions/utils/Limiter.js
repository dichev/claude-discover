// Runs at most `size` tasks at once. The ones waiting start newest first: a scan the window or a tool started last
// is the one being waited on, and a superseded one's parses aren't wasted (the MetaCache keeps them) but needn't come first.
export class Limiter {
  #free
  #waiting = []

  constructor(size) {
    this.#free = size
  }

  async run(task) {
    if (this.#free > 0) this.#free--
    else await new Promise(resolve => this.#waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = this.#waiting.pop()
      if (next) next()
      else this.#free++
    }
  }
}

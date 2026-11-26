import { fill, fmtDay, label, sessionArg, sessionFile, shortId, Tool } from './utils.js'
import TEMPLATE from './session_open.md?raw'

// Shows a session in the app's window, as a claude-discover:// link does: on its last active day, picked by its file,
// which tells apart the transcripts sharing an id. The only tool that acts, so not marked read-only as the others are.
export class SessionOpen extends Tool {
  name = 'session_open'
  description = 'Opens a Claude Code session in the Claude Discover app, for the user to look at: brings its window forward on the session\'s last active day, with the session selected.'
  schema = { session: sessionArg }
  annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true }

  async run({ session }) {
    const meta = await this.sessions.wholeMeta(await sessionFile(this.sessions, session)) // its figures alone: the conversation isn't read
    const day = fmtDay(meta.lastActivityAt)
    this.open({ id: meta.filePath, date: day })
    return fill(TEMPLATE, { session: shortId(meta), label: label(meta), day })
  }
}

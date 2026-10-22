// How Claude Code lays out its listings — pure text helpers shared by the main process (request
// reminders) and the renderer (transcript attachments). Each returns the entries ({ name, content })
// and the text around them (`intro` before the first, `outro` after the last), so nothing goes unshown.

// `- name: description` entries (skills, agent types); a description may run over several lines.
// Past the listing budget a skill is a bare `- name`, and a name may carry a `(source)` suffix.
export const listedEntries = text => {
  const [intro, ...entries] = text.split(/^- (?=[\w./-]+(?::[\w./-]+)*(?: \([^)\n]*\))?(?:: |\r?$))/m)
  // The last entry ends at the first blank line; what follows (a closing note) comes after the list
  const last = entries.pop() ?? ''
  const end  = last.search(/\r?\n[ \t]*\r?\n/)
  if (last) entries.push(end === -1 ? last : last.slice(0, end))
  const items = entries.map(entry => {
    const at = entry.search(/: |\r?\n|$/)
    return { name: entry.slice(0, at), content: entry.slice(at).replace(/^: /, '').trim() }
  })
  return { intro: intro.trim(), items, outro: end === -1 ? '' : last.slice(end).trim() }
}

// `## <server>` sections (MCP server instructions)
export const mcpSections = text => {
  const [intro, ...sections] = text.split(/^## /m)
  const items = sections.map(section => {
    const [name, ...rest] = section.split('\n')
    return { name: name.trim(), content: rest.join('\n').trim() }
  })
  return { intro: intro.trim(), items, outro: '' }
}

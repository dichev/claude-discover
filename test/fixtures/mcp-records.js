// Transcript records the way McpTools reads them
import { McpTools } from '../../src/main/sessions/McpTools.js'

export const shape    = (shapeHash, names) => ({ type: 'api-request-shape', shapeHash, shape: { tools: names.map(name => ({ name })) } })
export const request  = (timestamp, shapeHash) => ({ type: 'api-request', timestamp, shapeHash, base: 'prev' }) // a diff on the process's previous request
export const resumed  = (timestamp, shapeHash) => ({ type: 'api-request', timestamp, shapeHash })               // a new process's first, logged whole
export const deferred = (timestamp, addedNames, removedNames = []) => ({ type: 'attachment', timestamp, attachment: { type: 'deferred_tools_delta', addedNames, removedNames } })
export const status   = (timestamp, lists) => ({ type: 'attachment', timestamp, attachment: { type: 'deferred_tools_delta', addedNames: [], removedNames: [], ...lists } })
export const use      = (timestamp, id, name) => ({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name, input: {} }] } })
export const result   = (timestamp, id, isError, content) => ({ type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } })

export const feed = records => {
  const tools = new McpTools()
  for (const obj of records) tools.feed(obj)
  return tools
}

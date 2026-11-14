// Context the user brought in themselves (IDE state, @-mentions) — every other attachment is Claude Code's own
export const USER_ATTACHMENTS = new Set(['opened_file_in_ide', 'selected_lines_in_ide', 'selected_lines_in_diff', 'file', 'already_read_file'])

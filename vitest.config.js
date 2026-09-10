import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  test: {
    // git worktrees live under .claude/ — without this every suite runs once per worktree
    exclude: [...defaultExclude, '**/.claude/worktrees/**'],
  },
})

import { join } from 'node:path'
import { includeIgnoreFile } from 'eslint/config'
import stylistic from '@stylistic/eslint-plugin'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  includeIgnoreFile(join(import.meta.dirname, '.gitignore')),
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      '@stylistic/implicit-arrow-linebreak': ['error', 'beside'], // an arrow body that doesn't fit on its line goes in {}
      '@stylistic/max-len': ['error', { code: 160, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreComments: true, ignoreRegExpLiterals: true }],
      'camelcase': ['error', { properties: 'never', ignoreDestructuring: true, ignoreImports: true, allow: ['file_path', 'memory_type', 'work_hours'] }],
      'new-cap': 'error',
      'no-undef': 'error',
    },
  },
  { files: ['src/main/**', 'src/preload/**', 'src/shared/**', 'test/**', 'bin/**', '*.js'], languageOptions: { globals: globals.node } },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat.recommended,
  },
]

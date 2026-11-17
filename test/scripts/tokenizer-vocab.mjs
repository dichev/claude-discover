#!/usr/bin/env node
/*
  Regenerate src/shared/tokenizer/vocab.json from ctok's measured vocabulary of Opus 4.7 and later (https://github.com/sanderland/ctok, MIT).

  Usage:
    node test/scripts/tokenizer-vocab.mjs [git ref]
    (the ref defaults to the commit the current file was built from)
*/

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REF = process.argv[2] ?? '07b303129759284e2cc13369453b69aeb569a278'

const SOURCE  = `https://raw.githubusercontent.com/sanderland/ctok/${REF}/ctok/data/pieces_v4_7.json`
const OUT     = join(import.meta.dirname, '../../src/shared/tokenizer/vocab.json')
const MARKERS = { '⟨bow⟩': '﷐', '⟨eow⟩': '﷑', '⟨shift⟩': '﷓' } // one codepoint each, as claudeTokenizer.js writes them

// One piece per line so an update diffs; the marker codepoints stay escaped, as they're invisible in an editor
const line = v => JSON.stringify(v).replace(/[﷐-﷓]/g, c => `\\u${c.charCodeAt(0).toString(16)}`)

const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`)
const { bytes_fallback: bytes, ...groups } = (await res.json()).tokens

const pieces = Object.values(groups).flatMap(group => Object.keys(group))
pieces.push(...Object.keys(groups.contractions).map(c => `${c}⟨eow⟩`)) // the file stores 's, the stream spells it 's⟨eow⟩
const glyphs = [...new Set(pieces)].map(p => p.replace(/⟨\w+⟩/g, m => MARKERS[m] ?? m))
const foreign = glyphs.find(p => /[⟨⟩]/.test(p))
if (foreign) throw new Error(`a notation this script doesn't decode: ${foreign}`)

const vocab = [
  '{',
  `"source": ${line(SOURCE)},`,
  '"license": "MIT, Copyright (c) 2026 Sander Land",',
  `"bytePrefixes": ${line(Object.keys(bytes))},`,
  `"pieces": [\n${glyphs.map(line).join(',\n')}\n]`,
  '}',
]
await writeFile(OUT, vocab.join('\n') + '\n')
console.log(`${glyphs.length} pieces → ${OUT}`)

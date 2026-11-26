# {{count}}

- Period: {{period}}
{{#of}}
- Session: {{{of}}}, with its subagents
{{/of}}
{{#filter}}
- Filter: "{{{filter}}}"
{{/filter}}
{{#prompt}}
- Prompt: "{{{prompt}}}"
{{/prompt}}
- Sorted by: {{sort}}
{{#showing}}
- Showing: {{showing}}{{#full}}, as many as fit in a reply{{/full}}
{{/showing}}

{{#rows.length}}
| session | label |{{#prompt}} prompt |{{/prompt}} project | models | tokens | cost | started | last active | notes |
| --- | --- |{{#prompt}} --- |{{/prompt}} --- | --- | --- | --- | --- | --- | --- |
{{#rows}}
| {{session}} | {{label}} |{{#prompt}} {{quote}} |{{/prompt}} {{project}} | {{models}} | {{tokens}} | {{cost}} | {{started}} | {{lastActive}} | {{notes}} |
{{/rows}}
{{/rows.length}}
{{^rows.length}}
{{#empty}}
None in this period: pass a wider one{{#filter}} or drop `filter`{{/filter}}.{{#filter}}{{^prompt}} To find a session by text typed in it, pass `prompt`.{{/prompt}}{{/filter}}
{{/empty}}
{{^empty}}
None from this `offset` on.
{{/empty}}
{{/rows.length}}
{{#more}}

…{{more}} more: pass `offset: {{next}}`{{^filter}}, or narrow with `filter`{{/filter}}.
{{/more}}

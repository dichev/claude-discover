# {{session}} · {{{label}}}

{{#parent}}
- Subagent of: {{parent}}
{{/parent}}
- Active: {{active}}
- Turns: {{turns}}
{{#subagents}}
- Subagents: {{count}}, costing {{cost}} more ({{total}} with the session's own), not counted here. list_sessions gives their ids, tasks and cost, with `session: "{{session}}"`, `subagents: "each"` and `since: "{{since}}"`
{{/subagents}}
{{#asOf}}
- Summary, Context and Tokens are as of turn #{{asOf}}, the rest is the whole session's
{{#run}}
- Turn #{{turn}} has no figures of its own: turns #{{start}}-{{asOf}} are counted as one
{{/run}}
{{/asOf}}

{{{summary}}}

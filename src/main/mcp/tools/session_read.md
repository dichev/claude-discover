# {{session}} · {{{label}}}

- {{{about}}}
- Turns: {{from}}-{{to}} of {{total}}
{{#kind}}
- Kind: {{kind}}
{{/kind}}
{{#brief}}
- Each block is cut to its first lines: pass `detail: "full"` for whole ones
{{/brief}}

{{#turns}}
#{{n}} {{{text}}}

---

{{/turns}}
{{^turns}}
Nothing to show in these turns.

{{/turns}}
{{#end}}
End of the session.
{{/end}}

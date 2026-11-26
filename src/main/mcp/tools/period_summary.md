# Period summary

- Period: {{period}}
{{#project}}
- Project: "{{{project}}}"
{{/project}}
{{#empty}}

No sessions in this period: pass a wider one{{#project}} or drop `project`{{/project}}.
{{/empty}}
{{^empty}}
- Estimated cost: {{cost}}
- Total tokens: {{tokens}}
- Working time: {{workingTime}}
{{#savings.length}}

## Potential savings
{{#savings}}
- {{label}}: ({{pct}}%) −{{saving}}
{{/savings}}
{{/savings.length}}

## Tokens{{#cacheHit}} ({{cacheHit}} cache hit){{/cacheHit}}
| kind | tokens | cost |
| --- | --- | --- |
{{#mix}}
| {{label}} | {{tokens}} | {{cost}} |
{{/mix}}
{{#times.length}}

## By {{by}}
| {{by}} | tokens | cost |
| --- | --- | --- |
{{#times}}
| {{start}} | {{tokens}} | {{cost}} |
{{/times}}
{{/times.length}}
{{#projects.length}}

## By project
| project | tokens | cost |
| --- | --- | --- |
{{#projects}}
| {{name}} | {{tokens}} | {{cost}} |
{{/projects}}
{{/projects.length}}
{{/empty}}

> Session browser + Token costs + API traffic
# <img src="src/renderer/assets/claude-icon.svg" width="20"> Claude Discover

Ever wondered what Claude Code is **actually** doing all day?

<img width="1660" height="1256" alt="claude-discover-dimmed-screenshot" src="https://github.com/user-attachments/assets/708d05c7-8769-47d8-b5bd-14337d1d6037" />
<br><br>

**Claude Discover** is a desktop tool that shows you what **Claude Code** is actually doing. It collects all your sessions (from the CLI, Desktop, or SDK) and puts them on one timeline, where you can read every conversation, peek at the system prompts, memories, and tools, inspect the raw API traffic behind it all, and see exactly where your tokens - and your money - went. (Spoiler: mostly on re-sending tool definitions.)

No configuration, no API keys, and **everything stays on your machine**.

## Getting started

The tool works on Windows, macOS, and Linux. If you have Node.js 22+, just try it:
```
npx claude-discover@latest
```

Like it and want to keep it around? Install it:
```
npm install -g claude-discover
claude-discover
```

## Features

- **Timeline**\
  Your Claude sessions laid out on a daily, weekly, or monthly timeline. One glance tells you where your tokens went; the second finds the session that quietly spawned 100+ agents.

- **Sessions list**\
  Filter and sort every session in the selected period. Warning badges flag the expensive habits: oversized context, extended 1h cache, fast mode, marathon sessions - and more to come.

- **Session preview**
  - **Conversation view**\
    The full transcript rendered like a chat: your prompts, Claude's replies, and every tool call expanded. Everything the terminal scrolled past, now readable at human pace.

  - **Raw logs**\
    The same session exactly as Claude Code stores it on disk, one JSON line at a time. For when you don't want the story, you want the evidence.

  - **API request inspector**\
    A Postman-like view of every API request and response, captured by an optional local proxy (one click on, one click off). This is where the secrets live: the system prompt, your CLAUDE.md and memory files, tool definitions, injected reminders - all the stuff session logs politely never record.

- **Session summary**\
  Token usage and cost for every session, and totals for the whole period. Computed from your local transcripts with current model rates - accurate to the cent.

- **AI session analysis**\
  Ask Claude to review a session and tell you where the tokens leaked - with concrete hints on how to spend fewer next time. Yes, that's Claude critiquing Claude's own spending habits, and yes it runs on your own subscription and local credentials.


## Bonus - a status line
Install the bundled Claude Code status line to see context usage, token counts, and rate limits right in your terminal - so the surprise comes *before* the limit, not after:
```text
[Opus 4.8] Context: ▓▓▓░░░░░░░ 32% used (45.2k, 87% cached)  |  Tokens: 1.2M total (+45.2k, 3 turns) ...
```

## Contributing

PRs and feature requests are welcome.
```
git clone https://github.com/dichev/claude-discover.git && cd claude-discover
npm install
npm run dev   # start the tool with vite's hot reload
npm test      # run the test suite
```

**Verifying token/cost calculations** - trust, but verify. You can print the tool's per-period token usage and cost as a terminal table, and then compare it against **ccusage** - the numbers should match to the cent:

```
node test/scripts/usage.mjs monthly --timezone UTC
npx ccusage claude monthly -z UTC
```
---
**[MIT license](LICENSE)** - Not affiliated with Anthropic.

const HOUR = 60 * 60 * 1000

export const THRESHOLDS = {
  context:  { warn: 100_000,       danger: 250_000 },
  messages: { warn: 250,           danger: 500 },
  workTime: { warn: 0.5 * HOUR,    danger: 2 * HOUR },
  cost:     { warn: 3,             danger: 8 },
  tokens:   { warn: 3_000_000,     danger: 8_000_000 },
  limit:    { warn: 60,            danger: 90 }, // % of a plan window — keep in sync with bin/claude/statusline.mjs
}

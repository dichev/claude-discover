const HOUR = 60 * 60 * 1000

export const THRESHOLDS = {
  context:  { warn: 100_000,       danger: 200_000 },
  messages: { warn: 100,           danger: 200 },
  workTime: { warn: 0.5 * HOUR,    danger: 2 * HOUR },
  cost:     { warn: 1,             danger: 5 },
  tokens:   { warn: 1_000_000,     danger: 5_000_000 },
}

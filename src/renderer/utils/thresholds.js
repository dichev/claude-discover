const HOUR = 60 * 60 * 1000

export const THRESHOLDS = {
  context:  { warn: 100_000,       danger: 200_000 },
  messages: { warn: 250,           danger: 500 },
  workTime: { warn: 0.5 * HOUR,    danger: 2 * HOUR },
  cost:     { warn: 3,             danger: 8 },
  tokens:   { warn: 3_000_000,     danger: 8_000_000 },
  usage5h:  { warn: 100,           danger: 120 }, // projected % at reset
  usage7d:  { warn: 100,           danger: 140 }, // projected % at reset
}

const PRICES = {
  'claude-opus-4':       { input: 15, output: 75, cacheRead: 1.50, cacheWrite5m: 18.75, cacheWrite1h: 30 },
  'claude-sonnet-4':     { input:  3, output: 15, cacheRead: 0.30, cacheWrite5m:  3.75, cacheWrite1h:  6 },
  'claude-haiku-4':      { input:  1, output:  5, cacheRead: 0.10, cacheWrite5m:  1.25, cacheWrite1h:  2 },
  'claude-3-5-sonnet':   { input:  3, output: 15, cacheRead: 0.30, cacheWrite5m:  3.75, cacheWrite1h:  6 },
  'claude-3-5-haiku':    { input:  0.80, output: 4, cacheRead: 0.08, cacheWrite5m: 1, cacheWrite1h: 1.6 },
  'claude-3-opus':       { input: 15, output: 75, cacheRead: 1.50, cacheWrite5m: 18.75, cacheWrite1h: 30 },
};

function priceFor(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const key of Object.keys(PRICES)) {
    if (m.startsWith(key)) return PRICES[key];
  }
  return null;
}

function bucketCost(p, b) {
  // If the 5m/1h split is missing, fall back to treating cacheCreation as 5m.
  const cc5 = b.cacheCreation5m || 0;
  const cc1 = b.cacheCreation1h || 0;
  const ccFallback = Math.max(0, (b.cacheCreation || 0) - cc5 - cc1);
  return (
    (b.input || 0) * p.input +
    (b.output || 0) * p.output +
    (b.cacheRead || 0) * p.cacheRead +
    (cc5 + ccFallback) * p.cacheWrite5m +
    cc1 * p.cacheWrite1h
  ) / 1e6;
}

export function costUSD(tokensByModel) {
  if (!tokensByModel) return null;
  let total = 0;
  let priced = false;
  for (const [model, bucket] of Object.entries(tokensByModel)) {
    const p = priceFor(model);
    if (!p) continue;
    total += bucketCost(p, bucket);
    priced = true;
  }
  return priced ? total : null;
}


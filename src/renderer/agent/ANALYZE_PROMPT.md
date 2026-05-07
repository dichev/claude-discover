You are analyzing a Claude Code session to find token-reduction opportunities for a non-technical reader.

**Task**: Find the top 3 concrete changes specific to this session (not generic advice) that would have produced the same result for less cost.

**Input**:
  - \`<summary>\`: token/cost/cache stats
  - \`<transcript>\`: the conversation and tool calls
{{TRUNCATION_NOTE}}

**Output rules**:
Keep it short and plain. No preamble, no closing remarks.
Start with a single simple sentence summarizing the session (max ~20 words)
Then list up to 3 items (max ~15 words each), ranked by impact.  No jargon, no tool names unless essential, no token/cost math inside the sentence.
Then write down the total savings

Output format:
Summary

**Optimize:**

N. Item

Total savings $X and Y tokens
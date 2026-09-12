# Markdown delimiter follow-up

## Confirmed fix

P1: table lookahead could stall the renderer on a small, malformed table-like reply. A pipe-containing paragraph followed by 12,000 spaces and `| ordinary text` took a median 182.403458 ms to parse before this change. The input is 12,026 bytes, below the supported 64 KiB reply size. Repeated streaming updates or opening several such replies repeats synchronous parsing on the UI thread.

`Markdown` calls `parseBlocks` in its text-dependent render memo. The table delimiter expression had overlapping leading whitespace matchers. On a padded line that was not a delimiter, it repeatedly redistributed the leading spaces while searching for a match.

The fix trims the candidate before applying the existing delimiter expression. Outer whitespace was already accepted by that grammar; this removes the ambiguous prefix without changing table recognition. It is one production line in `desktop/src/markdown-parse.ts`. It is distinct from the previously fixed heading expression.

## Evidence

Exact pre-edit files are in `/tmp/shinbo-markdown-final-audit/baseline/desktop/src/`. `desktop/test/markdown-performance.test.mjs` runs the actual parser and optionally compares it against that baseline:

```sh
SHINBO_MARKDOWN_BASELINE=/tmp/shinbo-markdown-final-audit/baseline/desktop node --test desktop/test/markdown-performance.test.mjs
```

Five-run median on the same 12,026-byte fixture: **182.403458 ms → 0.039708 ms**. The output remains one paragraph with the same text.

The comparison also checks exact parser output for 4,681 generated short delimiter candidates including spaces, tabs, pipes, dashes, colons, and Unicode line/paragraph separators. Explicit valid table fixtures retain their rows. A 60,026-byte padded malformed candidate runs in a separate process with a two-second timeout, guarding against reintroducing the stall without hanging the whole test runner.

Main TypeScript compilation into an isolated `/tmp` directory, renderer typecheck, scoped lint, all 11 existing Markdown tests, and the three wave-three/Markdown performance tests passed. No production bundle was rebuilt by this subtask. Real Electron validation belongs to the coordinating audit.

## Bounded coverage and limits

Inspected block parsing and inline parsing from the actual Markdown render caller. Time-limited probes also covered long rule/list/fence candidates, code spans, emphasis, bracket-heavy inline text, and file suffix matching. These did not demonstrate another comparable multi-second or quadratic stall in the tested supported sizes. Bracket-heavy text still has bounded inline matcher cost (about 108 ms for 60,000 opening brackets in one local probe); no separate fix or priority claim is made for that case. This is bounded evidence, not a claim that every possible Markdown input has been exhaustively tested.

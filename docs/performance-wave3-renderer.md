# Wave-three renderer audit

This bounded pass found and fixed two additional P1 defects in trace layout and Markdown heading parsing. It also inspected model-picker work, sidebar grouping/search, and renderer polling/subscription lifecycles without finding another verified P1 issue in those areas. Earlier rail, completed-tool-row, ledger, completed-turn, composer, and observer fixes were not recounted.

Exact pre-edit copies of the two owned production files are retained under `/tmp/shinbo-perf-wave3-renderer/desktop`: `shared/trace.ts` and `src/markdown-parse.ts`. The coordinator explicitly extended this agent's ownership to `shared/trace.ts`; the other agent's `shared/agents.ts` work was not touched. No main-process file, dependency, commit, or production build output was changed.

| Priority and issue | Actual-source fixture | Baseline → fixed |
| --- | --- | --- |
| P1: Every appended trace sibling recopies all preceding siblings | One long live turn with 8,000 sibling spans | 31,996,000 → 0 recopied sibling references per layout; median 52.560 → 8.770 ms |
| P1: Padded Markdown headings trigger catastrophic regex backtracking | `# x`, 1,000 spaces, then `x` | Median 434.939 → 0.003792 ms per parse; identical parsed text |

Times are medians of five calls executing the real source on the shared development machine. The structural trace count is independently instrumented; instrumentation is excluded from timing. These are isolated JavaScript measurements, not Electron frame timings or provider-speed claims.

## Trace layout

`Timeline` recomputes layout on incoming spans and its 500 ms live clock. Its context axis also calls `layoutSpans` through `tokenAxis`; `renderTrace` uses the same layout helper. `AgentLoop.noteTool` appends each new tool span under the run root, and live span lists have no truncation in `AgentLoop.spans`. The runtime's 250 ms delta-refresh interval and the timeline clock make the same long run's layout recurring work. Durable trace and phone-preview byte limits do not bound this live in-memory sibling list.

Previously, `children.set(parent, [...existing, span])` made a fresh array for every sibling. A group of 8,000 siblings copied its previous entries 31,996,000 times before sorting or drawing anything. The shared helper now appends to its own existing child array, which is local to that layout invocation. Input spans and their ordering are not mutated. Sorting, missing-parent treatment, depth limits, collapsed rows, duration, and context-axis behavior remain unchanged.

The new regression compares complete baseline/current row JSON, preserves the original span references, verifies duration/depth/child counts, checks collapsed output, and exercises `tokenAxis`. Existing trace tests also cover hierarchy, orphan roots, running spans, readable trace formatting, and serialization. The 8,000-span fixture is a deliberately long supported run, not a claim about typical turns. Rendering thousands of DOM rows still has a cost; no separate DOM improvement is claimed.

## Markdown headings

`Markdown` calls `parseBlocks` for assistant replies, user messages, CLI rich output, and Markdown file previews. Its heading regex combined a lazy body with repeated optional whitespace/hash suffixes. A heading containing interior padding forced the engine through a rapidly growing set of equivalent failed suffix matches. A 1,000-space interior gap already occupied the renderer for roughly 435 ms. A larger exploratory baseline probe was interrupted instead of leaving the JavaScript thread busy indefinitely.

The parser now matches only the heading prefix, trims trailing whitespace, scans trailing hashes once, and trims the remaining whitespace. It preserves the previous handling of Unicode line/paragraph separators: they may be trimmed from the suffix, but an interior separator still prevents this single-line heading form. No input text is truncated and no new display limit was introduced. Existing comments in the edited parser were removed under `AGENTS.md`.

The regression checks byte-for-byte parser output against the frozen baseline for 4,665 generated heading inputs, including indentation, tabs, hashes, empty headings, too many opening hashes, and Unicode line separators. It also checks ordinary closing-hash syntax explicitly. A 60,000-space fixture, within the 64 KiB message boundary, runs in a separate subprocess with a three-second timeout so reintroducing the backtracking bug fails the check instead of hanging the full suite.

## Other inspected surfaces

- Model picker/catalog: the picker limits rows to 30 and settings begins with 15; both narrow their catalog before rendering. `useCodexSlugs` already shares a discovery promise for the refresh interval. No new per-row subprocess fan-out was present.
- Sidebar grouping/search: project grouping uses existing memoization and the sidebar renders a page per group, with explicit load-more behavior. Thread depth still scans the group for parent lookup, but the normal paged path did not establish a separate high-priority workload in this audit. No speculative index was added.
- Machine charts: sampling is shared, guarded against overlap, suspended while hidden, and stopped when the final listener unsubscribes.
- Harness status: polling already coalesces overlapping reads, respects visibility, drops unused log rows while closed, and removes its timer/listeners on cleanup.
- Browser placement: the current scheduler already coalesces frame requests and cleanup cancels pending frames, observers, viewport listeners, and transition tracking.
- Component loading and timeline subscriptions: inspected effects retain stale-result guards and unsubscribe on cleanup. No new demonstrated resource leak was found in this pass.
- Other Markdown paths: existing bounded inline-link matching and large-code token limits remain. This pass changes only heading recognition and does not claim an exhaustive parser-complexity audit.

## Validation and reproduction

Two new A/B regressions passed. All 68 existing trace, Markdown, and run tests passed. Main and renderer TypeScript checks and scoped ESLint passed. Compilation went to a temporary directory; `dist-main` was not modified.

```sh
SHINBO_RENDERER_WAVE3_BASELINE=/tmp/shinbo-perf-wave3-renderer/desktop node --test desktop/test/renderer-wave3-performance.test.mjs
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.renderer.json --noEmit
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave3-renderer/compiled/dist-main
mkdir -p /tmp/shinbo-perf-wave3-renderer/compiled/src
ln -sf "$PWD/desktop/src/timeline.tsx" /tmp/shinbo-perf-wave3-renderer/compiled/src/timeline.tsx
NODE_PATH="$PWD/desktop/node_modules" node --test /tmp/shinbo-perf-wave3-renderer/compiled/dist-main/test/trace.test.js /tmp/shinbo-perf-wave3-renderer/compiled/dist-main/test/markdown.test.js /tmp/shinbo-perf-wave3-renderer/compiled/dist-main/test/runs.test.js
cd desktop
./node_modules/.bin/eslint shared/trace.ts src/markdown-parse.ts test/renderer-wave3-performance.test.mjs --max-warnings 0
```

Without the optional baseline environment variable, ordinary discovery runs the new test against current source only. The existing trace test requires the temporary source symlink shown above.

The coordinator owns the complete repository checks and real-app verification. Useful interaction checks are a padded heading rendered as Markdown, and a long trace switched between time/context axes with collapse and expansion. VoiceOver, global shortcuts, privacy permissions, display geometry, signing, and non-macOS execution were not exercised by this subtask. No additional verified P1 remains in this bounded inspection; that is not a claim that the entire renderer is exhausted of performance work.

# Round-two renderer performance fixes

Two new P1 issues were fixed in narrow `desktop/src/App.tsx` hunks. Neither is a recount of the first pass's completed-message body memoization: the first lives in the separate message-navigation rail, and the second lives inside the currently streaming turn's tool rows.

The baseline is the dirty working tree frozen immediately before round two in `/tmp/shinbo-perf-round2/source.tar`, extracted at `/tmp/shinbo-perf-round2/tree`. It already includes the previous 36 fixes. Other agents' and unrelated concurrent changes were preserved. No shared modules, main-process code, dependencies, commits, or production build output were changed here.

| Issue | Fixture | Baseline → fixed | User impact |
| --- | --- | --- | --- |
| P1: Transcript navigation reparses every complete prompt on each streamed update and hover | 1,024 messages, including 512 multiline prompts of 58,515 bytes each; 20 unchanged parent renders | 10,240 → 512 full prompt parses; median 2,041.333 → 171.787 ms per batch | A large supported conversation no longer spends about 100 ms per streamed render rebuilding navigation previews. Hover/focus also reuses those previews. |
| P1: A streaming turn repeatedly scans every completed tool's output and rebuilds its row | One running turn with 128 completed tool outputs of 59,500 bytes each; 20 updates | 2,560 → 128 output inspections; median 1,321.979 → 68.849 ms per batch | Long tool-heavy turns stop spending about 66 ms per update inspecting unchanged outputs. The same bailout also avoids reconstructing unchanged edit rows and cards; no separate gain is claimed for those descendants. |

Times are medians of five batches of actual source execution on the shared development machine. The paired variants use the same fixtures; other work was running concurrently. They are JavaScript work timings, not Electron paint measurements or claims about model speed. Every batch includes its initial render. The deterministic work counts are the primary regression assertions.

## 1. Transcript rail

`ThreadView` renders `TranscriptRail` alongside the conversation on every run update. Previously, the rail mapped all user messages and split each complete prompt into line arrays even while the preview was hidden. Moving between markers repeated those allocations. A 1,024-message record fits the core message-count limit, and the 58,515-byte fixture prompts fit the 64 KiB per-message boundary.

The rail now uses React's existing `memo`, and its derived headings and full preview text use `useMemo` keyed by `messages`. Parent streaming renders reuse the component. Hover and keyboard focus still update local state and display the full cached preview. Changed messages rebuild their labels. The regression verifies label text, the complete multiline preview, keyboard focus/blur, and the exact message index used by scroll navigation.

Tradeoff: the rail retains its derived preview strings for the currently mounted history instead of repeatedly creating and discarding them. This shifts work to initial history loading and actual message changes; it does not claim to remove the initial parse.

## 2. Live-turn tool rows

`Streaming` renders `Blocks`, which groups step records and passes them through `Steps` and `latestSteps`. Those helpers preserve each unchanged `ThreadStep` object. However, `Step` was an ordinary component, so each new text delta rebuilt every old tool row and called `markedGoal` across each full output again. Collapsed `<details>` does not prevent React from executing its children. The earlier `Turn` memo does not apply to this active-turn subtree.

`Step` now uses React's existing `memo`. Stable step objects reuse their rows; immutable replacement events still update status, output, and derived cards. The fixture uses the real `latestSteps`, `spawnedThread`, `markedGoal`, and extracted `Step` implementation, with one deterministic memo instance per rendered row. It verifies that a changed output immediately produces its new goal card and a changed status displays the active-tool indicator. The 59,500-byte outputs fit the harness's 64 KiB tool-output bound.

The timing fixture measures real output scanning and construction of each Step's returned elements. It does not execute every child component or simulate browser layout, so no child-render or paint-time number is reported.

## Validation

- Both new regressions passed against the baseline and current source, with performance assertions applied to current source.
- All ten first-pass and round-two renderer performance/lifecycle tests passed together against current source.
- Renderer TypeScript and scoped ESLint passed.
- The first test attempt used an incorrectly mutable props object in the memo test double; replacing props as React does fixed the test harness. No production change was needed for that test issue.

```sh
SHINBO_RENDERER_ROUND2_BASELINE=/tmp/shinbo-perf-round2/tree/desktop node --test desktop/test/renderer-round2-performance.test.mjs
node --test desktop/test/renderer-performance.test.mjs desktop/test/renderer-round2-performance.test.mjs
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.renderer.json --noEmit
cd desktop
./node_modules/.bin/eslint src/App.tsx test/renderer-round2-performance.test.mjs --max-warnings 0
```

The new file is `desktop/test/renderer-round2-performance.test.mjs`; ordinary test discovery runs it without requiring a baseline archive. The optional baseline setting adds the paired old-source measurements. Transpilation occurs in memory and does not modify `dist-main`.

Real Electron interaction and the full required checks remain with the coordinator. Suggested focused interactions are rail hover/keyboard focus and jump navigation before and after sending or editing a message; then viewing a tool-heavy active turn and confirming changed tool statuses/cards still update. VoiceOver, global shortcuts, privacy permissions, display geometry, signing, and non-macOS execution were not exercised by this subtask.

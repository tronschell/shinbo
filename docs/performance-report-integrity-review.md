# Audit evidence integrity review

Reviewed main-table rows 1–70 against the relevant renderer, host, runtime, discovery, workspace, image, timeline, cancellation, and export reports. Also compared the current lineage and new `readTurns` changes with their saved baselines and focused tests. The coordinating agent owns the main report; this review did not edit it.

## Corrected fixture and priority claims

- Row 36 originally used 10,000 messages, beyond the 1,024-message store limit, and attached generation metadata to user messages, which the store rejects. The supported rerun keeps the same 5,000 ledger maps and 1,356,673 ASCII storage bytes but uses 1,024 timestamped messages and 512 assistant-only generations. Actual getters, ledger construction, and hook memoization still measure 300 → 3 parses, 100 → 1 builds, and a five-batch median of **1,657.465 → 20.801 ms per 100 renders**. About 16.57 ms of baseline work per render still supports P1 for the large ledger-map workload. The corrected fixture and report supersede the original latency rather than silently reusing it.
- Row 5 originally supplied 10,000 files in one folder. Actual discovery returns at most 400 files; its 2,000 count is a traversal limit, not the renderer inventory size. The corrected 400-file fixture measures **80,000 → 800 constructed command rows per 100 renders**, with a single before/fixed elapsed observation of **25.279 → 0.647 ms** for the whole batch. That is approximately 0.253 ms per baseline render and supports P2 rather than the prior P1 claim. No extra note/artifact dimension was invented to restore priority. The memo implementation remains unchanged.
- Rows 33 and 35 have valid operation-count regressions but insufficient demonstrated urgency. Catalog tests use one model per catalog and count synchronous versus asynchronous writes. Startup cleanup uses one old one-MiB file and counts removal APIs. Neither measures a large-catalog or installer-tree stall. Their supporting discovery report now classifies both as P2, matching the coordinator's main-table correction.

The corrected renderer fixtures passed their baseline/fixed focused runs and scoped lint. Their pre-edit source and logs are under `/tmp/shinbo-ledger-supported-review/`. The ledger timing ran only after the other timing agent released the lane. No production source changed in these report corrections.

## Measurement wording

- Row 41's former “within 16 ms” claim was stronger than its timer contract. A busy event loop can delay delivery. The main report now describes scheduling a 16 ms flush or flushing at the byte limit, matching the supporting report.
- Row 60's payload count is V8-modeled serialized reply bytes. It is not measured Electron wire traffic or process RSS. Explicit labeling now matches row 59 and both supporting reports.
- Rows 21, 22, and 24 compare the same original/final Git module containing multiple fixes. Their process counts establish distinct unnecessary-work mechanisms, but the elapsed differences are combined variant results, not isolated marginal savings attributable to one hunk. Row 23's folder timing also includes the traversal budget counted in row 25. Keep the distinct fixes, but state this attribution limit and do not add their times as independent savings.
- Row 43 correctly labels its memory observation as peak process RSS; its report includes Node and TypeScript in that measurement. Rows 7, 8, 12, 40, 55, 59, 60, and 65 use payload, operation, reference, file, or modeled serialization counts with their corresponding limitations. These do not establish the same quantity as RSS.
- Row 52 correctly prefers the frozen-production native timing over the earlier slower development trial. Row 58 separately reports the much smaller native improvement alongside the component-only timing. Row 66 acknowledges material residual native latency. None should be presented as eliminating all large-timeline interaction cost.
- Rows 61 and 65 distinguish test timeout/fixture scheduling from actual cancellation latency. Provider cancellation reports do not claim measured billing savings. The browser-daemon observation is a bounded ten-second experiment and appropriately remains P2.

## Counts and baseline attribution

No additional duplicate count was established. The apparent overlaps have distinct remaining work in their incremental baselines:

- Row 16 removes a redundant second whole-library request; row 67 later narrows the remaining request to summaries and selected histories.
- Rows 7, 8, 10, 11, 12, and 37 remove different copies, cache misses, projection rereads, envelope cloning, and codec work. The later host and renderer retained-history corrections are explicitly integrations under row 68 and are not new rows.
- Rows 6, 38, and 39 concern completed messages, the separate navigation rail, and completed tools within an active turn.
- Rows 44, 51, 52, 58, 62, and 66 concern layout grouping, parent-prop rendering, offscreen browser layout, local selection rendering, foreign subscription state changes, and unrelated CSS invalidation.
- Rows 44, 69, and 70 use similar indexing techniques in independent shared-layout, subagent-rail, and activity-lineage paths. A change in one does not remove work in the other two.
- Image offload, unseen-image request deferral, and the resulting queue/dwell correctness work are not separately padded counts; the latter corrections remain under their original roots. Foreground secret-tool cancellation similarly extends the existing shared command-runner finding.

Rows with mechanistic counts alone should continue to describe the operation measured rather than invented milliseconds, CPU percentage, energy savings, or an overall application speedup. Priority remains workload-specific; this review does not turn every bounded async or memo change into P1.

## Current source: lineage and turn grouping

The lineage change appends to fresh per-parent arrays. It preserves the original stable sorting, root/child traversal, connector fields, limit behavior, duplicate-ID map behavior, and input objects. Its 16,000-child result is a deliberately large library case, not a typical turn claim. The 60 visible rows do not prevent the original grouping work.

The forthcoming `readTurns` grouping change keeps the original owner map and builds groups in original span order. Duplicate span IDs retain the existing last-owner behavior; duplicate agent IDs still receive equivalent groups. `encodeSpans` does not mutate those arrays, so reusing a group for a repeated agent is safe. Existing normalization, 16-KiB text clipping, invalid dates, and `distinctTurns` insertion order remain intact. The fixture is generated by the actual encoder and stays under the one-MiB trace boundary. No source correctness defect was found in either change. This was an independent source/test review; no additional grouping benchmark was run.

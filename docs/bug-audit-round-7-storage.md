# Round 7 — attachment and note persistence

This bounded audit fixes one P1 root and one P2 root. It uses only temporary synthetic files and injected local filesystem errors. Existing age-based attachment deletion, screenshot-name collisions and artifact mutation findings are not counted again. No private data, external model calls, security probes or Windows authorization work was involved.

| ID | Severity | Trigger and user impact | Measured A | Measured B |
| --- | --- | --- | --- | --- |
| S7-A | P1 | Attachment data can be written but its durable index cannot, such as a full disk. The caller receives an attachment ID and may save it in a draft, yet after relaunch that ID cannot be read. | Save returns success; failure reported: false; reconstructed store cannot read the returned attachment. | Save rejects with the actual storage error; no unusable ID is returned. Previous index bytes and attachments survive; retry produces a readable durable attachment. |
| S7-N | P2 | A long accepted highlight expands when Markdown quote prefixes are added. The final save silently truncates it at the body limit. | Accepted input: 262,140 bytes. Save reports success and creates one note; the final words are absent. | Save reports the formatted-size error and creates zero truncated notes. Shorter retry preserves the complete quoted text, including its ending. |

## S7-A — attachment persistence failure reported as success

`desktop/main/attachments.ts` inserted the new attachment into its in-memory map and called `remember()`. That helper caught every directory, index-write and index-rename error and returned normally. Both picker-based `hold()` and dropped/pasted `save()` therefore returned IDs which only worked until the process restarted.

The durable index is now written through the existing shared atomic-write helper before publishing the attachment in memory. Failure reaches the existing caller error handling. A failed dropped-file save cleans its newly created file; a picked source file is never removed. No store format or IPC shape changes.

Two regressions inject `ENOSPC` at the index temporary-file write, one for each supported operation. They verify the failure is reported, the old index remains byte-identical, the rejected picked file is not held, prior attachments remain readable after reconstruction, no dropped-file residue remains, and a normal retry persists successfully.

## S7-N — clipping after highlight formatting

`keepRequest()` correctly limits incoming text by UTF-8 bytes. `keepNote()` then formats highlights with a `> ` prefix on each line and silently calls `clampBytes()` on the expanded body. A source within the accepted limit can therefore lose its ending. The final store boundary also receives agent-created notes directly, so it must not silently shorten their bodies.

The final body is now checked against the existing limit and rejected with an actionable error instead of truncated. No size limits are raised. The regression passes the fixture through the actual IPC request validator, then the actual note writer. It verifies no partial note is created and a shorter retry retains the exact quote-formatted text.

This is labeled P2 because the original highlighted source still exists and the user can retry; it is a confirmed incorrect save, not evidence of destruction of the original document.

## Executed checks

Original product files come from `/private/tmp/shinbo-bug-audit/source-before.tgz`, extracted under `/private/tmp/shinbo-bridge-fixes/before/desktop`. The three new regression cases are identical in both test trees. Two unrelated original vault tests need synchronous assertions in the temporary A tree because its older `listNotes()` API was synchronous; no baseline product source is changed.

- A: 0/3 new checks pass. Both attachment operations incorrectly return success; highlight save incorrectly accepts the truncated result.
- B: full attachment and vault suites pass 33/33.
- Current main TypeScript compilation and focused ESLint checks pass.
- Reproduction script: `/private/tmp/shinbo-round7-storage/repro.cjs`; pass either `/private/tmp/shinbo-round7-before/build` or `/private/tmp/shinbo-round7-storage/build` to execute the same measurements against A or B.
- Original failure output: `/private/tmp/shinbo-round7-before/results.txt`.

The root investigator owns integrated checks and real-app interaction testing. This subagent did not verify picker dialogs, alert presentation, VoiceOver, or non-macOS behavior.

## Inspected but not changed

Vault filing/tagging and artifact metadata/content lifecycle were read. Artifact metadata failure after a same-extension content write remains a potential follow-up to the already counted N2 ordering root; it was handed to the coordinator without a new count or source change. No other issue is claimed solely from source suspicion.

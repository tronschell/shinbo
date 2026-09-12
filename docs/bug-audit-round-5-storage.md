# Storage reliability audit

This bounded wave fixed three P1 data-loss causes and one P2 note-read failure. No quota is assumed. Tests used temporary local files, controlled filesystem failures and deferred model stubs; no private files, real provider requests or external side effects were involved.

| ID | Severity | Normal trigger and user impact | A measurement | B measurement |
| --- | --- | --- | --- | --- |
| S1 | P1 | Multiple tasks update different facts in the shared memory file concurrently. Successful changes disappear, so later tasks lose remembered decisions. | 12 successful replacement replies; only 1/12 replacements retained. | 12 successful replies; 12/12 retained. A rejected operation also permits the next queued operation. |
| S2 | P1 | A filesystem write fails after partial progress during memory editing or project-file Revert. The original is truncated despite the failure. | Injected ENOSPC after 4 bytes: memory retains 4/40 bytes; project file retains 4/60 bytes. | Both errors still report failure; originals retain 40/40 and 60/60 bytes. |
| S3 | P2 | Keep a note whose body is at the accepted 256 KiB limit, then open it in Knowledge. Generated metadata makes the saved file exceed the read guard. | Save succeeds; the actual `read-note` handler rejects with `That note cannot be read.` | All 262,229 stored bytes reopen, including the full 262,144-byte body. |
| S4 | P1 | Edit a just-saved note in Obsidian while its automatic title/tag model request is pending. The background result replaces the chosen title and drops structured properties. | Both user title and related-note list are lost: 0/2 retained. | User-edited file remains byte-identical: 2/2 retained. Untouched notes still receive automatic metadata. |

## S1: shared memory read/modify/write races

The memory tool is advertised as persistent across conversations, and all main-process callers use the same `memoryRoot()`. `str_replace` and `insert` each read a full file, calculate a replacement and overwrite it after awaits. Separate harness tasks can interleave these operations. The fixture starts twelve ordinary, independent replacements in one file; every call succeeds, yet eleven changes disappear before the fix.

`runMemoryCommand` now serializes commands by memory root with a small Promise Map. This also orders directory rename/delete operations against queued file edits. Failed commands do not poison later commands, and idle queue entries are removed. No model prompt changes, framework or cross-process lock was added. External editors remain outside this in-process queue.

## S2: partial writes destroy originals

Memory create/replace/insert and `FolderStore.write` wrote directly into the destination. The latter is the shared write boundary for desktop and phone Revert. The failure fixture performs a real four-byte truncating write and then throws ENOSPC; it is a controlled simulation of partial disk failure, not a claim that the machine's disk was full.

These paths now use atomic temporary-file replacement. The existing asynchronous writer was reused for memories; its synchronous counterpart supports FolderStore's synchronous callers. Replacement preserves existing file permission bits and follows existing ordinary file links to their targets. Tests verify linked executable files retain their links and mode 0764. Existing callers of the asynchronous helper retain their default mode 0600.

The memory and Revert cases are one non-atomic replacement cause demonstrated at two user-facing boundaries. Atomic rename protects against partial replacement; this does not claim fsync-level durability across sudden power loss or preservation of every extended filesystem attribute.

## S3: body limit mistaken for serialized file limit

`keepRequest` accepts a body up to `MAX_NOTE_BYTES`, and `keepNote` adds frontmatter around that body. Desktop `read-note` and note attachment through mentions compared the entire file to the body limit. A valid saved note could therefore be listed but inaccessible.

A separate `MAX_NOTE_FILE_BYTES` adds a bounded 16 KiB allowance for serialized metadata, including escaped source fields. Desktop opening and mention attachment use that file limit. Body validation remains unchanged. The phone's existing bounded-prefix read contract remains unchanged, and its performance regressions pass; no phone protocol field changed.

## S4: stale automatic metadata overwrites user work

`keep` and `keepScreen` save a note, expose it in Knowledge, then start `tagKeptNote` in the background. After awaiting the model, the old code applied its title/tags to whatever file currently occupied the path. Its deliberately small frontmatter parser cannot round-trip arbitrary Obsidian structures, so a newly added related-note array was flattened and lost in addition to the title replacement.

The background operation now snapshots the saved file before awaiting the model and applies metadata only if the file remains unchanged. Modified notes keep all their bytes. The note-kept event still fires, and untouched notes still receive titles and tags. This fixes the real automatic-tagging entry point without introducing a YAML parser or rewriting unrelated metadata.

## Files and verification

Changed source:

- `desktop/main/memory.ts`: ordered memory operations and atomic writes.
- `desktop/main/write-atomic.ts`: reusable synchronous writer and explicit permission preservation.
- `desktop/main/folders.ts`: atomic Revert destination write.
- `desktop/shared/vault.ts`: serialized-note read limit.
- `desktop/main/main.ts`: narrow `tagKeptNote`, desktop read-note and mention-read changes.
- New `desktop/test/storage-recovery.test.ts`: eight regression cases covering the four causes and adjacent recovery/compatibility behavior.

The snapshot under `/private/tmp/shinbo-storage-round5-before/` contains the relevant source before this wave. A compiled output is `/private/tmp/shinbo-storage-round5-a/dist-main`; its `results.log` records **0/5 passing reproductions**. B output is `/private/tmp/shinbo-storage-round5-b/dist-main`; its `results.log` records **62/62 passing tests**, including storage recovery, existing memory/vault/folder behavior, atomic-write failure cleanup and phone bounded-read checks. `final-recovery.log` covers the final narrow background-event adjustment.

Main TypeScript compiled successfully into that isolated output. ESLint passed on all touched source/tests. No shared app distribution was rebuilt. Root owns full integration and real-app verification; packaged behavior and Windows paths were not exercised by this investigator.

Investigated but not counted: memory `create` intentionally overwrites and says so in its public tool description; clipboard/page limits alone do not establish a data-loss defect; initial vault attachment collision and seven-day attachment cleanup were excluded as previously covered causes. A separate recorded-Revert lookup may select an older task's change when several tasks modify the same file; that lead is unproven in this wave and needs caller/selection testing before classification.

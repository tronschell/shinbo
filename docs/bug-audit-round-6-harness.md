# Harness reliability, round 6

## H6-1: P1, CLI Undo loses recovery data or deletes an existing file

This finding applies to the shipped `shinbo-cli` terminal interface and `/undo`. It does not describe Electron's Revert action. Two actual PTY fixtures demonstrate one backup/recovery root: file-state capture errors were treated as absence, and Undo discarded its saved operation before attempting restoration.

The first fixture creates a 10,485,761-byte destination and asks the model to copy an 11-byte source over it. `ChangeTracker.captureFileState` uses a bounded read and returned `null` when that read failed. Tracked copy recorded the destination as newly created. `/undo` consequently deleted the destination instead of recovering its original contents.

The second fixture copies over a 17-byte destination, temporarily moves its parent directory away, invokes `/undo`, restores the parent, and invokes `/undo` again. The first failed restore consumed the only in-memory preimage, so the retry reported nothing to undo and left the replacement contents behind.

| Actual PTY observation | A | B |
| --- | --- | --- |
| Large existing destination after copy request | Replaced with 11 bytes | Original 10,485,761 bytes preserved; tool reports backup failure |
| Large destination after `/undo` | File deleted | Original preserved |
| Small destination after failed restore and subsequent retry | 11-byte replacement remains | Original 17 bytes restored |
| Existing-file contents preserved or recovered in the two strict fixtures | 0 of 2 | 2 of 2 |

The implementation distinguishes `FileNotFound` from failed backup reads. A tracked copy, rename overwrite, or delete is rejected before changing files when its original contents cannot be captured. This deliberately retains the existing backup-size bound: tracked destructive changes at or beyond its 10 MiB read limit now return a clear tool failure rather than pretending they have a usable undo record. No unbounded memory allocation or new backup store was added.

Undo now removes an operation only after restoration succeeds and reports a specific failure while retaining the saved state for retry. File restoration uses the existing atomic writer, and overwrite-rename restoration keeps its source available until the destination preimage is restored. Ordinary file and directory renames still use native rename. Empty-directory deletion and overwrite-rename retain explicit directory state, preserving those supported operations and their recovery. A partial directory restore records the completed source move so a retry can finish without repeating it.

Changed files:

- `harness/src/core/workspace/change_tracker.zig`
- `harness/src/core/tooling/tracked_file_mutations.zig`
- `harness/src/core/app/app_commands.zig`

All relevant production callers were traced: tracked delete/copy/rename publish through `tracked_file_mutations`; file write/edit commits already provide their captured preimage through app callbacks; `/undo` consumes the tracker through `app_commands`. Existing unrelated edits are preserved. No protocol or Electron changes were needed.

## Verification and evidence

The isolated source build passes:

```sh
cd harness
zig build --prefix /private/tmp/shinbo-bug-audit/h6-build --cache-dir /private/tmp/shinbo-bug-audit/h6-build-cache --global-cache-dir /private/tmp/shinbo-bug-audit/h6-global-cache
```

The focused run passes 72 tests with one existing platform skip. It covers backup capture, failed-restore retry, ordinary copy/rename/delete recovery, oversized capture refusal for all three tracked mutation paths, directory undo, and runtime publication. Log: `/private/tmp/shinbo-bug-audit/h6-undo-tests.log`. Formatting passes for all three changed files.

Exact test command:

```sh
zig test -fno-stack-check -fno-stack-protector --dep build_options -Mroot=src/main.zig -Mbuild_options=.zig-cache/c/eab1bc09e9289d5dfce7ebed9e27379b/options.zig -lc --cache-dir /private/tmp/shinbo-bug-audit/h6-test-cache --global-cache-dir /private/tmp/shinbo-bug-audit/h6-global-cache --test-filter undoLast --test-filter captureFileState --test-filter 'tracked ' --test-filter undo -femit-bin=/private/tmp/shinbo-bug-audit/h6-undo-tests
```

The same executable PTY script drives A and B using temporary profiles, temporary files, a generated local provider response, and dummy credentials:

```sh
CHECK_FIXED=1 RESULT_PATH=/private/tmp/shinbo-bug-audit/h6-undo-large-copy-b.json python3 /private/tmp/shinbo-bug-audit/h6-undo-large-copy.py
CHECK_FIXED=1 UNDO_SCENARIO=missing_parent RESULT_PATH=/private/tmp/shinbo-bug-audit/h6-undo-retry-b.json python3 /private/tmp/shinbo-bug-audit/h6-undo-large-copy.py
```

Both B checks exit 0. Setting `HARNESS_BINARY=/private/tmp/shinbo-bug-audit/h6-undo-binary-a` makes the identical assertions fail. The `h6-undo-large-copy-a.json`, `h6-undo-retry-a.json`, matching `-b.json`, and `-strict-a.log` artifacts retain byte counts and terminal transcripts. The provider made two requests in each run: the requested tool call and the final response. No model cost or speed reduction is claimed.

PTY execution and the dummy HTTP server require access outside the restricted sandbox. macOS arm64 was exercised directly. Exact-commit remote CI and other platforms remain unverified in this focused round. Electron Revert was outside this finding and was not changed.

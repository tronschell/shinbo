# Round 3: desktop file operations and microphone cleanup

This batch fixes three additional P1 roots and one P2 root, plus follow-up coverage of the already-counted R4 microphone lifecycle issue. Tests and multiple symptoms are not additional bugs. No Windows authorization or security audit was performed. All reproduction data lives in temporary directories; no real microphone, user repository, installed plugin, or profile was used by this investigator.

## P1 G1: Discard applies filename wildcards to unselected user files

Trigger: two untracked files named `notes[1].txt` and `notes1.txt`; select only the first in Changes and discard it.

Root: `desktop/main/git.ts` passes selected paths directly into Git pathspec arguments. Git interprets brackets as a wildcard even after `--`. Every file-specific operation calling the shared internal Git helper inherited this behavior. The free-form Git command feature bypasses that helper and intentionally retains Git command semantics.

Executed A with real Git: selecting one file deleted both files, including the unselected file containing `unselected user work`. Neither file existed afterward. Executed B: selected file deleted; unselected file exists with identical bytes. Improvement: unselected files lost per operation **1 → 0**.

Fix: internal Git helper uses Git's native `--literal-pathspecs` option. Regression `discarding a filename with brackets leaves matching unselected files intact` exercises real temporary Git storage. This prevents irreversible loss from a normal filename, independently of UI confirmation.

## P1 G2: An unrelated existing folder is accepted as an isolated worktree

Trigger: create an isolated worktree with a name whose generated sibling destination already exists as an ordinary folder or another checkout.

Root: `addWorktree` immediately returned any existing destination. Both `shinbo:set-worktree` and `shinbo:worktree-add` then grant and select that directory, so the next agent turn runs there despite the user having requested an isolated checkout of the current repository.

Executed A with real Git: returned an unrelated folder containing user work and no `.git`. Executed B: rejects with `not a worktree of this repository`; unrelated bytes unchanged. Improvement: unrelated destinations accepted **1 → 0**.

Fix: reuse an existing destination only when it appears in this repository's native worktree listing. Existing valid worktree reuse remains covered by the original Git suite. No folder is deleted or modified on collision.

## P1 PL1: Failed authored-plugin replacement deletes saved instructions

Trigger: update an existing authored plugin while a new skill file write fails, such as when disk space runs out.

Root: `desktop/main/marketplace.ts` `writePlugin` recursively removed the installed plugin root before creating its replacement. An error left its original skill instructions gone and the installed-plugin record pointing to incomplete content.

Executed A: inject `ENOSPC` specifically on the replacement `SKILL.md` write; operation reports `no space left on device`, original skill no longer exists. Executed B: same failure, original skill exists with identical bytes. A separate replacement-rename failure test verifies the previous directory is restored, and successful retry leaves only the final plugin directory. Improvement: original plugin files lost on the failed write **1 → 0**.

Fix: build replacement contents in a unique sibling staging directory, then swap the old directory through a backup. Restore the backup if the final rename fails. Clean temporary staging. No registry schema or plugin interface changes. This is preservation across ordinary write/rename failure; no claim of a crash-atomic transaction across plugin content and all catalog metadata is made.

## P2 G3: Git status corrupts quoted and newline-containing filenames

Trigger: commit or inspect files containing spaces, quote characters, newlines, or an arrow string.

Root: human-readable Git porcelain paths were split on newlines and interpreted with ` -> ` regardless of filename quoting. For example, actual `copy -> invoice.txt` appeared as `invoice.txt"`, causing selected commits to name nonexistent files. Untracked diff paths used the same unsafe newline framing.

Executed A: actual filename `copy -> invoice.txt` returned as `invoice.txt"`. Executed B: all original paths survive unchanged, a selected unusual filename commits successfully, and a staged rename preserves its exact origin. This is P2 usability/correctness, separate from G1's confirmed unselected-file deletion.

Fix: request Git's NUL-delimited machine formats for status and untracked files, and parse rename source records explicitly. Existing textual parser callers remain compatible.

## Existing R4 follow-up: microphone acquisition and recorder failures

Shared root already counted earlier; no new severity count. `record()` acquired a stream before constructing/starting MediaRecorder, so either failure leaked its tracks. A thrown recorder stop also skipped release. Voice Settings leave/blur handlers skipped cancellation while acquisition was pending because `listening` was still false.

Fix: release the acquired stream on constructor/start/stop errors; cancellation releases tracks in `finally`; Voice Settings pointer-leave and blur always call the shared stop boundary. All `record()` callers route through `useDictation`; Space-hold cancellation from the earlier fix remains intact.

Five new synthetic checks cover constructor/start/stop failure and the actual JSX leave/blur handlers during pending acquisition. Executed A: each path leaves **1 active track** or accepts a late start. Executed B: **0 active tracks**, and late start rejected. No physical microphone was opened.

## Evidence and verification

Original source: `/private/tmp/shinbo-bug-audit/source-before.tgz`, extracted under `/private/tmp/shinbo-bridge-fixes/before/desktop`. Tests are copied into that isolated source tree; the unrelated new performance tests requiring a newer GitSnapshot signature are omitted only from its temporary Git test file. No baseline product source is patched.

Fixed compilation output: `/private/tmp/shinbo-round3-desktop/build`; shared `desktop/dist-main` is untouched. Source repro scripts: `/private/tmp/shinbo-round3-desktop/git-repro.cjs` and `/private/tmp/shinbo-round3-desktop/plugin-repro.cjs` accept an optional alternate desktop source root.

The first fixed Git/microphone run passed **38/38**. The final complete Git, microphone, and plugin suites pass **59/59**, including real Git repositories and injected plugin write/rename failures. The ten targeted new regressions run against original source report **0 pass / 10 fail**; after fixes all ten pass as part of the complete suites. These are three new P1 roots, one P2 root, and five checks for the existing R4 root, not ten new bugs. Both original and fixed TypeScript compilation completed successfully. Final renderer typecheck and focused ESLint both pass for the complete diff. Root owns live app verification, full repository checks, and sibling documentation coordination. The independent performance task was not messaged or changed. Narrow App.tsx ownership was coordinated with the migration and runtime investigators.

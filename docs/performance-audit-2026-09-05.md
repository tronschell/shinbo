# Performance and package audit

Audited September 5, 2026. This is an investigation of the current working tree, the existing Windows package, and the installed Windows 0.5.0 processes. The checkout contains substantial uncommitted work; the existing binaries are not a verified build of that exact source. No application behavior was changed. macOS findings are source-reviewed, not measured on a Mac.

## Follow-up: Claude Code work and current GitHub state

The first audit missed work in Claude Code's separate worktrees. [PR #57](https://github.com/tronschell/emma/pull/57), **feat(search): download zvec-grep on demand and recommend an embedding model**, merged into `dev` on September 5 at 20:33 UTC as `d9ae86fb7628b937e47dc5a2bf91bcb06115a724`. GitHub's current `dev` was verified at `0e18733a78c765be3030112a91e128e41d8bbc0e`; the primary checkout used for the original audit remains at `45445ef`. The measured 570 MiB installer below is therefore an older artifact, not the current merged implementation.

Read the main Claude Code session `9831fa12-aae4-42d4-a4b6-b5c636202834`, including the **On-demand zvec-grep with embedding UI** task report, and checked the implementation against current remote-dev source. Both packagers now omit zvec-grep. Settings / harness offers an explicit download, progress, Cancel, Retry, and installed state. Installation goes to `<userData>/vendor/zvec-grep/<version>/`, with checksum verification, staged extraction and reuse across ordinary app updates. Hosted embeddings still require this local indexing runtime. It is not downloaded merely by installing Emma.

The standalone Windows installer at `C:/wz/squirrel/Emma-0.5.0-win32-x64-Setup.exe` was independently measured at 149,875,200 bytes, or **142.93 MiB**, matching the PR's reported reduction from 597,997,568 bytes / 570.30 MiB: **74.9% smaller**. This measurement does not establish which build the user currently has running.

The [tools workflow](https://github.com/tronschell/emma/actions/runs/33990447702) completed successfully. The [published zvec-grep 0.2.1 release](https://github.com/tronschell/emma/releases/tag/zvec-grep-v0.2.1) contains both tarballs and SHA-256 sidecars: Windows x64 **458,789,873 bytes / 437.54 MiB**, macOS arm64 **104,351,538 bytes / 99.52 MiB**. The PR's statement that the real release did not yet exist is now outdated. Claude's report documents a real Windows dev-app download, restart reuse, and semantic query against a loopback server; its later session starts a published-asset test. That final live download and macOS in-app flow were not independently exercised in this audit.

Recent related PRs **#49–#58 are all merged**, including [#54](https://github.com/tronschell/emma/pull/54), which adds installed-app smoke checks for both packages, and [#58](https://github.com/tronschell/emma/pull/58), which adds application launching for computer use. PR #57's six applicable checks passed; its two packaging jobs were skipped on the dev-targeting PR. The open PR inventory is [#46](https://github.com/tronschell/emma/pull/46), **fix(ci): restore Windows builds and Zig checks**; [#26](https://github.com/tronschell/emma/pull/26), **chore(dev): release 0.3.2**; and [#25](https://github.com/tronschell/emma/pull/25), **Main**. #46's latest recorded Windows Zig and gate checks failed. No PR was modified or closed.

### Remaining search follow-ups

The bundle-removal work is implemented. Further backend pruning now reduces the optional download and post-install disk use, not the base app size. The Windows tarball still includes the GPU variants and mismatched ARM64 dependency described below. Downloading a component does not by itself guarantee lower memory once that component is enabled and running.

Source review of [the merged installer](https://github.com/tronschell/emma/blob/0e18733a78c765be3030112a91e128e41d8bbc0e/desktop/main/zvec-grep.ts) found follow-ups worth validating:

- **Preserve old versions until replacement succeeds, and clean asynchronously.** The constructor calls `sweep()` immediately; it recursively deletes every entry other than the current version with synchronous filesystem calls. On a future version bump, this removes the previous install before the user downloads its replacement, contrary to the PR's stated post-success cleanup policy. Deleting a large tree on the Electron main thread can also delay startup. Retain the previous version until successful replacement and move cleanup off the main thread.
- **Handle destination-stream failures.** `download()` creates a WriteStream without an error listener and waits only for `drain`/`end` callbacks. Disk-full or access errors can escape the intended Failed/Retry state as unhandled stream errors. Use an error-aware stream pipeline and verify disk-full, denied-write, and cancellation paths.
- **Avoid repeated buffer copying during extraction.** The tar reader repeatedly concatenates its accumulated buffer while gathering up to 1 MiB. A chunk queue or copying once into the destination buffer would reduce allocation/copy churn. Benchmark the published Windows tarball before assigning a numerical gain.
- **Correct the Mac pre-download estimate.** The status helper still estimates 180 MiB for macOS; the published archive is about 99.52 MiB. Use published metadata or a versioned asset manifest for the displayed estimate.

These are source findings, not reproduced failure claims. They do not undo the demonstrated installer-size improvement.

## Measurements

Sizes are logical file sizes, excluding filesystem allocation overhead. MiB means 1,048,576 bytes.

| Existing Windows artifact | Size |
| --- | ---: |
| `desktop/release/Emma-win32-x64` | 1,429.99 MiB / 1.396 GiB |
| Semantic-search resources, `resources/zvec-grep` | 1,055.25 MiB, 73.8% of package |
| `Emma.exe` | 215.09 MiB |
| Chromium locales | 46.65 MiB |
| Agent harness, `emma-cli.exe` | 12.33 MiB |
| Application archive, `app.asar` | 6.86 MiB |
| Rust host, `emma-host.exe` | 0.95 MiB |
| Windows installer | 570.27 MiB |

Existing renderer output totals approximately 5.27 MiB. Its largest initial JavaScript file is 1,103,955 bytes; the main stylesheet is 420,297 bytes. These are existing build outputs, not a fresh build of the working tree.

A read-only, approximately 20-second sample of the installed application's seven identified processes recorded no increase in cumulative CPU counters. End-of-sample working sets summed to 174.54 MiB and private committed memory to 478.02 MiB. These values are not additive: working set measures resident pages and can double-count shared pages; private committed memory includes nonresident allocations. The GPU process accounted for 134.75 MiB private commit and one harness for 168.66 MiB private commit / 18.11 MiB working set.

This was an opportunistic sample. Window visibility, open content, and workload were not controlled or visually verified. It is shorter than the 60-second refresh cycle and cannot establish steady-state idle CPU, leak behavior, or current-source performance.

Three standalone calls to the existing compiled Windows machine-statistics probe took 8,285 ms, 7,335 ms, and 3,939 ms. The first returned no GPU reading. These are wall-clock latency measurements, not CPU time; fallback and timeout paths can contribute. They establish that the current probe can be much slower than its one-second requested cadence on this machine.

## Prioritized changes

### 1. Semantic-search packaging: implemented in PR #57; further download pruning remains

The original package-size finding below describes the pre-#57 baseline. The on-demand component design is now merged, as documented above. Retain these measurements for optional-download pruning, not as a proposal to repeat the completed bundle removal.

[The vendor script in the original checkout](../desktop/scripts/vendor-zvec-grep.mjs) installs the full production dependency tree and only prunes ONNX binaries for other operating systems and architectures. The old packaging scripts copied the whole resulting search directory despite semantic search defaulting to disabled in [settings](../desktop/shared/settings.ts). Current remote-dev packagers omit it.

The packaged Windows search tree includes these `@node-llama-cpp` distributions:

| Distribution | MiB |
| --- | ---: |
| `win-x64-cuda-ext` | 440.19 |
| `win-x64-cuda` | 138.53 |
| `win-x64-vulkan` | 89.34 |
| `win-x64` | 34.21 |
| `win-arm64` | 9.53 |

Removing only the mismatched ARM64 distribution is a small target-pruning candidate. Moving CUDA and Vulkan acceleration to optional downloads, while retaining an appropriate CPU path, puts 677.59 MiB of current files outside the base Windows x64 package. That is a candidate reduction of about 47% of the unpacked app, not a verified functional package or installer-size prediction. Simply deleting supported GPU backends would change capabilities and may slow indexing.

Making the complete search runtime an optional component would leave approximately 374.74 MiB in the measured base package before adding component-management code. Preserve local search and offline use after installation; do not silently switch users to hosted embeddings. Downloads need pinned versions, integrity verification, atomic installation, and recoverable failure handling.

For macOS, retain Apple silicon and Metal support. Measure the Mac dependency tree independently; the Windows CUDA numbers do not apply there. Also investigate the 89.55 MiB `onnxruntime-web` subtree, source maps, source files, and duplicate runtimes, but prove actual Node import reachability and native fallback behavior before pruning them. Preserve licenses.

Validation: clean packaged installation, default local embedding model, every retained model/backend, hosted embeddings, indexing, search, disabled search, offline restart, and update paths. Record both unpacked size and newly produced installer/DMG size.

### 2. Stop computing full Git diffs for sidebar badges

High CPU, process-launch, and transient-memory opportunity on both platforms.

[useThreadGit](../desktop/src/thread-git.tsx:5) requests Git status for every distinct project represented in the thread list at mount, focus, every minute, and every generic `emma:changed` event. Its loading guard prevents overlapping calls within that hook, but there is no hidden-window gate. The [IPC handler](../desktop/main/main.ts:5100) calls [gitSnapshot](../desktop/main/git.ts:94), which collects full tracked diffs, up to 20 untracked-file diffs in parallel, branches, Git directories, remotes, and PR metadata. The sidebar badge only consumes branch/PR information.

Add a narrow summary operation for badges. Load diffs only when the Git pane or a tool needs them. Cache/coalesce by repository in main, refresh only affected repositories after writes, and pause UI-only polling while hidden. The existing PR cache can remain. This avoids unnecessary child processes and constructing large diff strings just to truncate them later.

Validation: several large dirty repositories, clean repositories, unborn branches, untracked files, PR state changes, focus/minimize transitions, and active agent edits. Compare Git child-process counts, IPC bytes, latency, and peak private memory.

### 3. Replace per-sample shell probes for machine statistics

High visible-idle cost candidate, especially Windows.

[machineSample](../desktop/main/machine.ts:58) launches PowerShell with networking, CIM, and GPU-counter queries on Windows. macOS launches a shell plus `netstat`, `awk`, `ioreg`, `grep`, and `vm_stat`. [The renderer](../desktop/src/machine.tsx:10) requests samples every second while a machine widget is mounted and the document is visible. Its shared subscription and in-flight guard already prevent duplicate widget sampling and overlap within one renderer.

Cache/coalesce samples in main across windows. Use inexpensive CPU/memory readings frequently and sample expensive GPU/network data less often. Move those expensive counters into the existing native helper/host boundary so they do not require repeated shell launches. Back off after failures. Keep visibility gating and distinguish unavailable measurements from zero.

Validation: widget present/absent, multiple widgets/windows, unsupported GPU counters, minimized windows, and sleep/wake on both systems. Count all probe children when measuring CPU. The current Windows timings above make this a strong early target.

### 4. Build thread summaries without reparsing every transcript

High scaling opportunity for large histories on both platforms.

[The host's threadSummaries handler](../crates/host/src/main.rs:517) calls `snapshot_uncached`, builds full thread objects, then converts them to summaries. [The store](../crates/core/src/thread.rs:1109) reparses every Markdown file and clears its parsed cache. Consequently a compact IPC response still requires work proportional to the entire stored transcript collection. Main has a five-second snapshot cache, while the visible renderer refreshes every minute and on change/focus.

Maintain small summary records keyed by file metadata, invalidate them on writes, and detect external edits/deletions. Parse only changed threads to refresh those summaries. Keep full transcript caching bounded separately; switching everything to permanent full-thread caching would trade CPU for potentially excessive resident memory. Avoid incrementing renderer revisions when the summary contents are unchanged.

Validation: hundreds/thousands of long threads, malformed files, external edits, deletion, archive retention, and concurrent saves. Compare first/subsequent summary latency, bytes read, allocations, and host peak memory.

### 5. Retire completed, inactive harness processes

High potential reduction in memory retained after using multiple projects.

[The harness pool](../desktop/main/main.ts:2249) reaps idle entries only when its count exceeds eight, and only when a client is added. There is no elapsed-idle eviction for completed work. [MAX_IDLE_MS](../desktop/main/harness.ts:770) is a timeout for an unanswered in-flight request, not a timeout that retires a process after successful work.

Track last use and retire eligible inactive clients after a grace period, keeping a small warm working set. Never retire active turns, pending approvals, or owned background work. Reuse the existing session persistence/resume path. Reapply pool limits after a turn finishes, since all-busy pools can exceed the nominal limit.

The sampled harness's 168.66 MiB private commit establishes a concrete retained allocation to investigate; it does not mean each retired harness frees that much physical RAM. Measure reopen latency and actual memory recovery before choosing the grace period.

### 6. Bound browser-tab retention and explicitly handle window closure

High memory opportunity after browser-heavy use, on both platforms.

[Browsers](../desktop/main/browser.ts:35) allows 12 tabs per thread/session, with no app-wide cap or inactivity policy. [layout](../desktop/main/browser.ts:290) hides inactive views but retains their WebContents. [attach](../desktop/main/browser.ts:62) only clears the main-window reference when it closes; `stopAll` is called at application quit. Explicit tab closure does close its WebContents.

Define an app-wide lifecycle for inactive sessions. Suspend or retire eligible tabs after inactivity, retaining enough metadata to reopen them. Exempt agent-driven tabs, downloads, audio, and unsaved forms. Decide explicitly which contents survive closing/reopening the main window, and reattach retained views or close them. Electron documents that WebContentsView contents require explicit lifecycle cleanup in [BaseWindow resource management](https://www.electronjs.org/docs/latest/api/base-window#resource-management).

Validation: browser use across many threads, hide/show, close/reopen main window, active automation, downloads, authentication, media, and unsaved forms. Track renderer count and memory after each cycle.

### 7. Give auxiliary windows a small renderer entry point

Medium startup, allocation, and interaction-latency opportunity on both platforms.

[main.tsx](../desktop/src/main.tsx) statically imports the full App and styles. [App](../desktop/src/App.tsx:521) selects workspace, annotation, notch, radial, activity cursor, and overlay surfaces only after those imports load. A tiny activity indicator therefore loads the same initial approximately 1.10 MB JavaScript bundle as the workspace.

Split auxiliary surfaces from the workspace at the entry/import boundary; lazy-load settings, dashboard, and other substantial infrequent views. Keep shared primitives small. Mermaid and xterm are already lazy-loaded, and overlay boot already avoids requesting a workspace snapshot. This primarily improves startup and per-window code allocation; code splitting alone does not remove those files from the installed app. This follows Electron's guidance on [deferring unused code and avoiding blocking work](https://www.electronjs.org/docs/latest/tutorial/performance).

### 8. Apply the existing locale policy to Windows packaging

Small, relatively straightforward package opportunity.

macOS already invokes [trim-packaged-locales.mjs](../desktop/scripts/trim-packaged-locales.mjs), retaining English. Windows does not perform an equivalent step. The measured Windows locales directory is 46.65 MiB; retaining its current `en-US.pak` and `en-GB.pak` leaves approximately 1.07 MiB, a candidate 45.58 MiB reduction.

Implement a Windows-specific packaging trim with explicit supported languages and verification before signing. Validate Chromium dialogs, embedded browsing, spellcheck, and locale fallback on non-English Windows. Keep language coverage a deliberate product choice.

### 9. Reduce log traffic and macOS notch wakeups

Medium/low follow-up opportunities, after the items above.

[HarnessStatus](../desktop/src/harness.tsx:24) polls the full report every ten seconds and subscribes to every log line even when its dialog is closed. Main retains up to 500 log entries of up to 8 KiB body each and broadcasts each new entry to all windows. Keep health/status updates small, subscribe to log bodies only while the viewer is open, and fetch bounded pages/tails on demand. Measure active streaming as well as idle.

On notched Macs, [openHotspot](../desktop/main/main.ts:902) polls the cursor every 250 ms when cold and 120 ms when warm. Its window is already created only near the notch and destroyed away from it. Prefer a native tracking/event path using the existing helper, or back off further when inactive. [NotchWave](../desktop/src/App.tsx:4979) still animates at roughly 11 updates/second when not busy; stop decorative updates when the surface is not needed. Verify notch hover latency, display changes, accessibility, and permission behavior on a real Mac.

## Existing optimizations to preserve

- Packaging allows compiled application directories and `ws`, rather than shipping the full desktop development dependency tree.
- Rust release builds already use LTO, one codegen unit, and stripped symbols; the measured host is under 1 MiB.
- Mermaid and xterm load lazily.
- Machine subscriptions share one renderer timer, prevent overlap, and stop when hidden.
- Snapshot requests coalesce/cache briefly in main.
- Conversation rows already use `content-visibility: auto`; further virtualization needs evidence because it can affect selection, find, and accessibility.
- The Windows keyboard helper uses a blocking message loop. It is not a busy-polling loop to optimize blindly.

## Suggested order and acceptance measurements

The semantic-search component is already merged; do not duplicate it. Validate its real published-asset installation and address the installer follow-ups above. Continue performance work with the narrow Git summary, cheaper machine sampling, and explicit Windows locale trim, checking each against the updated dev baseline before editing. Then add summary indexing, harness/browser retirement, and auxiliary renderer splitting. Optional search-backend pruning is a separate improvement to the download.

For each change, compare the same packaged build/profile/workload on Windows x64 and Apple silicon. Use at least five minutes each of visible idle, minimized idle, and post-work idle, including multiple 60-second refresh cycles. Also exercise streaming, large dirty repositories, long histories, many tabs, search enabled/disabled, and sleep/wake. Record process-tree CPU deltas, resident/private memory, renderer/child-process counts, main-thread stalls, time to first usable window, and compressed/uncompressed package sizes. Include search daemons and probe subprocesses even if their executable names differ from Emma.

No implementation, rebuild, full repository check suite, controlled UI benchmark, signing test, or macOS runtime validation was performed as part of this audit.

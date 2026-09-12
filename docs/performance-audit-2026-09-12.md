# Performance audit — September 12, 2026

This time-bounded audit fixed **75 measured performance issues: 60 P1 and 15 P2**, covering conversation rendering, stored histories, agent execution, workspace tools, and discovery. Five audit workstreams used GPT-6 Astra subagents with high reasoning, rotated through the available concurrency slots; follow-up agents handled integration and evidence reviews.

Final validation: **1,412 desktop tests passed, two skipped**, with TypeScript, ESLint and the production build passing in wave 22. Rust formatting, workspace check, 68 tests and warnings-denied clippy passed; five benchmark fixtures remain explicitly ignored. The Zig harness suite passed after its last source change. The real isolated macOS app was exercised throughout. Changes remain uncommitted in the shared checkout.

The first-pass baseline is the existing uncommitted checkout saved before this task in `/tmp/shinbo-perf-baseline/source.tar`. The second pass uses `/tmp/shinbo-perf-round2/source.tar`, which already contains the original 36 fixes. The user subsequently removed the issue-count target and requested continued work until 5:00 a.m. EST or exhaustion of actionable findings. Existing work and later edits from another active task were preserved. These results do not attribute that other task's correctness changes to this performance audit.

P1 means high priority under the stated workload; P2 means useful but less urgent. Large-history fixtures deliberately stress supported workloads unless explicitly labeled synthetic or over-limit. Measurements are local benchmarks and operation counts, not promises that the entire application or model becomes faster by the same percentage. The reports linked below include exact fixtures, commands, regressions, and tradeoffs.

| # | Priority | Problem fixed | A → B measurement | What changes for the user |
| --- | --- | --- | --- | --- |
| 1 | P1 | Every token wakes every conversation subscriber | 20,020 → 1 callbacks for one burst of 1,000 deltas and 20 subscribers | Unrelated conversations stop competing with the active answer for renderer work. |
| 2 | P1 | Repetitive stream recovery uses quadratic overlap matching | 34,759.381 → 1.997 ms, median of five 400,001-character cases | Recovering a large repetitive answer avoids a tens-of-seconds freeze in this fixture. |
| 3 | P1 | Large code output creates an unbounded syntax-token tree | 120,000 → 1 spans for 380,000 characters | Large code stays readable and copyable without creating thousands of colored elements. |
| 4 | P1 | Streaming repeatedly disconnects and rebuilds transcript observers | 50,000 → 501 registrations; 100 → 0 unchanged scroll-state writes | Long conversations do less layout-related work while answers arrive. Integration review also restores correct pinning after content shrinks. |
| 5 | P2 | Composer inventories rebuild during every parent update | Supported 400-file folder: 80,000 → 800 command rows over 100 renders; one measured batch 25.279 → 0.647 ms | Typing and streaming stop rebuilding unchanged file/note menus. The original 10,000-file fixture exceeded normal discovery limits; the supported recheck shows a small per-render cost, so this is P2. |
| 6 | P1 | Completed message bodies render again while a new answer streams | 100 → 1 body evaluations for 100 unchanged-prop renders | Old messages stop repeatedly parsing and building their content. |
| 7 | P1 | Reading a cached thread copies messages and hidden traces | Ten reads: 12.878 → 0.075 ms; 66.4 MB payload copying removed per read | Opening a large saved conversation creates less temporary memory pressure. |
| 8 | P1 | Trace reads copy the entire unrelated conversation | Ten reads: 13.167 → 1.082 ms; 60 MB message copying removed per read | Inspecting agent activity avoids copying the transcript first. |
| 9 | P1 | Sidebar labels normalize entire large prompts | 1,000 summaries: 110.906 → 1.559 ms | Large thread libraries spend less time constructing short labels. |
| 10 | P1 | Compact refreshes evict the selected thread's parsed record | Five refreshes of a selected 66.4 MB thread: 438.818 → 0.154 ms | Sidebar refreshes reuse the active conversation instead of rereading it. |
| 11 | P1 | Every sidebar refresh parses the entire stored library | Warm real-host refresh of roughly 997 MB: 2,367.824 → 6.154 ms | Repeated library refreshes stop causing multi-second waits. This measurement isolates the compact-summary cache from earlier store fixes. |
| 12 | P1 | Host response envelopes clone the already-built payload | Ten 60 MB envelopes: 19.928 → 0.012 ms | Large replies avoid another full payload copy before transmission. |
| 13 | P2 | Annual cron booking repeatedly reparses fields | Five bookings: 159.245 → 0.067 ms | Saving or advancing rare schedules takes less synchronous work. |
| 14 | P2 | Scheduler polling reparses unchanged files | Twenty lists of 50 jobs: 62.264 → 5.192 ms | Idle scheduling and snapshot refreshes do less recurring disk and parser work. |
| 15 | P1 | Tokens and tool updates scan historical trace spans | 3,005,000 → 0 historical span reads in the stress fixture | Long agent runs no longer make each later update progressively more expensive. |
| 16 | P2 | Reading another thread fetches the whole library twice | 2 → 1 snapshot requests | Thread-reading tools and advisor calls avoid one redundant transfer. |
| 17 | P1 | Completed ACP calls retain 30-minute idle timers | 100 → 0 live timers after 100 completed calls | Long sessions retain less completed-request state. |
| 18 | P1 | Recovery repeatedly decodes every trace for every turn | 625 → 50 decodes for 25 recovered turns | Reopening a long agent session performs 92% fewer JSON decodes in this fixture. |
| 19 | P2 | Usage bursts rewrite their file once per event | 100 → 1 writes and atomic renames | Parallel activity produces less disk backlog; all uses remain recorded. |
| 20 | P1 | Abandoned ChatGPT requests keep consuming upstream output | 0 → 1 upstream abort after disconnect, during connection and streaming | Stopping a caller releases abandoned local/network work. Provider billing cancellation was not measured. |
| 21 | P1 | Git badges build patches they never display | 337.259 → 93.292 ms; 27 → 5 processes; 524,280 → 0 patch bytes | Sidebar, dashboard, and metadata-only phone requests do much less Git work. |
| 22 | P1 | Concurrent readers duplicate complete Git scans | Eight readers: 1,762.276 → 220.916 ms; 216 → 27 processes | Multiple open surfaces share the same pending repository scan. |
| 23 | P1 | Folder discovery blocks Electron's main thread | Event-loop timer delay: 171.390 → 0.446 ms for 24,000 oversized files | The app remains available while filesystem discovery proceeds. Total completion time increased slightly; see tradeoffs. |
| 24 | P2 | Full Git scans serialize independent commands | 389.454 → 270.117 ms with the same 27 commands | The full changes view finishes sooner by overlapping independent reads. |
| 25 | P2 | Rejected files and directories bypass the traversal budget | 24,000 → 15,946 metadata reads; now reports `capped` | Huge trees of oversized or unsupported files cannot expand traversal indefinitely. |
| 26 | P2 | Each mention rescans the same folder and notes | Eight mentions: 70.482 → 14.937 ms; each listing 8 → 1 | Sending a prompt with several file mentions avoids repeated discovery. Later prompts still refresh. |
| 27 | P2 | Terminal closure always waits the full kill grace period | 2,003.000 → 1.422 ms with a real child process | Shell closure completes when the shell exits, keeping forced termination for stuck children. |
| 28 | P2 | Git filtering reparses the patch on each edit | Seven edits: 25.529 → 7.287 ms; 7 → 1 parses | Filtering a large changeset reuses the parsed patch. |
| 29 | P1 | Selecting one skill validates every unrelated skill | Selection plus preview in 64 skills: 130 → 4 SKILL.md opens | Large imported skill libraries no longer delay one requested skill behind all the others. |
| 30 | P2 | Tool changes rewrite unchanged managed skill mirrors | 64 → 0 writes for 32 unchanged skills | Settings changes stop touching identical instruction and ownership files. |
| 31 | P2 | Forced model refresh bypasses pending discovery reuse | Two simultaneous forced refreshes: 2 → 1 resolver calls | Overlapping refreshes share discovery; a later refresh remains fresh. |
| 32 | P1 | Provider setup serializes two independent network probes | Requests started before model-list completion: 1 → 2 | A slow model list no longer delays starting the tool-support probe. Total requests remain two. |
| 33 | P2 | Catalog refresh writes files synchronously on the main thread | Two refreshes: 2 → 0 synchronous writes, replaced with two async writes | Catalog file writes yield to other main-process work. This check establishes asynchronous I/O, not a measured user-visible stall; serialization still has a cost. |
| 34 | P1 | Search disable and disconnect leave work running; quit blocks | Workers stopped 0/4 → 4/4; embedding aborts 0 → 1; synchronous shutdown waits 1 → 0 | Turning search off stops indexing work and releases abandoned embedding requests. |
| 35 | P2 | Startup recursively deletes old search installations synchronously | 1 → 0 synchronous recursive deletions in the constructor | The window can start while cleanup continues; installation still waits for cleanup ordering. The fixture does not establish a measured startup stall. |
| 36 | P1 | Freshly parsed context settings defeat ledger memoization on every render | Supported 1,024-message conversation, 100 renders: 1,657.465 → 20.801 ms; 300 → 3 parses; 100 → 1 ledger builds | Typing and streaming reuse unchanged context statistics instead of repeatedly parsing 5,000 stored ledgers and aggregating the selected 1,024-message conversation. Synchronous persistence and external-change detection remain. |
| 37 | P1 | Persistence rebuilds unchanged text one character at a time | Supported 59.1 MB history: cold decode 171.882 → 58.767 ms; complete atomic save 151.272 → 77.537 ms | Long conversations reopen and persist sooner; this is one codec fix covering read and write paths, with the same file format and validation. |
| 38 | P1 | Transcript markers reparse every full prompt on streaming updates and hover | 20 renders of 1,024 messages: 10,240 → 512 prompt parses; 2,041.333 → 171.787 ms | Navigation previews reuse unchanged text while typing or streaming; keyboard navigation and complete preview strings remain. |
| 39 | P1 | Completed tool rows inside the active turn rescan large outputs every update | 128 tools × 20 updates: 2,560 → 128 output inspections; 1,321.979 → 68.849 ms | Tool-heavy live turns stop rebuilding unchanged rows; replacement status and output events still update cards. |
| 40 | P1 | Git collects huge patches before applying its display budget | 20 generated files: 92,003,020 → 2,097,156 callback output bytes; 20 → 4 peak patch children; 407.4 → 115.4 ms | Opening Changes avoids collecting tens of megabytes that cannot be displayed; the fixture's 524,274-byte displayed prefix is identical. |
| 41 | P1 | Terminal output sends a cross-window update for every tiny chunk | Eight terminals × 1,000 chunks: 8,000 → 8 callbacks, preserving 512,000 bytes and absolute replay offsets | Fast build/log bursts create fewer IPC updates and renderer wakeups; output schedules a 16 ms flush or flushes at the byte limit; event-loop load can delay the timer. |
| 42 | P1 | A connected slow ChatGPT caller allows unlimited response queueing | Blocked-sink fixture: 1,000 → 2 upstream chunks produced; 1,229,014 → 3 bytes queued by the relay | A stalled caller backpressures provider consumption instead of accumulating the remaining answer in Electron memory; disconnect also releases drain waits. |
| 43 | P1 | Exact edit summaries allocate a quadratic line-comparison matrix and compute it twice | 4,000-line sparse edit: 287.42 → 1.42 ms; peak process RSS 479.05 → 133.42 MiB. Dense reordered fixture: 248.89 → 23.56 ms | Large tool edits produce exact counts and reconstructable hunks without a multi-gigabyte matrix; dense inputs retain a documented synchronous cost. |
| 44 | P1 | Timeline layout copies all earlier siblings for every span | 8,000 live siblings: 31,996,000 → 0 redundant reference copies; 52.560 → 8.770 ms | Busy agent timelines spend less time rebuilding their row layout on recurring updates; rendered row count is unchanged. |
| 45 | P1 | Markdown heading parsing catastrophically backtracks on internal whitespace | A heading with 1,000 interior spaces: 434.939 → 0.003792 ms; identical text | A valid padded heading no longer freezes the conversation parser; a supported 60,000-space fixture also completes. |
| 46 | P1 | Phone note and memory reads synchronously load whole files before truncating | 256 MiB note: 256 MiB → 256 KiB read/allocation bound; completion 26.155 → 0.268 ms; timer delay 26.202 → 1.436 ms | Large notes no longer block the desktop or allocate their full contents to return a small preview; valid UTF-8 prefixes and path checks remain. |
| 47 | P2 | Closing embedded browser sessions leaves their automation daemon running | Actual shutdown: 1 → 0 retained daemons; baseline retained 11,552 KiB RSS after host exit | Quitting releases the owned automation process while preserving a borrowed browser and its page. |
| 48 | P1 | Markdown table lookahead backtracks on padded non-table text | 12,026-byte fixture: 182.403 → 0.039708 ms; identical parsed blocks | Table-like model output no longer freezes ordinary conversation rendering. |
| 49 | P1 | Large image preparation decodes and resizes full bitmaps on Electron's main thread | 48 MP attachment: preview main-loop gap 237.85 → 5.46 ms; model gap 221.60 → 38.10 ms; file-preview gap 435.16 → 1.91 ms | macOS photo preparation leaves the app responsive. Model preparation total time rises 220.30 → 338.07 ms; the original, dimensions and JPEG quality policy remain. |
| 50 | P1 | Note inventories synchronously read every complete note on the main thread | 1,000 × ~33 KiB notes: largest timer gap 275.349 → 3.007 ms; identical metadata | Opening and refreshing a large knowledge base yields to window/input work. Total listing time rises 275.247 → 327.270 ms. |
| 51 | P1 | Unchanged timeline props still rebuild every row during parent renders | 8,001 spans × 20 renders: 480,140 → 24,007 duration formats; 1,557.17 → 46.08 ms | Typing and unrelated widget updates reuse an unchanged timeline; local span updates, selection and timers still work. |
| 52 | P1 | Offscreen timeline rows still require browser layout and paint work | Frozen production renderer, 8,002 rows, median three balanced trials: Time→Context 754.9 → 518.7 ms; Context→Time 615.4 → 301.8 ms | Native content visibility skips offscreen layout while preserving all rows and automatic detail heights. This extreme timeline still takes about half a second to switch to Context. |
| 53 | P1 | Historical Markdown pictures prepare previews before they approach the viewport | 100 mounted image messages: 100 → 0 requests at mount; 6 requests when six approach the viewport | Opening a photo-heavy conversation avoids decoding unseen images; previously loaded previews remain and unloaded paths stay keyboard/click accessible. |
| 54 | P1 | Structured thinking deltas repeatedly parse and serialize the entire earlier reasoning history | Actual Zig SSE sink, 4,096 deltas / 256 KiB, production allocator: 1,383.019 → 4.313 ms; identical 262,191-byte result | Long thinking turns spend much less processor time assembling provider output; model generation and network time are unchanged. |
| 55 | P1 | Completed offscreen runs retain all transient tool output for the renderer lifetime | 100 completions × 20 tool steps: 2,000 retained blocks / 32,768,000 output characters → 0 | Background and phone-started work releases full output after saved-history and cache confirmation. Failed saves retain data; foreign runs add an initial saved-message boundary read plus a completion read. |
| 56 | P1 | A stalled phone socket accumulates unlimited encrypted outbound frames | Accelerated 1,000-event fixture: peak queued bytes 65,632,471 → 4,135,216; retained backlog → 0 | A blocked peer is disconnected before its queue grows further; healthy peers keep every event, and reconnect restores live state and pending permissions. |
| 57 | P1 | Stop leaves web search active and permits further provider fallbacks | Active request abort false → true; post-Stop fallback requests 2 → 0 | Stopping a turn releases its search request and prevents abandoned follow-up requests. Normal provider failure fallback remains. |
| 58 | P1 | Selecting one timeline detail rebuilds every unchanged row | 8,002 rows × 20 detail toggles: 480,150 → 90 duration formats; component/reconciliation median 415.50 → 116.09 ms; native detail-click median 499.45 → 445.40 ms | Opening and closing tool details reuses all unaffected rows while preserving content, collapse controls and live updates. |
| 59 | P1 | Full live span trees are sent to auxiliary windows with no span subscriber | 20 updates × four windows: 80 → 20 sends; V8-serialized bytes 1,355,192,080 → 338,798,020 | Overlay, run-banner and cursor windows avoid copying tool histories they do not render; the workspace and mobile path keep their complete data. |
| 60 | P1 | Restoring concurrent runs requests the same complete live maps separately for every run | Eight runs: 16 → 2 full live-map IPC reads; V8-modeled serialized payload 135,653,128 → 16,956,641 bytes; clone/recovery median 61.426 → 16.734 ms | Opening a workspace with active runs restores their output with less repeated transport and decoding; later reconciliation takes a fresh snapshot. |
| 61 | P1 | Stop leaves foreground written-tool processes alive until their timeout | Five real-process pairs: owned processes at +200 ms 3 → 0; Stop-to-close median 1,247.839 → 3.430 ms with a shortened 1,500 ms test timeout | Stopping a custom tool releases its owned shell/worker tree promptly. Integration extends the same signal to secret-tool commands and their reader model; explicit background tasks keep their own lifecycle. |
| 62 | P1 | Foreign run updates create new empty state and rebuild an idle saved timeline | 40 broadcasts: 320,080 → 0 recreated row elements; component/reconciliation median 265.694 → 0.045 ms | A saved timeline stays idle while other threads stream. Actual live changes still update, and completed live state clears once. |
| 63 | P1 | Unchanged credential declarations remount widgets after unrelated component metadata changes | 64 widgets × 20 updates: module factories and startup fetch effects 1,344 → 64; unnecessary remounts 1,280 → 0 | Changing one widget's full-screen setting preserves the others' state and avoids restarting their data requests. Real declaration and module-version changes still reload. |
| 64 | P1 | Exporting one thread downloads every conversation history | 64-history actual-host fixture: 4,520.139 → 235.429 ms; 68,032,061 → 3,429,741 host bytes; event-loop gap 82.166 → 4.533 ms | Stats exports read the selected thread and its direct children, with identical CSV bytes, instead of stalling on unrelated histories. |
| 65 | P1 | Closing a dictation window leaves transcription work and recordings alive | Eight destroyed-window fixtures: active helpers / held one-MiB recordings 8 / 8 → 0 / 0; submissions after canceled conversion 1 → 0 | Closing Quick Ask releases its transcription resources. Canceled or unmounted conversion cannot submit or publish stale text; an already submitted request from a still-live window retains its existing lifecycle. |
| 66 | P1 | Four broad relational CSS selectors invalidate common elements across a large timeline | Three native 20-click pairs with other agent benchmarks stopped: median of trial medians 676.70 → 431.65 ms; unchanged row positions and total height | Tool detail clicks avoid unrelated sidebar and skill-rule work. Four CSS lines preserve existing controls; the extreme timeline still has material residual latency. |
| 67 | P1 | Agent thread listing, reading, messaging and ancestry checks fetch every full history | Three actual-host pairs: list 4,189.077 → 17.393 ms; read 4,391.485 → 83.151 ms; message 4,263.987 → 17.398 ms; list/message traffic 68,032,061 → 240,877 bytes | Agents coordinate threads and consult one thread's history without repeatedly copying the whole library. Exact text, message counts, ordering and bench ancestry restrictions are preserved. |
| 68 | P1 | Subscription spending totals download histories too old to affect either window | 64-history fixture with three recently active threads: 4,411.782 → 231.116 ms; 68,380,427 → 3,429,535 bytes; identical five-hour/week totals | Opening Subscriptions avoids copying old conversations. Recent turns in old threads, exact cutoff dates, future dates and backward clock changes remain covered; all-recent libraries still require their relevant histories. |
| 69 | P1 | Completed subagent relationships use nested full-list scans | 4,096 children, 20 renders: restored history 500.27 → 23.82 ms; retained agent records 2,563.06 → 22.56 ms; exact JSX preserved | Opening and updating threads with many completed subagents avoids repeated quadratic relationship work, even when Finished is closed. |
| 70 | P1 | Activity lineage repeatedly copies every earlier sibling before limiting the displayed rows | 16,000 children, 60 visible rows: 245.185 → 1.336 ms; 127,992,000 → 0 redundant sibling references; exact output | Large delegation histories stop freezing the activity list while it groups children. |
| 71 | P1 | Splitting one saved trace scans every span for each agent | 4,096 agent spans in a 593,589-byte trace: 400.618 → 22.090 ms; 16,777,216 → 4,096 ownership lookups; exact Turn results | Self improvement reads large delegated runs with less repeated parsing work while preserving attribution and normalization. |
| 72 | P1 | Rapid CLI Stop → retry → Stop reuses cancellation for the old process | Actual process test: retried process alive 250 ms after an accepted Stop, 1 → 0; POSIX descendant cleanup preserved | Stop reliably terminates the new CLI turn instead of leaving it running behind the interface. |
| 73 | P1 | Activity, Bench and Worktrees eagerly read hidden Self improvement histories | 64 histories: 64 → 0 trace requests; 297,758,784 → 0 response bytes; 512 → 0 trace parses while hidden | Opening unrelated Agent tabs avoids loading hundreds of megabytes of analysis data; Self improvement still loads the same results when selected. |
| 74 | P1 | Closed run evidence eagerly constructs every nested run and tool row | Native model-filter clicks: median 425.55 → 16.65 ms; closed local-fixture descendants 36,866 → 2; 4,103 total supported runs | Filtering Self improvement avoids hundreds of milliseconds spent rebuilding hidden evidence. First expansion still builds the complete tree and keeps it mounted afterward. |
| 75 | P1 | Expanded timeline stacks thousands of rows through an unnecessary outer grid | Two interleaved native 12-click pairs, 8,002 rows: median of trial medians 740.20 → 617.40 ms; identical closed and tall-detail geometry | Detail selection spends less time laying out the long expanded list. Individual row grids and the smaller timeline card remain unchanged; substantial latency remains. |

The second-pass changes use five Astra agents with high reasoning, rotated through the available concurrency slots. Their integrated desktop checks and additional real-app exercises are still in progress; the first-pass validation below is explicitly historical.

## Evidence and reproduction

- [Component metadata and preview lifecycle audit](performance-preview-lifecycle-audit.md)
- [Targeted stats export measurements](performance-wave11-exports.md)
- [Dictation resource lifecycle](performance-voice-lifecycle.md)
- [Native CSS selector isolation](performance-wave12-selectors.md)
- [Targeted agent thread reads and independent review](performance-agent-thread-library.md)
- [Subscription spending history selection](performance-model-plan-history.md)
- [Spending selection independent review](performance-model-plan-history-review.md)
- [Subagent relationship indexing and renderer sweep](performance-final-subagent-roots.md)
- [Activity lineage grouping](performance-final-lineage.md)
- [Saved trace ownership grouping](performance-final-turn-groups.md)
- [CLI Stop/retry ownership](performance-cli-stop-retry.md)
- [Deferred hidden-tab trace loading](performance-final-turn-loading.md)
- [Deferred closed evidence construction](performance-final-turn-evidence.md)
- [Native evidence interaction samples](performance-native-evidence-samples.json)
- [Targeted cache ownership review](performance-targeted-cache-review.md)
- [Report integrity and supported-workload rechecks](performance-report-integrity-review.md)
- [CLI and hidden-loading independent review](performance-cli-loading-review.md)
- [Native trace-read counter snapshots](performance-native-trace-phases.json)
- [Final persistence bounds audit](performance-final-persistence-audit.md)
- [Targeted cache retention integration and bounded host sweep](performance-host-bounded-followup.md)
- [Independent review of component, spending and subagent changes](performance-review-63-68-69.md)
- [Independent review of voice and agent-read ownership](performance-review-65-67.md)
- [Renderer measurements and regressions](performance-agent-1.md)
- [Rust storage, summary cache, and transport measurements](performance-agent-2.md)
- [Agent runtime measurements and regressions](performance-agent-3.md)
- [Workspace measurements and runnable A/B script](performance-agent-4.md)
- [Discovery, catalogs, and search lifecycle measurements](performance-agent-5.md)
- [Final context-ledger fix and integration review](performance-integration-review.md)
- [Second-pass persistence codec](performance-round2-host.md)
- [Second-pass renderer work](performance-round2-renderer.md)
- [Second-pass Git and terminal output](performance-round2-workspace.md)
- [Second-pass relay backpressure](performance-round2-runtime.md)
- [Exact large-edit diff measurements](performance-round2-diff.md)
- [Timeline layout and heading parsing](performance-wave3-renderer.md)
- [Bounded phone note and memory reads](performance-wave3-workspace.md)
- [Browser daemon cleanup](performance-wave4-browser.md)
- [Markdown table lookahead](performance-markdown-followup.md)
- [Native image preparation](performance-wave3-runtime.md)
- [Asynchronous note listing](performance-wave5-notes.md)
- [Terminal auto-start audit with no speculative fix](performance-terminal-autostart-audit.md)
- [Timeline rendering and native containment](performance-timeline-render-audit.md)
- [Startup and idle audit with no speculative fix](performance-wave6-idle.md)
- [Historical Markdown image deferral](performance-markdown-image-audit.md)
- [Native structured reasoning accumulation](performance-harness-reasoning.md)
- [Completed offscreen run retention](performance-retained-runtime.md)
- [Bounded phone connection backlog](performance-wave7-bridge.md)
- [Web-search Stop cancellation](performance-cancel-runtime.md)
- [Timeline detail selection](performance-timeline-selection-audit.md)
- [Live-span window fanout](performance-wave8-fanout.md)
- [Concurrent run rehydration](performance-wave9-rehydrate.md)
- [Foreground written-tool cancellation](performance-wave10-written-tool.md)
- [Idle timeline subscription](performance-timeline-subscription-audit.md)
- [Expanded timeline block layout](performance-final-timeline-block.md)

The before/after archive and raw logs remain in `/tmp/shinbo-perf-baseline` and the per-agent `/tmp` paths documented in those reports. The repository test sources and benchmark scripts can rerun the fixed checks; reproducing the exact original uncommitted baseline also requires retaining that archive. Changes remain uncommitted in the shared checkout.

## Tradeoffs and limits

- Code blocks over 32,768 characters retain their complete text but skip syntax coloring.
- Run notifications are batched over a scheduled 16 ms interval. Run state itself updates synchronously; background timer throttling can delay rendering further.
- Folder discovery's measured total duration increased from 171.444 to 191.066 ms while its event-loop blocking disappeared. Its 16,000-entry budget can omit later entries and explicitly marks the listing as capped.
- Parsed-record and compact-summary caches exchange bounded or compact retained memory for less repeated parsing. Metadata is checked for external changes. The large-library test does not establish a reliable cold-start speedup or measured RSS reduction.
- Early workspace rows 21–24 compare module variants containing several changes. Their operation counts identify distinct mechanisms, but their elapsed savings are combined outcomes and must not be added as isolated marginal speedups.
- Before the first expansion, browser Find cannot locate deferred run-evidence contents. Expanding Run evidence mounts them; closing afterward preserves nested disclosure state and the full tree.
- These fixes reduce application overhead. They do not establish faster model generation, provider billing savings, or a single overall application speedup.

## Validation

First-pass required checks passed:

- `npm --prefix desktop run check`: 1,200 tests passed, two skipped; renderer TypeScript, ESLint, and production renderer build passed. Vite still reports large-chunk and ineffective-dynamic-import warnings.
- `cargo fmt --all -- --check`, `cargo check --workspace --locked --all-targets`, `cargo test --workspace --locked`, and `cargo clippy --workspace --locked --all-targets -- -D warnings`: passed. The final Rust run passed 56 tests and left four explicit measurement fixtures ignored.
- `(cd harness && zig build test)`: passed. The initial sandbox attempt could not access Zig's standard library/cache; the authorized rerun completed successfully.

The final desktop log is `/tmp/shinbo-perf-baseline/final-desktop-check-3.log`. Its normal fixed-only context-ledger run independently reproduced three parses, one build, and a 35.518 ms median. That historical run used an over-limit synthetic conversation. Row 36 now uses the later supported-size paired rerun: 1,024 messages, assistant-only generation metadata, and 1,657.465 → 20.801 ms across 100 renders.

The coordinator exercised the isolated Electron app at `127.0.0.1:5176` using disposable profiles and fixtures: a 100-message saved conversation, editable composer text, message navigation, a large plain code block, connecting a 200-file Git folder, opening its changes view, filtering to `fixture-019`, and closing a real shell. The native interface confirmed that no shell remained after closure. No model request was needed for these checks.

The final renderer was reloaded and the scroll regression was exercised in two separate threads: expand a long thought, scroll upward until the jump-to-latest button appears, collapse the thought until the content fits, and confirm that the button disappears. Re-expanding followed the bottom again. Switching threads and repeating the shrink check also cleared the button.

Another task was editing the same checkout during validation. A temporary independent main-process build kept those rebuilds from removing the validation app's entry point. A normal reload cleared development-only hot-reload errors before interaction checks. Benchmark results use the sources and fixtures identified in each report, rather than silently treating concurrent correctness edits as performance fixes.

Unverified: real-provider live streaming end to end, VoiceOver interaction, global shortcut behavior, OS privacy permissions, alternate display geometries, signed packaging, and native non-macOS execution. Unit coverage of Windows paths is not a Windows application test.

## Continued audit validation log

After the second-pass codec change, the complete Rust formatting, workspace check, workspace tests, and clippy commands passed. This run passed 59 tests and ignored five explicit benchmark fixtures. The Zig test command also passed; its log is `/tmp/shinbo-perf-round2/zig-test.log`.

The isolated Electron app loaded a new 100-message fixture containing 50 multiline prompts of approximately 35 KB. The coordinator clicked the first message marker, used Tab to focus the next marker, visually confirmed its preview, and activated it with Return. A real terminal printed 1,000 numbered lines; the screenshot showed `PERF_BATCH_0999` followed by the returned shell prompt. These are interaction checks, not measured frame-time improvements. Later validation checkpoints below supersede this intermediate status.

The next desktop checkpoint exposed four stale integration fixtures after the bounded note-read change and concurrent preference/atomic-save changes. Updated fixtures now preserve their boundary assertions and pass all 27 focused tests. Full validation for those later changes is recorded in subsequent checkpoints below. Real-app checks additionally exercised a synthetic 32-tool active turn, its final status replacement, an exact 4,000-line edit summary showing +2/-2, and a 60,000-space heading rendering as “Verified heading.” These local fixtures made no provider request.

The wave-four integrated desktop checkpoint passed: 1,272 tests, two skipped, renderer TypeScript, ESLint, and production renderer build. Log: `/tmp/shinbo-perf-round2/desktop-check-wave4.log`. This checkpoint includes image attachment handling and the Markdown delimiter fix, but predates subsequent note and timeline work. The rebuilt isolated app also attached the no-Retina-sibling 48 MP fixture through the real native picker and displayed its thumbnail. A saved 948,780-byte trace containing 8,001 spans rendered with its 8,000 tool calls and time/context controls.

The wave-seven desktop checkpoint passed 1,299 tests with two skips, renderer TypeScript, ESLint and the production renderer build (`/tmp/shinbo-perf-round2/desktop-check-wave7.log`). It includes image cancellation/retry safety, source-version and atomic cache publication checks, a shared native-conversion queue with 100→1 measured decoder concurrency, and historical image viewport deferral. The frozen production UI also loaded the 1,000-note fixture through its native folder picker and displayed all 1,000 saves. Timeline UI validation reached Tool 7999, opened its variable-height details, moved keyboard focus to the close control and activated it, closed the dialog, collapsed/expanded Overall, and showed the correct 8.1k-token Context axis. VoiceOver itself remains untested.

The fresh wave-seven Rust checkpoint passed all four required formatting/check/test/clippy commands with 67 tests passing and five benchmark fixtures ignored (`/tmp/shinbo-perf-round2/rust-check-wave7.log`). The complete Zig harness suite also passed after the structured-reasoning fix (`/tmp/shinbo-reasoning-zig-test-unrestricted.txt`); the authorized unrestricted run resolved sandbox-only socket/cache failures. The frozen production app opened 100 historical local-photo messages with one image loaded and 99 paths deferred, then loaded images during navigation and opened a full-size preview. Subsequent checkpoints below cover the later audit changes.

The wave-ten desktop checkpoint passed all checks: 1,316 tests passed, two skipped, renderer TypeScript, ESLint and production build (`/tmp/shinbo-perf-round2/desktop-check-wave10.log`). This includes offscreen run settlement, the blocked-phone queue budget, web-search cancellation, timeline detail reuse, and the 100 ms cancellable image viewport dwell added after the native navigation test exposed a 15.7-second destination-preview queue. The preceding wave-nine checkpoint ran while new cancellation tests were being added against their pre-fix source and is superseded by this green run.

The wave-thirteen full desktop check passed 1,356 tests with two skips, TypeScript, ESLint and production build (`/tmp/shinbo-perf-round2/desktop-check-wave13.log`). It includes the saved-message boundary/retry safeguards, coalesced live recovery, foreground and secret-tool cancellation, Windows exited-PID guards, and idle timeline subscription fix. Fresh Rust formatting/check/test/clippy commands also passed again with 67 tests and five benchmark fixtures ignored. The rebuilt real app stopped the disposable written tool through its normal permission and Stop UI: three owned processes before Stop, zero afterward. The earlier 32 KiB background answer and its tool rows also survived a production-app restart.

The wave-seventeen full desktop check passed 1,393 tests with two skips, TypeScript, ESLint, and production build (`/tmp/shinbo-perf-round2/desktop-check-wave17.log`). It covers fixes 63–69; a subsequent Rust cache-retention integration correction is documented with fix 68 and has its own required Rust checks. Native checks confirmed component-local state survives unrelated metadata updates, all ten statistics CSV exports are written, compiled selector appearance and keyboard-focus behavior remain correct, and the actual agent can list and selectively read stored threads. A valid silent-audio request through the real Quick Ask IPC was aborted when the overlay returned to the workspace; normal held requests still completed. No microphone or external model was used.

The wave-eighteen full desktop check passed 1,408 tests with two skips, TypeScript, ESLint and production build (`/tmp/shinbo-perf-round2/desktop-check-wave18-unrestricted.log`). Its first sandboxed attempt could not bind localhost and was interrupted; the authorized loopback-capable rerun is the valid result. The wave-nineteen check then passed 1,411 tests with two skips and all the same checks (`/tmp/shinbo-perf-round2/desktop-check-wave19.log`), including the late CLI completion ownership guard and deferred evidence JSX. The corrected Rust host was also rebuilt successfully for the subsequent native checks.

The final wave-twenty desktop check passed **1,412 tests, with two skips**, plus TypeScript, ESLint and the production renderer build (`/tmp/shinbo-perf-round2/desktop-check-wave20.log`). The final targeted-cache Rust suite passed **68 tests, with five explicit benchmark fixtures ignored**; formatting, workspace check and warnings-denied clippy also passed (`/tmp/shinbo-perf-targeted-cache/{fmt,check,test,clippy}.log`). The complete Zig harness suite remains green after its last source change; no later harness edits were introduced by this audit.

The final checked app confirmed deferred evidence mounts on keyboard expansion and preserves the same open nested disclosures when its parent closes/reopens. The normal CLI tool permission flow launched only a disposable local executable; Stop, retry and Stop again terminated both distinct owned processes. Leaving Self improvement and returning showed a fresh zero-turn loading state with Analyze disabled until the new collection completed. These checks used disposable data and loopback providers.

## Remaining scaling costs

The deadline does not mean every possible bottleneck has been eliminated. The latest 8,002-row expanded-timeline experiment still takes approximately 617 ms for native detail selection after removing its outer grid (740 → 617 ms within that experiment). Its conditions differ from earlier CSS measurements, so these improvements are not combined. It retains its complete DOM and would need a separately validated rendering/windowing change for further large-history gains. The exact dense 30,000-line diff still takes roughly 376 ms in its synthetic measurement; replacing it requires preserving the existing exact edit-count contract. A subscription library where every history is recent still needs all selected histories and measured approximately 4.47 seconds end to end, while remaining asynchronous. First opening Run evidence still builds its full tree, and later closes retain that tree to preserve nested disclosure state.

These are recorded limits, not additional fixed issues. The report does not claim field INP, native Windows validation, real-provider generation speed, model billing savings, signed-release validation, or complete exhaustion of every future optimization.

## Deadline and final cleanup

Work continued to the requested 5:00 a.m. fixed EST cutoff on September 12 (10:00 UTC; 6:00 a.m. New York daylight time), using the previously stated interpretation. This ended the time-bounded audit rather than establishing exhaustion of every possible optimization. The continuation added 39 fixes beyond the original 36.

Wave 21 encountered a 254 ms harness initialization timeout while the large native timeline fixture was open. After the disposable Electron app and loopback CLI fixture server exited cleanly, the complete wave-22 desktop check passed with 1,412 tests and two skips, TypeScript, ESLint and the production build. Its log is `/tmp/shinbo-perf-round2/desktop-check-wave22.log`. The timing failure is recorded; its cause was not established. Build warnings about existing large chunks and ineffective dynamic imports remain.

The final Self improvement reload completed with all 4,104 fixture turns. The last timeline CSS change was exercised through the real renderer CSSOM, with identical closed/open-detail geometry and visible navigation to Tool 7999, then included in the passing production build. Its rebuilt bundle was not separately relaunched after that final check. All owned test-app and local-server sessions were stopped; other user applications were left running. The ledger contains 75 continuous entries, its report links resolve, and `git diff --check` passes.

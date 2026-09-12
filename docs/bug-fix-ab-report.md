# User-facing bug fixes: A/B results and impact

Completed repairs: **51 high-priority P1 bugs and 17 medium-priority P2 bugs**, 68 distinct roots in total. Five investigators used `gpt-6-astra` with `high` reasoning in batches of up to three concurrent workers. Corrections to an existing repair are included under its original root, not counted again.

The user removed the original numerical target, set a 5:00 a.m. Eastern cutoff, then resumed at 9:29 a.m. and requested that the current fixes be finished and reported. This document reports the verified result; it does not claim uninterrupted execution through that interval. Changes are in the local workspace. Nothing was committed, merged, released or published.

P1 means high priority: lost work, unintended model work, incorrect access/routing, or a core workflow failure. P2 means medium priority: a narrower reliability or usability defect. No P0 incident is claimed.

## Measurement

A uses preserved pre-fix source; B runs the same reproduction after the repair. First-wave probes use the task-start snapshot; later evidence reports identify their immediate pre-fix checkpoint. The initial snapshot includes the user's pre-existing changes. The separate performance task was kept separate as requested, and its changes were preserved.

These numbers measure controlled regression scenarios, not a population-wide failure rate or guaranteed production speedup. Local mock providers and synthetic files supplied the failures. Actual model cost reductions are not claimed.

## High-priority repairs

| ID | Priority | User trigger | A: before | B: after | Measurement and check | User impact |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | P1 | Open a task whose native settings differ from the desktop cache | One unsolicited write replaces folder, mode and review | Zero writes; native settings retained | Production mount/IPC regressions; live app retained Ask/review on after conflicting cache was seeded | Opening a task preserves its permissions and working folder |
| R2 | P1 | Send during the previous turn's refresh | Second prompt submitted twice | Submitted once; third follows once | Deferred-refresh production queue regression | Avoids duplicate work and corrupted queue state |
| R3 | P1 | Two queued sends fail | Zero complete retryable turns; one text-only draft | Two complete retryable turns with original context | Production queue failure/retry regression | Failed sends retain user text, images and skill context |
| R4 | P1 | Cancel microphone startup before permission resolves | One live track remains; repeated activation starts two acquisitions | Zero live tracks; one acquisition | Production hook regressions; live synthetic media: one acquisition, one stop, zero surviving tracks | Canceled dictation no longer starts recording later |
| I2-01 | P1 | Agent sends a correction to a running worker | Both advertised steering forms fail | Both deliver; stopped/unrelated replay targets reject | Actual runtime tool calls and routing regression | Workers receive corrections while running |
| I2-02 | P1 | Agent tool stops another active task | Zero native cancellations | Parent and child both receive cancellation | Runtime callback and fake harness regression | Stop reaches running provider/tool work |
| I2-03 | P1 | Child invokes an app-owned tool | Ended child executes under parent identity | Live child uses its own identity; invalid/stopped children reject | Desktop RPC regressions and native child metadata tests | Child tools respect task ownership and cancellation |
| I2-04 | P1 | Stop while a prompt-submission hook awaits | One model prompt sent afterward | Zero model prompts afterward | Actual Harness with deferred lifecycle/fake ACP peer | Prevents new model work after Stop |
| I2-05 | P1 | Select fallback after a paid model | Previous explicit model remains selected | ACP resets to its configured free default | Real native ACP process; exit 0 | Fallback no longer silently retains a paid selection |
| I2-06 | P1 | Change provider/privacy settings during work | One stale client remains reusable | Old client replaced before subsequent work | Busy-client invalidation and new-route regression | Later turns use current privacy and routing settings |
| I2-07 | P1 | Two callers send to one task concurrently | Two model-run starts | One start; second safely rejected | Deferred-routing ownership and cleanup regression | Protects the running turn from concurrent replacement |
| I2-09 | P1 | Resume encounters a transient access failure | Saved session mapping replaced by empty session | Mapping retained; true missing-session recovery still works | Failure/retry regression and native classification tests | Preserves model conversation context across transient failures |
| I3-01 | P1 | Upgrade from the previous app identity | Old profile, keys, settings and sessions are not found | Existing legacy data selected when current data is absent; explicit/current populated roots win | Real isolated Electron: readable credentials/providers 0/0 → 1/1, ciphertext unchanged; desktop and Rust root matrices | Upgrades preserve access to existing work and provider setup |
| I3-02 | P1 | Open old-format saved conversations and jobs | 0 of 2 readable | 2 of 2 readable | Actual host with legacy fixtures | Existing history and automations remain readable |
| I3-03 | P1 | One saved file contains invalid UTF-8 | Entire snapshot fails | Healthy records remain accessible with a warning | Both stores tested through actual host | One damaged file no longer takes down the library |
| I3-05 | P1 | Continue a conversation at persistence capacity | Work can start although the result cannot be saved | Capacity preflight rejects before routing/model work | Host boundary regressions; main-process integration under verification | Prevents unsavable paid work; keeps existing history intact |
| I3-06 | P1 | Prompt or answer contains control characters | Zero turn messages saved | Both messages saved with escaped controls | Actual host prompt/response fixtures | Terminal-related answers remain in conversation history |
| I3-07 | P1 | Cron restricts both day-of-month and weekday | Example next booking: February 1, 2027 | September 14, 2026 | Fixed September 12 fixture; standard cron OR semantics | Prevents months of silently missed automation runs |
| I3-11 | P1 | Scheduled run cannot save its task | Booking advances despite zero runs | Booking stays due; retry creates one run | Injected storage failure, retry and actual host scheduler tick | Failed launches remain eligible to run after storage recovers |
| I3-12 | P1 | Model sets another goal over an exhausted goal | 1,000-token allowance becomes 200,000 | Replacement rejected; exhausted allowance unchanged | Actual host budget fixture | Goal replacement cannot silently bypass the spending limit |
| V1 | P1 | File a screenshot note, then keep another with the same title | One previous image overwritten | Zero overwritten; distinct image files | Actual vault operations and byte comparison | Filing notes preserves their original screenshots |
| A1 | P1 | Upload a file after an earlier attachment is eight days old | Earlier held file deleted | File remains readable, including after reopening the store | Real temporary files and aged mtime | Conversation attachments survive beyond one week |
| B1 | P1 | Phone retries the same pending request ID | Two callbacks execute | One callback; callers share its result | Concurrent-request, cache-pressure and rejection/retry regressions | Avoids repeated messages and agent actions on reconnect |
| B2 | P1 | Regenerate QR while an old pairing socket is connected | Old socket still unlocks and dispatches; new peer saved unverified | Old socket closed; only new pairing dispatches and is saved verified | Real encrypted WebSocket reproduction plus address-lookup races | Replaced pairing sessions lose access as intended |
| H5-1 | P1 | Send an accepted 1.23 MB image or two such images | Request fails before any provider call | Each turn succeeds with one provider call | Identical real CLI probes; live 1,229,883-byte image submitted through real drop handler and vision fixture | Normal screenshots and photos reach vision models |
| H5-2 | P1 | Reasoning model continues after a tool call | JSON reasoning missing; only one of two streamed blocks retained | JSON fields retained; both streamed blocks retained | Strict two-request CLI probes and actual OpenRouter URL serialization tests | Tool workflows retain the reasoning/signatures required to continue |
| N1 | P1 | Two agents create or edit artifacts concurrently | Two creates leave one artifact; disjoint edits lose one change | Both artifacts and both edits survive; version advances to 3 | Actual store operations, including app side-file race | Parallel work no longer overwrites another result |
| N2 | P1 | Artifact format conversion fails while writing replacement | Original content is deleted | Original content remains readable and editable | Real EISDIR failure and subsequent successful edit | A failed conversion preserves the user's work |
| N3 | P1 | Generated app runs a non-terminating SQL computation | Main loop has zero heartbeats and requires process termination | Query rejects after about 2 seconds; main loop remains responsive | A isolated hang probe; B 19 heartbeats in 2.06 seconds, rollback/integrity/cleanup checks | A bad artifact query cannot freeze the desktop or leave a partial database write |
| T1 | P1 | Saving tighter task permissions encounters a disk error | Save reports success; restart restores old permissions | Save reports error; memory and disk retain the last successful value | Injected ENOSPC at actual persistence boundary | Users can tell when permission changes did not save |
| T2 | P1 | Stop a multi-step workflow or running script | Later nodes still execute; script ignores Stop | No later nodes; running script is canceled | Real script regressions; live Stop canceled step one and prevented step two | Stop stops the whole workflow |
| T3 | P1 | A workflow script exits with an error | Downstream node and completion trigger still run | Both skipped; script error is visible | Real exit-7 script, zero downstream starts on B | Failed prerequisites cannot masquerade as successful work |
| T4 | P1 | A scheduled job becomes due during startup | One turn starts with fallback before saved settings load | Zero starts before readiness; one with restored provider afterward | Deferred settings, failure and recovery regressions | Automations use saved model, prompt and privacy settings |
| T5 | P1 | Run a task pinned to a deleted provider | One fallback harness turn starts | Zero; explicit unavailable-provider error | Production routing/start-count regression | Task content stays within the user's selected provider intent |
| G1 | P1 | Discard a filename containing brackets | One unselected matching file also deleted | Zero unselected files lost | Real Git operation and byte comparison | Discard affects only selected files |
| G2 | P1 | Worktree destination collides with an unrelated folder | Unrelated folder accepted as the worktree | Rejected; unrelated contents untouched | Real Git repositories and destination collision | Agent work starts in the intended repository |
| PL1 | P1 | Updating an authored plugin encounters a write failure | Original instructions deleted | Original retained with identical bytes | Injected ENOSPC, rename failure, successful retry | Failed plugin updates preserve existing instructions |
| D1 | P1 | Browser storage fills while saving a task draft | Other tasks' saved unsent drafts deleted | Existing drafts preserved; current unsaved text retained with a warning | Production storage functions with quota failure and retry | Storage pressure does not erase unrelated unsent work |
| R4-C1 | P1 | Stop/close council or stop advisor/vision work | Pending requests keep running; delayed history can start new requests | Pending requests aborted; zero starts after Stop | Per-task cancellation, delayed context and two-seat regressions | Stop reaches secondary model work without affecting another task |
| R4-C2 | P1 | Saving a council answer fails | UI reports done; retry unavailable | Existing answer stays retryable; one successful save without new model calls | Failed/pending/concurrent manual and automatic adoption checks | Paid answers survive temporary storage failures |
| H3-1 | P1 | Reopen a saved session after Fresh context | Explicit handoff missing from next provider request | Handoff retained; replacement survives a second restart | Actual ACP process restarts with unique handoff markers | Completed-work notes and next steps survive context rollover and restart |
| S1 | P1 | Several tasks update shared memory concurrently | 12 successes retain only 1 change | All 12 retained | Actual memory operations with concurrent independent replacements | Remembered decisions survive parallel task updates |
| S2 | P1 | Memory edit or Revert fails after a partial write | Originals truncated to 4 bytes | Original 40/40 and 60/60 bytes retained | Real partial writes with injected ENOSPC; symlink/mode checks | A failed save or Revert preserves the original file |
| S4 | P1 | User edits a note while automatic tagging is pending | New title and structured metadata both lost | Both retained; edited file byte-identical | Deferred tagger and real note files | Automatic organization respects newer user edits |
| M3 | P1 | Change model/settings while a goal or reviewer is running | Three automatic starts use the old provider and overwrite the choice | Zero old-provider starts; all three use the current choice | Actual extracted run/goal/review functions; 109 related tests | Follow-up work respects the model and cost choice the user just made |
| H6-1 | P1 | CLI tracked overwrite cannot back up a file, or Undo restore fails | Large original deleted by Undo; failed restore consumes the backup | Unsafe overwrite rejected; failed restore remains retryable | Two identical real PTY fixtures: originals preserved/recovered 0/2 → 2/2 | CLI Undo protects recoverable file contents |
| R6-G1 | P1 | Resume a blocked goal whose tokens or turns are exhausted | One extra model turn starts without an extension | Zero starts; Continue requires added allowance | Host limits plus actual extracted Resume path | Resuming cannot silently bypass the goal allowance |
| R6-G2 | P1 | A goal turn uses multiple model steps | Only 5,600 of 35,600 used tokens remain in durable ledger | All 35,600 retained | Actual usage callback/record path and host restart fixture | Later turns and restarts retain the full measured spend |
| S7-A | P1 | Attachment index cannot be saved | Save reports success, but the attachment fails after reopening | Error returned; existing index retained | Three matched attachment/highlight A cases, 33 affected B tests | A successful upload no longer conceals a broken saved attachment |
| R7-2 | P1 | Session-index write fails after a partial write | 0/12 previous mappings readable; one new model prompt starts | 12/12 retained; zero model prompts start; retry saves the thirteenth | Actual partial-write fault and reconstruction | Conversation context survives failed index saves |
| R7-3 | P1 | Use an explicit alternate sign-in home | Default personal account used instead of selected work account | Configured account selected | Two synthetic account profiles, correct selection 0/1 → 1/1 | ChatGPT routing respects the chosen account profile |


## Medium-priority repairs

R7 (P2): deselecting the only weekday previously changed one run per week into seven. It now retains the original weekday. The regression passes, and the real app retained Monday and `0 9 * * 1` after clicking the final selected day. This repair is excluded from the high-priority count.

G3 (P2): Git status and selected commits now preserve filenames containing spaces, quotes, newlines or ` -> `. NUL-delimited Git output replaces ambiguous line parsing. Actual unusual filenames and staged rename origins survive exactly; this is separate from G1’s unselected-file loss.

Interaction T1 (P2): an abandoned terminal lookup previously started one hidden shell; it now starts zero, and the remounted pane starts exactly one.

R4-N1 (P2): a delayed automatic title previously replaced a manual rename; an atomic conditional host rename now preserves the user’s chosen title.

S3 (P2): a note with the maximum accepted 262,144-byte body previously failed to reopen because its metadata exceeded the read guard. The bounded serialized-file allowance now reopens all 262,229 bytes of the fixture.

H3-2 (P2): auxiliary vision and compaction now reject incomplete or failed provider completions. Four invalid responses previously accepted are now all rejected, preserving the original context in all four fixtures.

I3-04 (P2): the host request envelope now accepts a trace at its documented size limit. The fixture previously stored zero trace bytes; it now stores all 1,048,575 bytes.

I3-08 (P2): numeric cron steps now retain their starting offset. A `5/10` fixture next runs at 05:35 instead of incorrectly waiting until 06:05.

I3-09 (P2): valid sparse schedules now search the full bounded Gregorian cycle. Leap-day and leap-Sunday fixtures find their correct next dates, including 2096 → 2104 and 2088 → 2128. The impossible-date precheck measured median 0.916 ms before and 0.069 ms after in the recorded host fixture.

I3-10 (P2): supported surrounding whitespace in stored `on` and `after` schedules is normalized on read. Both due-job fixtures now run (0/2 → 2/2), including legacy records.

M1 / I2-08 (P2): changing from a known context limit to an unknown one sends a reset instead of retaining the previous model's limit. Two prompts now send 200000 then 0.

M2 / I2-10 (P2): failed app tools retain failure status through the native bridge. A real ACP fixture now emits one failed tool update and carries the exact diagnostic into the next model request.

S7-N (P2): quoting a near-limit highlight previously silently removed its final words. Formatted overflow now reports an error before creating a note; a shorter retry preserves the complete ending.

R6-G3 (P2): ordinary chat after completing a goal no longer changes that goal's historical spend. The fixture stays at 100 tokens instead of rising to 600; its actual final settling turn still counts.

R7-1 (P2): failed credential replacement/removal cannot be silently committed by a later unrelated save. Original fake account keys are retained in 2/2 scenarios instead of 0/2, including after reopening.

R7-4 (P2): Clear context now updates the durable index before a harness starts and marks the UI cleared only after success. Desktop and phone fixtures remove the correct mapping in 2/2 cases. Clearing during a turn also preserves Stop/Steer delivery, 0/0 → 1/1, as part of the same lifecycle repair.

R8-1 (P2): abrupt EOF during a buffered ChatGPT response now returns HTTP 502 instead of manufacturing HTTP 200 with a successful finish. Explicit completed and length-limited controls still work. This prevents a partial auxiliary answer from passing the completion guard.

## Final verification

- Full desktop check: **1,412 passed, 2 skipped**, plus type checking, lint and production renderer build. This includes tests belonging to concurrent work; the total is not the number of tests authored by this audit.
- Rust: **68 passed, 5 existing benchmarks ignored**. Formatting, locked all-target checking and strict Clippy passed.
- Full Zig harness suite passed after its five old vision fixtures were corrected to supply an explicit successful completion marker. The production incomplete-response guard remains intact; fixture corrections add no bug count.
- The sibling website's complete check passed, including 20 prerendered routes. Fifteen unrelated existing lint warnings remain. Docs cover provider restoration, goal accounting/limits, workflow cancellation/failure and council save retry. No phone protocol shape changed.
- Independent integration review caught and corrected a new shared-accounting error before delivery: concurrent council plus harness usage now records 20,300 rather than 40,000 tokens. Council saves also refresh the live allowance guard. These complete R6-G2 and do not increase the count.

The real isolated macOS Electron app exercised task-context reopening, separate held failed submissions and retry, three queued messages completing once each, final-weekday selection, a 1,229,883-byte dropped image reaching the local vision provider, and microphone release before a synthetic permission result. The microphone fixture ended with one stopped track and zero surviving tracks; no real audio was captured.

Live workflow Stop prevented later nodes; a running script stopped; an exit-7 script displayed failure and started no downstream model work. Simulated draft quota failure preserved an unrelated draft byte-for-byte, retained the new unsaved draft across navigation, and cleared the warning after successful retry.

Live council Stop ended two pending seat requests with no later discussion calls. A second council made seven model calls, retained its answer after an actual permission-denied save, and landed that same answer on retry with zero additional provider requests. The isolated directory's write access was restored immediately afterward.

The real artifact SQL worker timed out a non-terminating synthetic query after **2,006 ms**; a separate snapshot IPC returned while it was running. A removed-provider task displayed its error, retained the unsent message and made zero fallback calls.

The final frozen build displayed a blocked goal with 1,000/1,000 tokens spent, zero left, and Continue with an explicit added allowance instead of Resume. Clear context before any harness started displayed Context cleared, removed the selected saved session, and retained the other mapping unchanged (two mappings → one).

## Limits and remaining work

Windows, VoiceOver, global shortcuts, real OS privacy dialogs, signing, display geometry and signed legacy Keychain ACL behavior remain unverified. Tests do not establish live paid-provider behavior across every provider. Goal stopping remains subject to request granularity; delegated child spend is still outside the parent's goal ledger, as documented.

The native file picker timed out. Automatic approval review rejected a picker screenshot because it could expose unrelated private filenames; it was dismissed, and the known synthetic image was tested through the real drop handler. The picker remains unverified. Two other investigation scopes, Windows app authorization and a harness text-range crash, stopped after automated safety failures and are excluded from the fixed count.

## Evidence

The initial tracked diff is `/private/tmp/shinbo-bug-audit/preexisting.patch`; the source snapshot is `/private/tmp/shinbo-bug-audit/source-before.tgz`. Final desktop and harness logs are `desktop-final.log` and `zig-final.log` in that directory. Successful Zig runs are silent. Per-wave reports contain the commands, immediate A snapshots, raw measurements and regression test names:

- [integration review](bug-audit-integration-review.md)
- [investigator 1](bug-audit-investigator-1.md)
- [investigator 2](bug-audit-investigator-2.md)
- [investigator 3](bug-audit-investigator-3.md)
- [investigator 4](bug-audit-investigator-4.md)
- [investigator 5](bug-audit-investigator-5.md)
- [round 2 native](bug-audit-round-2-native.md)
- [round 2 runtime](bug-audit-round-2-runtime.md)
- [round 3 desktop](bug-audit-round-3-desktop.md)
- [round 3 harness](bug-audit-round-3-harness.md)
- [round 4 council](bug-audit-round-4-council.md)
- [round 4 interactions](bug-audit-round-4-interactions.md)
- [round 5 scheduler](bug-audit-round-5-scheduler.md)
- [round 5 storage](bug-audit-round-5-storage.md)
- [round 6 harness](bug-audit-round-6-harness.md)
- [round 6 lifecycle](bug-audit-round-6-lifecycle.md)
- [round 6 models](bug-audit-round-6-models.md)
- [round 7 runtime](bug-audit-round-7-runtime.md)
- [round 7 storage](bug-audit-round-7-storage.md)
- [round 8 runtime](bug-audit-round-8-runtime.md)

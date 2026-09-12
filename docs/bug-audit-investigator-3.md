# Investigator 3: Rust durable data and host audit

The initial audit reviewed `crates/core`, `crates/host`, and their Electron callers without editing production sources. The subsequent implementation fixed seven P1 findings; measured results are below. Reproductions use compiled production hosts with synthetic, isolated data directories. Existing worktree changes, including concurrent performance work, were preserved.

Run the recorded baseline probes:

```sh
python3 /private/tmp/shinbo-bug-audit/investigator-3.py
python3 /private/tmp/shinbo-bug-audit/investigator-3-goal.py
python3 /private/tmp/shinbo-bug-audit/investigator-3-due.py
```

The last probe takes 31 seconds to exercise the actual scheduler tick. These scripts print observed metrics. The committed regressions now assert the seven repaired contracts. Dates below are actual results from September 12, 2026; the finding sections describe the original behavior, and the implementation section records the final results.

## I3-01 — P1: upgrading hides the prior data root

Trigger: run the renamed host without a data-directory override after using Emma. `crates/host/src/runtime.rs::default_data_root_from` changed the directory from `Emma` to `Shinbo`, and `configured_data_root_from` ignores the formerly supported `EMMA_DATA_DIR`. Git HEAD confirms both prior names. No migration or compatibility fallback exists.

Impact: all prior conversations and scheduled tasks disappear; scheduled tasks cease running. `Host.spawn` in `desktop/main/main.ts` passes the environment unchanged. Electron settings, credentials and capability state also need coordinated migration; changing only Rust's path is insufficient.

Baseline: an isolated home containing one healthy thread in `Library/Application Support/Emma` returns an empty snapshot with zero warnings under the new default. The fixture uses a current header to isolate directory discovery from I3-02.

Minimum fix: coordinate one startup data-root migration/selection across Electron and host, preserving both roots if they already contain data, and honor the old explicit environment override when the new one is absent. Do not overwrite a populated new root.

Regression/A-B: isolated old-root installation becomes one visible thread and the original scheduled job; verify both old and new roots populated, explicit new override, and old override. This requires Electron ownership coordination. Treat the root and environment compatibility as one finding.

## I3-02 — P1: prior-format records are rejected even in the correct directory

Trigger: open existing Emma thread/job Markdown in the active data root. `Thread::from_markdown` in `crates/core/src/thread.rs` requires `shinbo-thread-format`; `ScheduledJob::from_markdown` in `crates/core/src/scheduled.rs` requires `shinbo-scheduled-job-format`. HEAD writers emitted the `emma-` keys with the same numerical versions and contents.

Impact: copying/restoring the old data directory still leaves all conversations and automations unusable. This is independent of root discovery: the active root is explicitly configured in the probe.

Baseline: one legacy thread and one legacy job yield zero visible threads, zero jobs, and two malformed-record warnings.

Minimum fix: accept either legacy or current format key while continuing to write the current key; keep version validation. Do not global-replace user content.

Regression/A-B: round-trip representative legacy versions and current records, then verify both legacy fixtures list successfully with no warnings (0/2 readable before, 2/2 after).

## I3-03 — P1: one unreadable record disables the entire library

Trigger: a truncated/non-UTF-8 `.md` in either store (e.g. disk/sync/editor damage). `ThreadStore::parse_file` and `ScheduledJobStore::load` propagate `read_to_string` InvalidData as store-wide I/O failure; each `list` returns immediately on it. `Runtime::snapshot_with_thread_cache` requires both stores, and both host snapshot methods use it.

Impact: every healthy conversation becomes unavailable; malformed scheduled data additionally disables scheduling because `run_due_jobs` returns on list failure. This differs from invalid Markdown, which already yields a warning and preserves healthy records.

Baseline: one healthy thread plus a single byte `0xff` under either store produces `ok:false`, `stream did not contain valid UTF-8` for the whole snapshot.

Minimum fix: classify per-record decoding damage as malformed, retaining the existing warnings path. Consider transient per-entry disappearance consistently; keep actual root-directory failures visible.

Regression/A-B: both store cases change from failed snapshot/zero accessible healthy threads to successful snapshot/one healthy thread plus one warning; scheduled listing continues to return healthy jobs.

## I3-04 — P2: normal long-run traces exceed the host's smaller request limit

Trigger: a turn with sufficient tool inputs/outputs. `encodeSpans` in `desktop/shared/trace.ts` permits 1 MiB; `AgentRuntime` trace persistence in `desktop/main/agent-loop.ts` directly calls `recordTrace`; core permits 1 MiB, but `crates/host/src/main.rs::MAX_REQUEST_BYTES` is 128 KiB.

Impact: the full trace is dropped on persistence with only a console error. The activity detail is gone after reopening the task. Eight tool spans with roughly 16 KiB input/output each are enough; JSON escaping makes the effective ceiling lower.

Baseline: `recordTrace` of 150000 ASCII bytes returns `request is too large` and writes no trace.

Minimum fix: align the trusted host envelope bound with accepted trace size including JSON escaping, or explicitly bound encoded trace requests at the producer without discarding the whole trace. Preserve a finite bound.

Regression/A-B: use actual `encodeSpans` output with quotes, newlines and non-ASCII text; a representative 150 KB trace changes from zero stored traces to one readable trace. P2 because this is history/diagnostic detail, not the principal assistant answer.

## I3-05 — P1: long conversations incur work that can never be saved

Trigger: continuing a task with 1023/1024 messages. `Thread::push` caps messages at 1024. `Runtime::record_turn` appends a user message and answer only after the model has finished (`runOnHarness` in `desktop/main/main.ts`). No preflight or continuation handling checks this capacity before executing the next turn.

Impact: the model can perform paid work and filesystem changes, but the prompt and answer cannot be committed; retries on the same thread fail forever. With an additional notice the failing threshold can be 1022 messages. Existing history is preserved, but the newly completed turn is lost.

Baseline: synthetic valid 1023-message record; a short new prompt and answer returns `could not append response: thread cannot have more than 1024 messages`; persisted message count remains 1023.

Minimum fix: ensure a runnable turn can be persisted, using an explicit user-visible capacity/continuation path before model invocation or a durable representation that can append safely. Do not silently delete previous messages to fit.

Regression/A-B: exercise production turn preflight around 1022–1024 messages, including notices, proving no billed/model work starts when persistence capacity is unavailable; or demonstrate the complete new turn persists under the chosen continuation design.

## I3-06 — P1: terminal control characters make a completed answer unsavable

Trigger: model response or pasted prompt includes literal ANSI escape/control characters. `Runtime::record_turn` applies `validate_text` before persistence, rejecting ESC, NUL and other controls. `recordedTurn` forwards these unchanged. `runOnHarness` retries recording the same poisoned answer in its error branch, so recovery fails too.

Impact: a successful paid turn and its prompt disappear from durable history. The model is routinely asked to explain terminal output, so this is a reachable content case, not a malformed IPC envelope.

Baseline: response `Result: ESC[31mredESC[0m` gives `response contains a control character`; zero messages persist.

Minimum fix: normalize non-display control bytes in transcript content before trusted text validation, preserving normal Unicode/newlines and maintaining strict validation for identifiers/configuration. Keep the answer readable and do not drop the whole turn.

Regression/A-B: an ANSI-containing answer and an equivalent pasted prompt both persist two readable messages instead of zero. Include the error-recording path so recovery cannot repeat the same failure.

## I3-07 — P1: standard cron day restrictions skip months of expected runs

Trigger: raw cron specifying both day-of-month and day-of-week, e.g. `0 0 1 * 1` (the first of the month or Mondays). `schedule_matches` in `crates/core/src/scheduled.rs` unconditionally ANDs both fields, instead of cron's OR semantics when both day fields are restricted.

Impact: an accepted automation misses almost every intended occurrence without an error.

Baseline on Sep 12, 2026: the host books `2027-02-01T00:00:00Z`; expected next occurrence is Monday `2026-09-14T00:00:00Z`.

Minimum fix: implement the day-field wildcard/restriction rule while retaining minute/hour/month conjunction and Sunday aliases. Reuse the existing field matcher.

Regression/A-B: deterministic `ScheduledJob::new` at Sep 12 books Sep14 rather than Feb1; also test a wildcard day field so weekly/monthly UI schedules remain correct.

## I3-08 — P2: accepted numeric step cron runs only once an hour

Trigger: cron `5/10 * * * *`. `field_matches` interprets a numeric range as `(exact, exact)` even with a slash. A numeric step should continue from that start through the field maximum.

Impact: job runs at minute5 only, skipping minute15/25/35/45/55.

Baseline at 05:32:39 UTC: next run is 06:05 instead of 05:35.

Minimum fix: when a slash follows a numeric start, use `(start, max)`; retain exact-number matching without a slash.

Regression/A-B: deterministic time 05:32 gives 05:35; separately check plain `5` still gives 06:05.

## I3-09 — P2: valid leap-day yearly automations cannot be saved

Trigger: choose February29 yearly, or raw `0 0 29 2 *`, in a year more than one year before a leap day. `next_run` searches only 527040 minutes. `save_scheduled_job` requires this scan to succeed.

Impact: valid recurring yearly task cannot be created; an existing leap-day task also cannot claim its leap-day run because computing its next occurrence fails.

Baseline on Sep 12, 2026: `schedule has no occurrence in the next year` rather than a 2028 booking.

Minimum fix: search sufficiently far for leap-day recurrence without blocking the sole runtime on an expensive repeated parse; preserve rejection of impossible schedules. Prefer a bounded calendar search over a multi-million-allocation loop.

Regression/A-B: Feb29 schedule created in 2026 books 2028; claiming in 2028 books 2032; impossible Feb30 still rejects.

## I3-10 — P2: validated event/after trigger whitespace disables firing

Trigger: save `on  startup` or `after  <valid-job-id>`. `validate_schedule` trims the suffix for validation, but stores the original string; `Runtime::fire_trigger` requires exact equality with canonical `on startup` / `after <id>`.

Impact: task saves successfully and never responds to the event/dependency.

Baseline: stored schedule `on  startup`, firing `startup` returns zero jobs and emits zero due jobs.

Minimum fix: normalize these trigger strings when constructing the scheduled job, or compare their parsed forms. Handle trailing whitespace consistently.

Regression/A-B: repeated spaces and trailing spaces change from zero fired jobs to one; invalid suffixes still reject. Test both trigger types in the same small regression.

## I3-11 — P1: failed scheduled dispatch permanently consumes its due time

Trigger: a due automation when saving its run thread fails (disk/full directory/temporary permission issue). `Runtime::run_due_jobs` calls `claim_run` and saves the new `last_run_at`/`next_run_at` before `hand_out_run`; it ignores the latter error.

Impact: job records that it ran, advances to its next daily/monthly occurrence, and never retries the missed task despite performing no work. No error reaches the UI.

Baseline from actual scheduler tick: due `2020-01-01T00:00:00Z` became next `2026-09-12T05:34:00Z`, last-run `2026-09-12T05:33:49Z`; `last-thread-id` remains empty because the synthetic thread store is unusable.

Minimum fix: commit scheduling advancement only once durable run creation succeeds; leave the due booking intact on preparation failure and surface failures. Avoid introducing duplicate execution during normal retries.

Regression/A-B: inject one thread-save failure: before, due booking advances with zero runs; after, booking remains due. Restore storage and confirm exactly one thread/due event and advancement on retry.

## I3-12 — P1: resetting an unfinished goal grants a fresh larger budget

Trigger: the model calls `goal set` again after a small explicit budget is exhausted, omitting `tokenBudget`. `Thread::set_goal` constructs a new default-200000 active goal, copies spend/turns from an unfinished goal, but does not preserve its allowance or stopped status. `goalTool` in `desktop/main/main.ts` exposes this path to the model.

Impact: bypasses a user-imposed spending limit without the explicit extend operation. Keeping tokens used is insufficient if the ceiling silently increases. The 40-turn backstop remains, but the monetary allowance is still bypassed.

Baseline: 1000-token goal, 1200 tokens recorded => `budgetLimited`, allowance1000/spend1200. Repeating set without budget => `active`, allowance200000/spend1200, granting 198800 tokens.

Minimum fix: an unfinished goal must retain its existing budget and stop state, or reject replacement until explicitly completed/cleared; reserve added allowance for the existing extension path. Preserve valid creation and post-completion replacement.

Regression/A-B: repeating set cannot increase tokens remaining from zero or reactivate an exhausted goal; explicit extension still works. Probe available in `investigator-3-goal.py`.

## Priority and scope notes

Eight findings are marked P1; three scheduler input edge cases and trace persistence are P2. The P1 findings are: I3-01, I3-02, I3-03, I3-05, I3-06, I3-07, I3-11, I3-12. Priority should be reviewed against product expectations; do not count P2 findings toward a strict P0/P1 target. The two rebrand findings need different independently tested fixes but belong to one coordinated migration batch. Root investigator owns aggregate de-duplication.

The existing `large_snapshot` test missing-binary failure was not counted as a user bug. No claims are made about macOS UI, VoiceOver, Windows execution or production data migration verification; this pass exercised synthetic production host requests only.

## Implemented fixes and measured A/B results

Implemented I3-01, I3-02, I3-03, I3-05, I3-06, I3-07, I3-11 and I3-12. I3-01 was completed as one coordinated Electron profile/data compatibility fix after the seven Rust fixes. The four P2 findings were deferred during the initial P1 pass and are now fixed with fresh A/B evidence in [round 5](bug-audit-round-5-scheduler.md).

| Finding | A: reproduced original behavior | B: measured repaired behavior | User impact |
| --- | --- | --- | --- |
| I3-01 | Old default root and old override each load zero saved threads/jobs; Electron startup loses settings and sessions | Both Rust regressions pass across eight root scenarios; four Electron compatibility regressions change from failure to success; real Electron restores synthetic credential/provider | Existing installations reopen their saved work and configuration without moving files |
| I3-02 | 0/2 legacy records readable; two warnings | 2/2 legacy records readable; zero warnings; message content unchanged | Existing conversation/job files survive the rename when placed in the active data root |
| I3-03 | Both thread-damage and job-damage fixtures fail the entire snapshot | Both snapshots and summary requests succeed, retaining the healthy conversation and one damage warning | One corrupt record no longer takes the whole library offline |
| I3-05 | At 1023 messages, model results fail persistence; no preflight exists | Host accepts capacity 1021 and rejects 1022/1023/1024 without changing history; Electron `runTurn` checks before model routing | Full tasks are rejected before further model work and direct the user to a new thread |
| I3-06 | ANSI-containing completed answer saves zero messages | Original production probe saves two messages; regression with prompt, response and notice saves all three and round-trips Unicode/newlines/tabs | Terminal control characters become visible escapes instead of destroying a completed turn |
| I3-07 | `0 0 1 * 1` at Sep 12 books Feb 1, 2027 | Same expression books Sep 14, 2026; wildcard, stepped-wildcard and Sunday-alias cases pass | Accepted cron schedules execute on their intended days |
| I3-11 | Failed run-thread save consumes the due time and marks a nonexistent run | Actual 31-second host tick preserves original due timestamp and empty last-run; recovery test emits exactly one run after retry | Temporary storage failure no longer silently skips an automation occurrence |
| I3-12 | Repeating set increases allowance 1000→200000 and resumes an exhausted goal | Repeating set is rejected; allowance 1000, spend 1200 and budgetLimited status remain unchanged; explicit extension still succeeds | A repeated set cannot increase the established goal budget |

`checkTurnCapacity` reserves three message slots for prompt, assistant answer and possible notice. It does not delete, roll up or truncate history. `investigator_2` integrated the check in the shared `runTurn` reservation before `turnRoute`; subagent creation uses a fresh empty record. The actual post-run store bound remains in force for direct host callers.

The scheduler now commits advancement after the run thread is saved, removes an unstarted thread if the subsequent job commit fails, and exposes failed starts through snapshot warnings until a later tick succeeds. Its optimized bitset/calendar search from concurrent work was preserved; only day-field combination and the old AND-based test expectations changed.

Unfinished `setGoal` calls now fail without modifying any goal state. The existing update, extension, clearing and settled-goal replacement paths remain available. `docs/goals.md` reflects this behavior.

### Validation evidence

Seven original regression checks were installed before changing production behavior: all seven failed. After the fixes, those seven pass. An additional regression exercises failed scheduled-job commit cleanup and verifies one eventual run after storage recovers.

- A scheduler regression: `/private/tmp/shinbo-bug-audit/investigator-3-A-tests.log` — 0 passed, 1 failed.
- A host regressions: `/private/tmp/shinbo-bug-audit/investigator-3-A-host-tests.log` — 0 passed, 6 failed.
- B targeted regressions: `/private/tmp/shinbo-bug-audit/investigator-3-B-tests.log` — seven targeted checks passed.
- B production probes: `/private/tmp/shinbo-bug-audit/investigator-3-B-host.jsonl`, `investigator-3-B-due.jsonl`, `investigator-3-B-goal.jsonl`.
- Full Rust suite: `/private/tmp/shinbo-bug-audit/investigator-3-full-tests.log` — 56 passed, 0 failed, 4 existing benchmarks ignored.
- Clippy: `/private/tmp/shinbo-bug-audit/investigator-3-clippy.log` — passed with `-D warnings`.

Re-run the committed checks with:

```sh
cargo fmt --all -- --check
cargo check --workspace --locked --all-targets --target-dir /private/tmp/shinbo-rust-fixes
cargo test --workspace --locked --target-dir /private/tmp/shinbo-rust-fixes
cargo clippy --workspace --locked --all-targets --target-dir /private/tmp/shinbo-rust-fixes -- -D warnings
```

The runnable host regressions are in `crates/host/tests/persistence_regressions.rs`; the two dispatch failure regressions are in `crates/core/src/live.rs`. No production user files were read or migrated. For the initial seven Rust fixes, the root coordinator owns full desktop checks, visual exercise and sibling repository documentation review. The isolated Electron compatibility run below additionally exercises actual Chromium storage and macOS secureStorage. I3-05's full desktop model-invocation regression is owned by `investigator_2`; the host capacity contract is verified here.


### I3-01 completed compatibility verification

`desktop/main/profile.ts` selects the legacy userData and sessionData directories
before startup reads durable Electron state. The legacy directory basename is
kept as app.name until `ready`, preserving the secureStorage identity initialized
by Electron. `desktop/src/boot.ts` copies missing renderer keys before provider
settings are read. `desktop/main/harness.ts` falls back to the old session index
only if the current index is absent. `crates/host/src/runtime.rs` implements the
independent host-root and environment precedence. Reset resolves the same default
root in `desktop/main/platform.ts`. No migration framework or file moves were
introduced; a populated current root wins. `docs/data.md` documents these rules.

The two host regressions in `crates/host/tests/profile_regressions.rs` fail against
the original binary and pass against the repaired binary. They exercise old only,
new only, both, an empty current directory, fresh installation, legacy override,
both overrides and an invalid new override. Saved threads and scheduled jobs are
asserted together. The desktop suite `desktop/test/profile.test.ts` checks actual
startup source, boot and session-index functions; four compatibility checks fail
against source-before and pass after the fix, with an additional I/O-error guard.

A real Electron 43.4.0 macOS fixture encrypted a synthetic credential and saved a
provider in Chromium localStorage, then exited and restarted. Original selection
returned zero readable credentials and zero providers. Updated selection returned
one readable credential and one provider, with an exact synthetic value match.
Keeping the old directory with the wrong app identity was a negative control:
zero readable credentials. The original ciphertext SHA256 stayed
`7a2039b161d45ebdf786c2c02c15a6055f16b3968aee65fee0a59c7159f416f9`.
The fixture used unique test identities, temporary profile files and no actual
user credentials. Its temporary Keychain services were cleaned up after testing.

The initialization order is verified against
[Electron 43.4.0 startup source](https://raw.githubusercontent.com/electron/electron/v43.4.0/shell/browser/electron_browser_main_parts.cc):
macOS captures the configured app name for the Keychain service and account before
`ready`. This test does not verify Keychain ACL approval across two signed release
bundles, nor native Windows DPAPI execution. Existing credentials whose Keychain
item is unavailable still require OS access or replacement; ciphertext remains
preserved. No claim is made that credentials can be decrypted on another computer.

Evidence:

- `/private/tmp/shinbo-bug-audit/profile-A.log`: desktop 0/4 compatibility checks pass.
- `/private/tmp/shinbo-bug-audit/profile-B.log`: desktop 5/5 checks pass.
- `/private/tmp/shinbo-bug-audit/profile-rust-A.log`: host 0/2 checks pass.
- `/private/tmp/shinbo-bug-audit/profile-rust-B.log`: host 2/2 checks pass.
- `/private/tmp/shinbo-i3-profile-os-20260912/{seed,A,B,C}.json`: real Electron measurements.
- `/private/tmp/shinbo-profile-before/electron-probe.cjs`: isolated Electron probe.
- `/private/tmp/shinbo-bug-audit/profile-rust-full.log`: 59 Rust tests pass, five existing benchmarks ignored.
- `/private/tmp/shinbo-bug-audit/profile-clippy.log`: clippy passes with warnings denied.
- `/private/tmp/shinbo-bug-audit/profile-tsc.log` and `profile-renderer-check.log`: main and renderer TypeScript pass.

For I3-05, investigator2's actual `runTurn` regression additionally measured A:
model starts 1; B: provider routes 0, model starts 0 and reservation released.
Evidence: `/private/tmp/shinbo-runtime-before/results.log` and
`/private/tmp/shinbo-runtime-fixes/focused-b.log`.

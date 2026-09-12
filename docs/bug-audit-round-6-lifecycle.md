# Round 6: goal lifecycle and durable allowance

Two new P1 causes and one subsequent P2 cause were reproduced and fixed. Audit scope also traced task archival, scheduler booking/finish, and fork callers; this batch makes no additional claim for those paths. No production user records, provider requests, or credentials were used. Existing optimized stores/calendar handling and unrelated work remain intact.

## R6-G1 — Resume bypassed an exhausted goal allowance (P1)

A goal can become blocked on its third repeated blocker, then exhaust its tokens when that final turn is recorded. Its settled status stays blocked, so the Goal view offered Resume. Rust accepted `updateGoal(status=active)` without checking remaining tokens or the 40-turn ceiling. Electron then started a turn using only the active-status predicate. A normal Resume click could therefore issue paid model work beyond the allowance without a grant.

The same path occurs when a blocked goal reaches its fortieth turn. This differs from I3-12: preventing a second `setGoal` does not prevent `updateGoal` from reopening the existing exhausted goal.

Fix: Rust rejects reactivation at either limit and preserves the entire prior record. Electron independently uses the existing `goalDrivesAgain` predicate before driving Resume. The view offers Continue at either ceiling and hides Resume when no allowance remains. A positive extension still resets the turn ceiling and resumes normally.

A/B: actual host fixture spent 1,000 of 1,000 tokens across three blocked turns. A returned an active goal; B returns an allowance-exhausted error and preserves the blocker/spend. The regression also covers forty turns. Extracted production Electron `updateGoal` with exhausted state started one model turn in A and zero in B; an unspent goal still starts once in B.

Files: `crates/core/src/thread.rs`, `desktop/main/main.ts`, `desktop/src/goal.tsx`. Regression: `round_six_resume_requires_an_unspent_goal_allowance` in `crates/host/tests/persistence_regressions.rs`, R6-G1 in `desktop/test/goal-lifecycle.test.ts`.

## R6-G2 — Multi-step spend disappeared between goal turns (P1)

The harness reports each step's input and cumulative turn output. Electron's live allowance guard already accumulates these reports, but `recordTurn` persisted only the final input count plus output. Earlier steps vanished from the durable ledger, leaving too much allowance for subsequent turns and after restart. Usage after a completion tool call also stopped updating the live accumulator because it was gated exclusively on active status.

Production callback/record-path fixture: input steps 10,000, 20,000, and 5,000; cumulative output 200, 500, and 600. Actual total is 35,600. A persisted 5,600, omitting 30,000 tokens (84.3%); B persists all 35,600. With a 40,000 allowance the next 5,100-token report now stops work at 40,700 total; request granularity permits the final 700-token overrun, rather than promising an impossible exact pre-request cutoff.

Fix: persist the existing per-step accumulator as optional internal `recordTurn.goalTokens`. Rust applies at least the legacy input-plus-output value, so old callers retain their behavior. Transcript input telemetry keeps its context-size meaning. Once accumulation has begun, later reports remain counted after goal settlement. Recovery attempts retain prior spend while resetting the cumulative-output baseline for the restarted harness turn.

The Rust host fixture verifies the total is saved and loaded, the next turn reaches `budgetLimited`, stopped turns count, and displayed input telemetry remains 5,000. The TypeScript regression executes the real onUsage and recordTurn functions, including a completion between reports, then verifies the next turn's live guard. The original host's rejection of the new field is compatibility evidence; the substantive A undercount is measured through the old production Electron record path.

Files: `desktop/main/main.ts`, `desktop/main/ndjson.ts`, `crates/host/src/main.rs`, `crates/core/src/live.rs`. Regression: `round_six_goal_ledger_preserves_all_model_steps` and R6-G2 in the files above. No renderer/phone request shape changes; `goalTokens` is on the private Electron–Rust link.

## Validation and boundaries

- Matching TypeScript regressions: A 0/2 pass, B 2/2 pass. Related goal/runtime/council suite: 30/30 pass.
- Rust workspace: 66 passed, five existing ignored benchmarks. Format and strict Clippy pass.
- Desktop main and renderer type checking and focused ESLint pass.
- A snapshots and binary: `/private/tmp/shinbo-lifecycle-A/`. Evidence: `desktop-A.log`, `desktop-B.log`, `rust-A.log`, `rust-B.log`, `resume-A.json`, `resume-B.json`, `clippy.log`; `probe.py` runs against either saved or current host binary.
- Re-run Rust with `cargo test --workspace --locked --target-dir /private/tmp/shinbo-rust-fixes`. Re-run desktop via its normal test command, or compile to a mirror retaining the `desktop/dist-main` directory shape before running `goal-lifecycle.test.js` and `goal.test.js`.
- The paired current host is `/private/tmp/shinbo-rust-fixes/debug/shinbo-host`. Main source and that binary must travel together because the host validates unknown request fields.
- Root owns the live Goal view exercise and sibling website documentation. Signing, platform privacy, and non-macOS behavior were not exercised by these fixtures.
- Subagent spend still does not enter the parent's goal ledger. This limit is not claimed as fixed. The subsequent completed-goal scope fix is detailed below.

## R6-G3 followup — Later chat changed a completed goal's historical cost (P2)

Separate cause from the R6-G2 amount undercount: the runtime charged every recorded
turn to any non-paused goal still attached to the thread, regardless of whether
that turn pursued it. A completed 100-token / one-turn / one-second goal became
600 tokens / two turns / three seconds when the user asked an unrelated question.
Its evidence was unchanged, but its reported historical cost and duration were wrong.

Fix: Electron captures participation when a goal-bearing turn starts or a goal is
created during a live turn. It supplies optional internal `recordTurn.goalTurn`;
Rust validates the flag and skips goal mutation for nonparticipating turns while
saving their ordinary transcript. Participation survives completion before the
first usage report, preserving the final settling turn's charge. Missing flags
retain the prior host contract. This adds no phone-facing method or field.

A/B actual host fixture: final goal remained 100 tokens / one turn / one second
in B after the unrelated 500-token / two-second chat, versus 600 / two / three in
A. All four transcript messages still persist. The regression executes goalRequest
and recordTurn, including a goal created and completed before the first usage
report, then a later unrelated question. Matching test A fails, B passes.

Evidence: `/private/tmp/shinbo-goal-scope-A/{probe.py,probe-A.json,probe-B.json,desktop-A.log,desktop-B.log,rust-B.log,clippy.log}`. Its saved host and main source are the immediate pre-followup A baseline. Current host: `/private/tmp/shinbo-rust-fixes/debug/shinbo-host`, now 67 Rust tests passing with five existing ignored benchmarks; 31 related desktop tests pass. Main compilation, strict Clippy, format and focused lint pass. Main and host must be paired, as with R6-G2. No additional renderer changes in this followup.

The stale overspend notice was also updated to describe the now-correct per-step
ledger. This is a wording followup to R6-G2 and is not a distinct bug count.


The subsequent [integration review](bug-audit-integration-review.md) corrected a
shared-helper regression: concurrent council adoption must not borrow the active
harness's accumulated spend. Harness metadata now enters through its own save
helper. The completed-goal and multi-step regressions remain passing. This is part
of R6-G2, with no additional distinct finding counted.

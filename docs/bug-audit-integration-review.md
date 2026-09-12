# Integration correctness review

This pass reviews the completed fixes against their current callers and shared
state. It does not add duplicate findings or claim the documented parent/child
goal-budget extension is implemented. Synthetic host roots and mocked model
responses are used throughout; no user records are altered.

## Reproduced correction: harness accounting leaked into concurrent council adoption

R6-G2 moved the harness's per-step total into the shared `recordTurn` helper. A
council can run on the same task while its harness is active: `CouncilPanel` has
its own seating/adoption busy state, and the council IPC validates capacity but
does not reserve the harness turn. The council's `land` callback also uses
`recordTurn`. It therefore borrowed the active harness's counter instead of
recording only the council's own usage.

A production-function probe executes the actual `land` callback, `recordTurn`,
and NDJSON formatting against the current host using a temporary root. With
20,000 tokens of accumulated harness work and a 300-token council, adoption
charges 20,000. The later harness save charges another 20,000. At a 30,000-token
allowance, the goal incorrectly becomes `budgetLimited` at a recorded 40,000,
instead of remaining active at the actual 20,300.

Evidence: `/private/tmp/shinbo-goal-council-review/probe.cjs` and `A.json`.
The correction attaches harness accounting only at the harness's
successful/stopped save call sites through `recordHarnessTurn`. The generic
`recordTurn` helper respects supplied metadata and otherwise uses only the caller's
own usage. The host interface is unchanged.

B records 300 for the council and 20,000 for the harness, leaving the goal active
at 20,300. The new regression executes the actual council land callback and both
save functions; it fails against the saved immediate A source and passes against
B. The existing multi-step and completed-goal participation regressions still
pass. This is a correction within R6-G2, not an additional distinct bug count.

Evidence: `B.json`, `desktop-A.log`, `desktop-B.log` beside the probe above. The
33 related desktop tests pass, main TypeScript compilation and focused lint pass,
and the edited files pass whitespace checks. Rust source is unchanged from the
67-test checkpoint. Root's live-app/full-suite checks remain separately owned.

## Council saves now refresh the live allowance guard

The same caller review found that `land` discarded the saved thread returned by
Rust. The durable ledger could correctly include council usage while the live
harness guard still used the old remaining allowance. In a 1,000-token fixture,
a council saving 900 tokens and a participating harness spending another 300 left
the cached spend at zero and did not stop. A council saving 1,100 likewise left
the harness running even though Rust had already marked the goal budget-limited.

The land callback now applies the returned thread to the existing goal cache and
checks a currently participating harness counter against the remaining allowance.
It stops when the combined spend reaches the limit, including when the council
alone has exhausted it. A separate regression verifies that an unrelated later
conversation without a participating counter is not stopped. Failed writes never
reach this update/check because it follows the awaited host save.

A/B production-callback fixture: cached council spend 0 → 900 (or 1,100), missing
Stop → Stop issued. The exact-match test fails against the immediate pre-fix
source and passes afterward. Evidence: `guard-main-A.ts`, `guard-probe.cjs`,
`guard-A.json`, `guard-B.json`, `guard-desktop-A.log` in the same evidence folder.
The standalone probe can report repeated Stop requests when it deliberately keeps
a cancelled fake harness emitting; the regression uses the normal settled state
and verifies one stop plus isolation of unrelated work. This is included as a
related integration completion, without increasing the distinct-root count.

## Reviewed relationships without an additional substantiated regression

- Host `recordTurn` applies all transcript validation and message-count checks
  before saving. A rejected append does not write a partial prompt or update goal
  spend. Capacity preflight reserves three slots; the final store bound remains
  authoritative if another save occurs while work is running. No history is
  removed to make room.
- `hand_out_run` saves its run thread before advancing the scheduled record. A
  subsequent job-save failure deletes the unstarted thread. The due-job callback
  is reached only after both writes succeed; failed preparation leaves the prior
  booking available to retry. This remains per-file atomic persistence, not a
  multi-file crash transaction.
- The optimized calendar search still uses parsed bitsets and date/hour skips.
  The 400-year bound and impossible-date shortcut retain restricted DOM/DOW OR,
  wildcard conjunction, Sunday aliases and numerical steps. Existing regressions
  cover these combinations and trace requests near the accepted size ceiling.
- The optional private `expectedTitle`, `goalTokens`, and `goalTurn` parameters
  are validated by Rust. Main and host must be deployed together; the phone-facing
  bridge schema has not gained those fields.
- Council adoption retains its state until the host write resolves. Failed
  writes remain retryable, and simultaneous adoption calls share its landing
  exclusion. Stop aborts pending model calls without altering another sitting.
- Legacy discovery respects explicit data roots and populated new directories.
  These are discovery changes, with no move/delete of legacy data. Synthetic
  Electron identity coverage is retained; actual signed Keychain ACL behavior
  remains unverified as previously reported.

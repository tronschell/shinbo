# Round 4: council and secondary-model reliability

Three distinct production bugs are fixed: two P1 council/secondary-model issues
and one P2 title race. Council capacity preflight completes the existing I3-05
fix and is not counted again. Tests use synthetic settings, mocked fetch and
throwaway host data; no real provider request or user data was used.

## R4-C1 — P1: Stop leaves paid secondary-model work running

The CouncilPanel Stop button invokes `shinbo:council-stop`, which calls
`stopCouncil`. Previously this only changed a Boolean. `chatCompletion` accepted
only its own timeout signal, so two to eight pending council requests continued
for up to 120 seconds. Stopping while `carried()` awaited history still started
every opening draft after history arrived. Closing removed the map entry without
stopping its sitting, and a late context failure could emit a failed state after
the user had already stopped it.

The same missing cancellation propagation affected `AgentRuntime.consultAdvisor`
and the `executeTool` vision branch. Stopping the associated task did not abort
these requests. An advisor request could even start after Stop if history was
still loading. This is one grouped cancellation root across callers of the same
secondary-model request helper, not separate findings per tool.

The fix adds an optional caller signal to `chatCompletion`, combined with its
existing timeout. Each council owns an AbortController; Stop aborts it, Close
stops before removing the sitting, and async continuations check its lifecycle.
Each agent run also owns a controller. Stop and final settlement abort that
run's remaining requests. Advisor and vision receive that run's signal; advisor
checks it after awaiting history. The signal is captured per run, so stopping
one task does not cancel another. The verifier itself uses a synchronous local
screen and has no remote model request to cancel.

| Regression | A | B |
| --- | --- | --- |
| Stop while council history loads | 2 draft requests start afterward | 0 requests start; Close is also checked |
| Stop two pending council seats | 0/2 request signals aborted | 2/2 aborted |
| Delayed context error after Stop | Final state becomes failed | Final state remains stopped |
| Stop advisor while two tasks are active | Neither request aborts | Only stopped task aborts |
| Stop vision while two tasks are active | Neither request aborts | Only stopped task aborts |
| Stop while advisor history loads | 1 paid request starts afterward | 0 requests start |

Impact: Stop promptly disconnects local requests and prevents additional model
calls. The tests verify cancellation propagation, not whether a provider refunds
or stops billing already-generated tokens after a client disconnect.

## R4-C2 — P1: failed council adoption claims completion and cannot retry

`adoptCouncil` originally emitted `done` before awaiting `deps.land`. The caller
in `main.ts` writes the paid answer and usage through `recordTurn`. If that save
fails, the panel has already hidden its adoption buttons because it sees `done`.
A second adoption is rejected. Automatic adoption similarly ended in `failed`
with no retry affordance. The completed council answer was visible but could not
be saved through its intended action without rerunning the council.

Adoption now keeps the answer waiting while its single pending save runs. It
emits `done` only after persistence succeeds. A failed save records its error and
leaves the existing answer available for retry. Automatic adoption uses the same
path. Concurrent adoption calls cannot duplicate the write; manual buttons show
Saving and are disabled until the request settles.

| Regression | A | B |
| --- | --- | --- |
| First manual save fails | State is done; retry is unavailable | State is waiting with the save error |
| Retry after temporary save failure | Completed answer cannot be adopted | Exactly 1 successful save, 0 extra model calls |
| Completion before pending write settles | 1 premature done event | 0 done events before commit |
| Concurrent adoption | First selection is locked by premature done | One write is in flight; successful selection commits once |

The retry test covers both manual and automatic modes. No model rerun, history
truncation, provider refund claim or speculative disk migration is involved.

## R4-N1 — P2: delayed automatic naming overwrites a user's chosen title

`autoNameThread` checked that a conversation had the default title, then awaited
`nameThread` for up to 20 seconds. A user rename during that wait was overwritten
by the later unconditional `renameThread` request. The same overwrite could erase
a goal-derived title set while naming was pending.

Automatic naming now sends the original default title as optional `expectedTitle`
to the existing internal host rename request. Rust loads, compares and saves in
one serialized runtime command. If the title changed, it returns the current
thread unchanged. Electron records the title actually returned by the host.
Normal manual renames retain their existing behavior.

A source-based reproduction changed `My chosen title` to `Automatic replacement`
with the original caller. The updated caller preserves `My chosen title`, and
its sidebar title cache receives that same value. A production host regression
also verifies that an unchanged default can be named, a manual rename succeeds,
and a late conditional rename leaves the manual title intact on disk.

`expectedTitle` is an optional internal Electron-to-Rust field. The phone bridge
request and response schemas are unchanged; phone renames remain unconditional.
No mobile protocol update is required. Website docs should describe the changed
Stop and council-save behavior; `docs/models.md` is updated here, with sibling
repository coordination owned by the root agent.

## Existing I3-05 integration

The council start IPC now checks host `checkTurnCapacity` after validating its
request and before starting any model calls. The reproduction changed from one
council start on a full task to zero. This shares I3-05's capacity root and is not
a fourth finding. Persistence still enforces the store bound if capacity changes
while the council runs; adoption then reports that failure and remains retryable.
No history is truncated.

## Validation

- New regression checks: A 0/10 pass; B 10/10 pass. Five council checks, three
  secondary-model cancellation checks, one naming race and one existing-capacity
  integration check. These ten checks cover three new bugs, not ten bugs.
- Focused council, vision, naming and secondary-model suite: 27/27 passed.
- Existing agent, permission, verifier, cancellation and turn-ledger regressions:
  124/124 passed. An initial temp-directory layout failure in the verifier source
  inspection test was resolved by using the expected desktop directory layout.
- Full Rust workspace: 60 tests passed, five existing benchmarks ignored.
- Main and renderer TypeScript, Rust fmt and clippy with warnings denied passed.

Tests added:

- `desktop/test/council-runtime.test.ts`
- `desktop/test/secondary-cancellation.test.ts`
- `desktop/test/thread-namer-runtime.test.ts`
- `crates/host/tests/persistence_regressions.rs`

A snapshots and isolated compiled modules: `/private/tmp/shinbo-council-before`
and `/private/tmp/shinbo-council-A`. Evidence logs under
`/private/tmp/shinbo-bug-audit`: `council-A.log`, `secondary-A.log`, `namer-A.log`,
`council-final-B.log`, `council-agent-regressions.log`, `council-rust-full.log`,
`council-clippy.log`, `council-tsc-B.log`, `council-renderer-check.log`.

No additional distinct defect was substantiated in the verifier's local screen,
standalone screen description or model-response parsing. Those were reviewed
without speculative changes. Root owns the final real-app exercise of Stop,
Saving and retry behavior, which was not visually verified in this worker's
round. Native Windows execution and actual provider billing remain unverified.

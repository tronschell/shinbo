# Independent CLI and hidden-loading review

Reviewed `desktop/main/cli.ts` against `/tmp/shinbo-cli-stop-race/before-cli.ts`, and the `useTurns` changes in `desktop/src/AgentView.tsx` against `/tmp/shinbo-native-subagent-fixture/AgentView-before.tsx`, with both implementation reports and focused tests. No timing benchmark, external service, or native UI was used.

## CLI ownership

The new child-keyed shutdown map correctly distinguishes successive turns that share a run ID. Each pending shutdown captures its exact ChildProcess, and old completion deletes only that child's map entry. Repeated Stop on the same child shares its promise. A child closing while initial termination is pending causes the continuation to return; once the close waiter is attached, close cleanup clears the entry before escalation checks it. Final buffered output is still handled by the existing close lifecycle.

POSIX ownership remains process-group based while descendant pipes keep the captured child from closing, even if the leader has exited. Windows initial and forced termination skip an already-exited direct child rather than risk targeting a recycled PID. This is consistent with the existing platform helper; it is not a new guarantee that orphaned Windows descendants remain identifiable after their parent exits. The helper resolves termination failures as false, so its ordinary failure paths do not introduce an unhandled shutdown rejection.

The review and coordinator independently noticed an adjacent `finish` ownership gap: after an error marks the entry failed, a retry can replace its child before the earlier close callback runs. That callback checked only the reusable entry's status. A deterministic actual-CliRuns probe reproduced the replacement becoming failed, losing its child reference, rejecting Stop, and never settling its own turn promise. This is an event-ordering fixture, not a claimed native spawn-error timing measurement.

The runtime owner added the minimal exact-child check to `finish` and a permanent regression covering replacement attachment/status, accepted Stop, promise settlement, and deadline cleanup. This extends the same ownership integration, without adding a counted performance issue. The independent probe in `/tmp/shinbo-cli-stop-race/ownership-review.test.mjs` now passes against the final source. The runtime owner's saved before source and failure log document the additional regression.

## Enabled trace loading

Activity, Worktrees, and Bench do not consume parsed turns. The effect now runs only while Self improvement is selected. Enabling, disabling, and changing the filtered thread signature create separate request identities. Readiness compares against that identity, so a completed old load cannot mark a reentered or changed request ready. Cleanup prevents late parsing, late state publication, and subsequent four-request batches. Already-dispatched host reads remain uncancellable, as documented.

The effect retains original batch/input order, failed-history empty fallbacks, generation normalization, duplicate-turn ordering, and start-time 90-day filtering. Old turn state is intentionally retained while a fresh request is pending; `ready` is false and the paid Analyze action is disabled. This is data reuse during refresh, not a claim that old rows disappear immediately.

Bench exclusion still derives from `benchKin` and the saved bench roots when `snapshot.threads` changes. A changed exclusion set changes the filtered signature and invalidates the load. A bench-only localStorage edit without any thread snapshot replacement is not independently observed by this memo; that dependency behavior already existed in the baseline. The new enabled flag does not establish a separate bench-store subscription. Likewise, malformed-parser exceptions retain the existing loader behavior rather than gaining a new recovery policy.

No new hidden-loading correctness defect was found. Its three focused tests pass, including enabled results, ordering, missing histories, bench exclusion, readiness on reentry/history changes, and cleanup before unresolved replies parse. The final seven CLI lifecycle tests also pass. The independent extra ownership probe passes separately. Real POSIX descendant behavior has the owner's earlier native process fixtures; native Windows and Electron interaction remain with the coordinating audit.

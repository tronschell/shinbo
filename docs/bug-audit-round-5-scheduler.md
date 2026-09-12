# Round 5: trace persistence and scheduler edge cases

All four P2 findings from the initial audit still reproduced against the current
optimized code. They are now fixed under their original IDs, I3-04, I3-08, I3-09
and I3-10. None had been fixed indirectly, and none is counted as a new duplicate.

## I3-04 — P2: long completed-run traces fail at the host boundary

`AgentRuntime.flushTrace` calls `encodeSpans`, which supports traces up to
1,048,576 characters, then sends `recordTrace` through its main-process request
dependency. The Rust store supports a 1,048,576-byte trace. The host NDJSON reader
rejected every request above 131,072 bytes before dispatch, including accepted
long traces; flushTrace logged the error without retaining the trace on disk.

The host now allows a larger bounded envelope for `recordTrace`: six times the
store trace byte ceiling plus the existing 128 KiB envelope allowance, enough
for JSON string escaping. Ordinary request methods retain their existing
128 KiB limit. The reader starts with the original small allocation and grows
only when a larger record arrives. Existing trace-content elision and per-thread
trace retention bounds are unchanged.

Actual-host A/B: a 1,048,575-byte trace changed from rejected / zero saved bytes
to accepted / 1,048,575 saved bytes. The regression also round-trips a nearly
1 MiB Unicode/quote/backslash-heavy trace, rejects an oversized ordinary rename
request, and confirms the following request is still readable.

Impact: a long run retains its tool trace for inspection after completion instead
of losing the entire trace at transport. This does not expand conversation
history or remove any store bound.

## I3-08 — P2: accepted numeric cron steps run only at the first value

The raw cron picker in `desktop/src/schedule.tsx` and the task-save tool in
`main.ts` send five-field expressions to `saveScheduledJob`. `field_matches`
parsed a numeric range start as `(start, start)`, including when followed by a
slash step. Thus `5/10` matched only 5, silently turning six minute-field
occurrences per hour into one.

The numeric-with-step case now ranges from its start to the field maximum.
Exact numbers, explicit ranges, wildcard steps, the optimized bit masks and
calendar skips retain their existing paths.

Deterministic A/B at September 12, 2026, 05:32:39 UTC:
`5/10 * * * *` changes from 06:05 to 05:35. A separate production host probe
booked 07:05 before the fix and 06:55 afterward at its later test time. Regression
coverage also checks hour, day, month and weekday numeric starts, plus plain
minute 5 to ensure it still books only at 5.

Impact: an accepted stepped schedule fires at the cadence the expression names.

## I3-09 — P2: valid leap-day tasks cannot be booked or advanced

The yearly picker can produce `0 0 29 2 *`. `next_run` searched only 527,040
minutes, so saving this valid job in September 2026 failed rather than booking
February 2028. Claiming a leap-day run also failed when its next occurrence was
four years away.

The optimized calendar scan now has one complete Gregorian cycle as its finite
bound: 146,097 days. This handles both the eight-year leap-day gap around 2100
and less common weekday combinations. An upfront date-possibility check reuses
the existing Gregorian month-length helper, keeping impossible dates from
requiring a full-cycle scan. The check respects the existing OR behavior when
both day fields are restricted.

A/B: creation previously returned `schedule has no occurrence in the next year`.
It now books 2028-02-29 and advances that run to 2032-02-29. Additional checks
book 2104 after March 2096, then 2108; a leap-Sunday expression books 2128 from
March 2088. February 30 still fails, while February 30 OR Monday still books
Monday. An actual host save now returns the 2028 booking.

A seven-sample local host probe measured impossible-date rejection at median
0.916 ms before and 0.069 ms after. Annual-job save retained the same booking
and measured 13.730 ms before / 4.011 ms after; these include local filesystem
cost and are observations, not a general speedup claim. The bitset/calendar
implementation and record caches from concurrent performance work are preserved.

Impact: valid rare calendar jobs can be created and continue after their first
occurrence without blocking ordinary invalid-date feedback.

## I3-10 — P2: accepted trigger whitespace prevents event/dependency dispatch

`validate_schedule` accepted whitespace around the suffix of `on startup` and
`after <job-id>`, but stored the unnormalized string. `Runtime.fire_trigger`
compared it to a canonical exact string. A task could save successfully and
never receive its event or dependency trigger.

After existing validation, `ScheduledJob::from_fields` now normalizes accepted
whitespace. New jobs and records read from disk share this constructor, so the
fix covers already-saved tasks as well as newly entered ones. New validation or
a migration framework was not needed.

Actual-host A/B: the synthetic startup task and dependent task emitted zero due
jobs before and two afterward. Fixtures include doubled spaces, tabs and
accepted Unicode whitespace in existing Markdown records. The saved snapshot
exposes canonical `on startup` and `after <id>` schedules.

Impact: accepted triggers fire when their event or dependency occurs, and users
do not need to find and manually repair the old records.

## Validation and scope

- Four new production regressions: A 0/4 pass; B 4/4 pass.
- Full Rust workspace: 64 tests pass, five existing benchmarks ignored.
- Rust fmt and clippy with warnings denied pass.
- No desktop source, phone bridge schema or visible control changed this round.
  Root owns final integrated desktop and platform verification.
- All records and host requests used temporary synthetic data. No provider work,
  real task execution, user-file migration or live configuration changes occurred.

The regressions are committed in
`crates/host/tests/persistence_regressions.rs` under `round_five`. They exercise
actual NDJSON host trace and trigger behavior, actual host leap-day creation,
and deterministic public scheduler construction/advancement.

Evidence under `/private/tmp/shinbo-bug-audit`:

- `scheduler-A.log`, `scheduler-B.log`: fail-before/pass-after checks.
- `scheduler-probe.py`: runnable actual-host metrics probe.
- `scheduler-probe-A.json`, `scheduler-probe-B.json`: measured bookings, timing
  and submitted/saved trace byte counts.
- `scheduler-full.log`, `scheduler-clippy.log`: full Rust validation.

`/private/tmp/shinbo-scheduler-A/shinbo-host` preserves the binary from immediately
before these four fixes. `scheduled.rs` and `main.rs` beside it preserve the two
changed implementations for comparison. The original audit and completed P1
work remain documented in `docs/bug-audit-investigator-3.md`.

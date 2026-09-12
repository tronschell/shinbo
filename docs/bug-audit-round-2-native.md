# Artifact durability and responsiveness

Three distinct P1 roots are repaired. Investigator 1 implemented the changes using gpt-6-astra with high reasoning. The coordinator independently compiled and reran all 19 affected tests after the investigator stopped with an agent safety error in an unrelated Windows investigation.

| Root | Before | After |
| --- | --- | --- |
| N1: unsynchronized artifact mutation | Concurrent creates choose the same ID; disjoint edits and side-file writes restore stale content | Existing store mutation paths serialize their read/modify/write operation; two outputs and both changes survive |
| N2: destructive format-conversion ordering | Original content is deleted before the replacement can be written | Replacement content and metadata are written before old content cleanup; failed replacement leaves original readable |
| N3: synchronous unbounded SQL | Recursive computation blocks the Electron main event loop indefinitely | A bounded child process executes the query, with a two-second timeout; main remains responsive and interrupted writes roll back |

N1 and N2 modify `desktop/main/artifacts.ts`. N3 also adds `desktop/main/artifact-sql.ts`. Checks are in `desktop/test/artifact-durability.test.ts`; existing artifact tests remain passing. No dependency was added.

A evidence is under `/private/tmp/shinbo-native-audit`: `targeted-a.log` contains five intended failures across the three roots; `sql-parent.cjs` supervises the original blocking SQL implementation. The original hang produced zero heartbeats before forced termination at approximately 1.2 seconds. B's `sql-b.log` records 19 heartbeats and a clean query rejection within 2.06 seconds. This measures responsiveness and bounded recovery, not faster SQL execution.

The B regressions verify two simultaneous creations retain two results, disjoint edits both persist with version 3, side-file writes do not restore stale entry content, failed format conversion retains the original, same-extension kind changes retain replacement content, long queries time out while the main loop runs, and partially applied writes roll back. The database passes integrity_check and accepts another insert after interruption.

The coordinator's independent compile and test log is `/private/tmp/shinbo-bug-audit/artifact-integration-2.log`: 19 passed, zero failed. An initial isolated-output run omitted its node_modules link, causing a module-resolution failure in the existing suite; that environment issue was corrected and is not an application defect.

Desktop artifact UI and packaged execution remain under verification. Native Windows app authorization was not completed or counted. A terminal resize/closed-pipe suspicion did not reproduce and is excluded.

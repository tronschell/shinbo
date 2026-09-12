# Browser daemon lifecycle investigation — 2026-09-12

## Outcome

Confirmed a P2 resource leak in `Browsers.stopAll`: closing Shinbo's browser views and exiting Electron leaves the per-thread agent-browser daemon running. This investigation did not establish an urgent P1 impact. The fix reuses the existing `forget(session)` cleanup after destroying each session’s views and removes the now-redundant map clear. This is a P2 lifecycle fix, not an additional P1 finding.

This is separate from closing a borrowed browser. An isolated control confirmed that agent-browser's `close` terminates its own daemon while leaving the connected Electron process and its page alive. No user browser or user session was touched.

## Call path and ownership

`desktop/main/main.ts` calls `browsers.stopAll()` from `will-quit`. `Browsers.run` connects a named agent-browser session to Shinbo's Electron CDP endpoint. `stopAll` destroys the owned views and clears the session map, but skips `forget`; explicit last-tab close and browser close already call `forget`. That helper launches `agent-browser --session <owned-name> close` as a detached process with ignored stdio and an error listener, allowing cleanup to survive application exit.

The installed agent-browser is version 0.34.0. Its locally installed README states that daemons persist between commands, normally exit after one hour of inactivity, and exempt user-attached browsers from the default timeout. The observed daemon did not exit when its final view closed or when its Electron host disconnected. The observation lasted ten seconds; indefinite retention was not experimentally measured. No CPU stall, UI delay, or large-session accumulation was demonstrated, so this finding is P2.

## Isolation and method

Exact baseline: `/tmp/shinbo-perf-wave4-browser/browser.baseline.ts`.

The fixture `/tmp/shinbo-perf-wave4-browser/browser-fixture.cjs` starts a disposable Electron process with a fresh temporary profile, localhost CDP port, prohibited activation, and one sandboxed `WebContentsView` at `about:blank`. It creates no window and receives only `close-view`, `probe`, and `quit` lifecycle commands. This is a process/protocol test, not UI automation.

The controller `/tmp/shinbo-perf-wave4-browser/probe.cjs` strips inherited `AGENT_BROWSER_*` settings, supplies an empty configuration, and creates a unique `--namespace w4-<random>` and session `shinbo-owned`. It connects the installed daemon to the disposable host. It extracts and transpiles the actual `Browsers` class from the requested source, injects the CLI spawn dependency solely to add the isolated namespace/configuration, and seeds one owned session whose view close sends the fixture's close-view lifecycle command. The actual `stopAll`, `destroyTab`, and `forget` bodies execute unchanged from that source. The temporary candidate only added `this.forget(session)` after destroying each session’s views and removed the redundant final map clear. The implemented production source matches that tested candidate byte for byte, and the protocol experiment was repeated against the production source.

PID checks and session information establish that the baseline daemon is the same process throughout, rather than a daemon restarted by observation. Each run's finally block explicitly closes the test session and removes its temporary profile and namespace. The borrowed-host control closes only the daemon before checking that the host process and page still exist.

## Commands

Run from `/Users/tronschell/Documents/shinbo`:

```sh
cmp /tmp/shinbo-perf-wave4-browser/browser.candidate.ts desktop/main/browser.ts
node /tmp/shinbo-perf-wave4-browser/probe.cjs > /tmp/shinbo-perf-wave4-browser/baseline-method.log 2>&1
node /tmp/shinbo-perf-wave4-browser/probe.cjs --source=/tmp/shinbo-perf-wave4-browser/browser.candidate.ts > /tmp/shinbo-perf-wave4-browser/candidate-method.log 2>&1
node /tmp/shinbo-perf-wave4-browser/probe.cjs --borrowed > /tmp/shinbo-perf-wave4-browser/borrowed.log 2>&1
node /tmp/shinbo-perf-wave4-browser/probe.cjs --source=/Users/tronschell/Documents/shinbo/desktop/main/browser.ts > /tmp/shinbo-perf-wave4-browser/fixed-method.log 2>&1
```

The protocol runs required approval to create the isolated localhost CDP and agent-browser sockets outside the execution sandbox. They exited successfully. Only the proven cleanup change was applied to application source; no experiment instrumentation was added to production code.

## Results

| Observation | Actual baseline method | Temporary candidate method |
|---|---:|---:|
| Daemons connected before stop | 1 | 1 |
| Daemons one second after stop | 1 | 0 |
| Daemons three seconds after host exit | 1 | 0 |
| Daemons ten seconds after host exit | 1 | 0 |
| Remaining daemon RSS after host exit | 11,552 KiB | 0 KiB |

Baseline daemon PID 12744 retained its PID with zero pages after host PID 12730 exited. The candidate session reported inactive with null PID after stop, and `ps` found no process at its recorded daemon PID. These are one paired run, not latency benchmark medians. The repeated run against the implemented production source likewise released daemon PID 15618: the session was inactive at the first one-second sample and after host exit, `ps` found no daemon, and the PID remained absent ten seconds after disconnect. Its log is `/tmp/shinbo-perf-wave4-browser/fixed-method.log`.

The borrowed-host control used daemon PID 6957 (11,440 KiB RSS) and Electron PID 6947. After `close`, the daemon PID no longer existed (`ESRCH`), the session was inactive, Electron remained alive, and its view reported `{"destroyed":false,"url":"about:blank"}`. The controller then shut down its disposable Electron process.

## Regression checks

`desktop/test/browser-attach.test.ts` exercises the production class with two owned sessions. It asserts exact session-specific cleanup commands, view destruction before each command, detached/ignored-stdio spawn options, cleared session state, no duplicate cleanup on repeated shutdown, no CLI launch when its binary was never resolved, and safe handling of asynchronous ENOENT errors from the cleanup child. It does not enumerate or close unrelated browser sessions.

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave4-browser/compiled
node --test /tmp/shinbo-perf-wave4-browser/compiled/test/browser-attach.test.js
cd desktop
./node_modules/.bin/eslint main/browser.ts test/browser-attach.test.ts --max-warnings 0
```

Main compilation, all three focused tests, and focused lint passed. The isolated compiled directory has a node_modules symlink to the desktop dependencies. Replacing only its compiled browser module with the transpiled frozen baseline makes the new regression fail (exit 1), while both pre-existing tests still pass; log: `/tmp/shinbo-perf-wave4-browser/baseline-regression.log`. The fixed module was restored immediately afterward. Existing test source was saved before editing at `/tmp/shinbo-perf-wave4-browser/browser-attach.test.baseline.ts`; production source was also saved immediately before editing at `browser.before-fix.ts` in the same directory.

## Remaining limits

Native Windows shutdown and alternate agent-browser versions were not exercised. Cleanup retains the existing detached, best-effort close command: an unavailable executable cannot release an already running daemon. The baseline’s existing view-removal failure semantics were not changed. Borrowed-browser preservation was tested with the installed runtime and disposable Electron host, not with a user browser. No UI was driven in this process/protocol investigation; parent-level integrated application checks are separate.

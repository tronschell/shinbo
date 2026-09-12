# Terminal auto-open audit

No performance fix is warranted by the measured behavior. The reported repeated `shinbo:terminal-open` errors for an unfiled thread do not reproduce from stable rerenders or terminal broadcasts.

## Call flow

`App.tsx` renders `TerminalPanel` while the terminal pane is visible, inside the thread view keyed by thread ID. `terminal.tsx` subscribes once per thread to terminal changes and refreshes its tab list. `TerminalPanelImplementation` separately checks for existing terminals when its folder ID, thread ID, or memoized start callback changes. An empty list or rejected list request makes one open attempt. Its start callback depends only on thread ID. Updating the displayed error, fresh callback props, fresh tab arrays, and broadcasts do not change those dependencies.

The main-process open handler resolves the thread's connected folder through `grantFor`. An unfiled thread is correctly rejected with the reported error. The panel contains no auto-open timer, retry loop, or error-dependent effect.

## Measured behavior

The standalone probe `/tmp/shinbo-terminal-autostart-audit/probe.cjs` extracts the actual panel and `useTerminals` declarations with TypeScript and executes them with a deterministic hook/effect runner. Exact source copies are beside the probe. It tested both an empty successful list followed by a rejected open, and a rejected list followed by a rejected open.

Both cases produced:

| Input | Open attempts |
| --- | ---: |
| Initial mount plus 1,000 stable renders | 1 |
| An additional 1,000 terminal broadcasts and renders | Still 1 |
| Change folder ID | 2 total |

Each scenario established exactly one terminal subscription and disposed it once on unmount. The 1,000 broadcasts each refreshed the list as designed, without causing another open.

## Limits and next evidence

This is a deterministic source-level lifecycle check, not an Electron mount trace. Remounting the pane, switching thread or folder, and development hot reload can rerun the initial attempt. The reported approximately 500 log lines over 40 minutes cannot distinguish those events from repeated attempts because an IPC error may occupy several stack-trace lines. Correlating actual attempt count with component mount/hot-reload events is needed before assigning a root cause to that observation. No source or permanent test changes were made for this unconfirmed candidate.

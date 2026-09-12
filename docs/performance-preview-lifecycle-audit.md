# Artifact, component, and visual preview lifecycle

## Confirmed component remount fix

P1: metadata changes to one component restarted unrelated credential-using components. The user can trigger this through a component's “Allow full screen” action. `expandComponent` changes metadata and broadcasts `components-changed`; `useComponents` refreshes the full list. The main process reparses every declaration list, so unchanged `variables` fields arrive as fresh arrays.

`useModule` keyed its memoized API object on that array identity. Each refreshed array created a new API, reran the module effect, reinvoked the module factory, and supplied React with a new component function. Existing widget state was lost and mount-time effects such as initial data fetches restarted. Components with no declarations already avoided this particular invalidation.

The fix keys the existing API memo on a JSON value of the declaration list and reconstructs its variables array only when that value changes. This list is bounded to eight credential names. Actual declaration changes still rebuild the API; component ID or module version changes still load normally. No custom comparator, module compilation cache, or new dependency is introduced.

### Measured actual-hook fixture

Exact pre-edit source is `/tmp/shinbo-preview-lifecycle-audit/components.tsx`. `desktop/test/component-lifecycle-performance.test.mjs` executes the real `useModule` hook and dynamic-import continuation with a tiny supported module that performs a startup request in its mount effect and disposes its effect on replacement. It models the component's type identity, rather than treating each parent rerender as a new mount.

At the supported limit of 64 components, all declaring the same single credential, 20 metadata broadcasts toggle the first component's expansion setting while returning fresh arrays for unchanged declarations:

| Work including initial mounts | Before | After |
| --- | ---: | ---: |
| Module factory invocations | 1,344 | 64 |
| Startup fetch effects | 1,344 | 64 |
| Unnecessary replacement cycles | 1,280 | 0 |

The test preserves unchanged component identity and verifies changed credentials, a new module version, removal of declarations, error-free factory results, and teardown of every mounted effect. Requests are mocked; no external service was contacted, and no network latency estimate is claimed.

```sh
SHINBO_COMPONENT_LIFECYCLE_BASELINE=/tmp/shinbo-preview-lifecycle-audit/components.tsx node --test desktop/test/component-lifecycle-performance.test.mjs
```

The paired test, renderer typecheck, and scoped lint passed. Real component-menu interaction verification belongs to the coordinating audit.

## Other bounded coverage

Inspected `artifacts.tsx`, `visual.tsx`, `mermaid-artifact.tsx`, `preview.tsx`, their shared document generators, and relevant main-process handlers. Exact renderer source snapshots are beside the component baseline.

- Artifact-grid previews mount only near the viewport and unmount when they leave. Their observer disconnects on unmount. The artifact read effect ignores stale results. ArtifactFrame removes its window-message listener, and its source-window check limits SQL replies to the intended frame. Closing panes/dialogs or toggling source removes the corresponding iframe. The existing bounded artifact SQL work was excluded from new changes.
- Component portal observers disconnect, pending animation frames cancel, and their host nodes are removed on unmount. Screenshot timers clear and are gated by component ID/version. The reveal animation is finite. Dynamic module loading ignores stale completion. The component store caps count at 64, source at 64 KiB, and declarations at eight. Component network calls already have a 20-second abort timeout and one-MiB response cap; those limits do not themselves impose a concurrency queue.
- Visual-frame loading clears its timeout and ignores stale reads. Its message listener removes cleanly. The generated resize observer posts only changed heights. The visual store retains at most 64 documents, each validated to 96 KiB. Export creates a hidden BrowserWindow and destroys it in `finally` on normal completion or failure.
- File preview listeners remove on unmount, changing/closing the requested preview invalidates stale reads, and the HTML preview iframe disables scripts. No object-URL creation occurs in these inspected renderer files, so there is no missing revoke path here.
- Mermaid rendering depends on stable ID and source text, ignores stale completion, and clears the mounted SVG on a reported render error. Unchanged parent props do not resubmit the diagram render. The lazy module remains loaded once imported, as expected for an application dependency.
- Artifact/component protocols serve stored HTML/JavaScript directly. No repeated host compiler or transpiler runs in those protocol handlers.

## Limits

Authored iframe scripts and user-built components may intentionally run timers or polling while mounted; this audit does not claim those workloads have a global CPU budget. Once a diagram render or export starts, existing cleanup does not make arbitrary user-authored JavaScript cancellable. No reachable additional high-priority stall or retained-resource leak was demonstrated in those paths, so no speculative iframe lifecycle framework was added. This coverage is source-level inspection, not a heap-retention proof. The separate image queue and viewport-dwell integration were excluded.

## Production-app verification

The coordinator exercised two harmless components in the isolated production Electron app. On the baseline bundle, initial screenshot completion left both at Factory 2 / Mount 2; after clicking component A twice and B three times, toggling A's fullscreen metadata remounted both at Factory 3 / Mount 3 and reset both click counts to zero. With the checked wave-sixteen bundle, both stayed at Factory 1 / Mount 1 through initial screenshots and the metadata toggle; A retained 2 clicks and B retained 3. The widgets used no network, secrets, or timers. This confirms the effect on real component state, beyond the synthetic 64-widget operation-count test.

# Historical Markdown image loading

## Confirmed fix

P1: opening photo-heavy history eagerly requested a preview for every mounted Markdown image, including images far outside the viewport. `MessageBody` renders `Markdown`; `parseBlocks` creates image spans for supported local image links; `Spans` mounts `Picture` for each. `Picture` called `window.shinbo.previewPath` immediately from its path effect. The conversation's `content-visibility: auto` avoids some browser layout work but does not prevent mounted React effects, so all of those IPC requests still happened.

`Picture` now observes its clickable fallback with a 400 px viewport margin and starts the preview request after remaining near the viewport for 100 ms. Leaving before then cancels the pending request. It disconnects the observer when loading begins and retains the loaded image while scrolling. Path changes create a fresh observer, immediately stop displaying the previous path's image, and ignore stale responses. Unmount cancels the dwell timer, disconnects, and prevents late state updates. Environments without IntersectionObserver keep the previous eager behavior.

This follows the existing artifact-grid observer pattern. Its private hook could not be imported directly without a circular dependency because `artifacts.tsx` already imports Markdown. The grid also deliberately mounts/unmounts previews on every visibility transition, while a loaded Markdown image should remain available. The small observer is therefore placed inside Picture's existing request effect rather than introducing a shared abstraction or cache.

## Measured request counts

Exact pre-edit source is `/tmp/shinbo-markdown-image-audit/markdown.tsx`. The test parses 100 supported local-image Markdown messages and executes the actual Picture functions/effects with a deterministic observer harness.

| Workload | Before | After |
| --- | ---: | ---: |
| Mounted historical pictures | 100 | 100 |
| Preview requests before intersection | 100 | 0 |
| Total requests after six pictures become near-viewport | 100 | 6 |
| Extra requests from unchanged rerenders and reentry | 0 | 0 |

Reproduce:

```sh
SHINBO_MARKDOWN_IMAGE_BASELINE=/tmp/shinbo-markdown-image-audit/markdown.tsx node --test desktop/test/markdown-image-performance.test.mjs
```

The regression tests also verify fallback click, Enter, and Space actions; image alt/title/click behavior; failed previews; missing IntersectionObserver; path changes while requests are pending; no stale image after a path change; observer cleanup; and no late update after unmount. Renderer typecheck and scoped ESLint passed.

## Smooth-navigation integration correction

Native validation found that a cold jump to the first prompt landed correctly within approximately 1.5 seconds, but its photo loaded only after 15,679 ms. Immediate intersection requests for photos passed during the animation filled the host's bounded image queue. This is an integration correction to the existing image-loading and host-queue work, not another independently counted issue.

The 100 ms cancellable dwell addresses brief crossings at the renderer request source. It leaves native smooth scrolling and the fallback's immediate click/keyboard action unchanged. The exact source immediately before the dwell change is `/tmp/shinbo-markdown-image-audit/markdown-before-dwell.tsx`.

The deterministic before/after test crosses 99 photos for 40 ms each, then remains at the destination for 100 ms: requests fall from 100 to one, and the destination's queue position changes from 100th to first. It separately asserts that 99 ms does not request a preview, the next millisecond does, and path changes/unmount cancel pending timers.

```sh
SHINBO_MARKDOWN_DWELL_BASELINE=/tmp/shinbo-markdown-image-audit/markdown-before-dwell.tsx node --test desktop/test/markdown-image-performance.test.mjs
```

This count fixture isolates the request-ordering cause; native destination-photo timing after the correction remains with the coordinating agent. Photos genuinely near the viewport for longer than 100 ms can still request previews, and already submitted host jobs are not cancelled by this change.

## Limits

This is an exact IPC request-count comparison, not a native image-decoding latency benchmark. The coordinating agent owns real Electron scrolling and interaction validation. Actual near-viewport counts depend on message geometry. Loaded previews are retained until path change or unmount; this change does not cap decoded-image memory after scrolling through all history. It reduces unnecessary initial requests at their renderer source and does not replace the separate host-side work on asynchronous image processing and bounded request execution.

## Native production interaction check

The coordinator opened a disposable saved thread with 100 historical local-photo messages in the frozen production Electron renderer. The initial DOM contained one loaded image (`Local photo 099`) and 99 clickable deferred paths. Navigating from the last message toward the first passed through intervening messages; afterward 83 images were loaded, 17 remained deferred, and the last image was retained. Clicking loaded `Local photo 004` opened its full-size image preview. This confirms initial deferral and subsequent access, not a fixed six-image bound: long smooth scrolling can bring many images into the observer margin. The fixture used one held 48 MP source and made no provider request.

The coordinator rebuilt the frozen production app and repeated the cold 100-photo jump with the same held 48 MP image source. The destination photo became fully loaded after 1,842 ms with dwell, compared with 15,679 ms before dwell (88.3% less elapsed time, including the smooth scroll itself). Both runs started at the last message with one loaded preview; the fixed run still had only that preview at 252 ms and reached the destination image at 1,842 ms. This is one paired native interaction check, not a median or a guarantee for all photo collections.

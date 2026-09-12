# Photo-history navigation audit

No source change is proposed from request counts alone. A smooth jump can legitimately intersect many photos on its route: the coordinating agent observed 83 of 100 pictures loaded while moving from the bottom to the first prompt. That does not establish a performance regression.

## Bounded call-flow coverage

`TranscriptRail` maps user-message markers to the corresponding `[data-turn]` article and calls native `scrollIntoView({ behavior: "smooth", block: "start" })`. The tail button calls native `scrollTo` with the current scroll height. Neither starts a custom animation or per-frame React callback. The transcript uses ordinary overflow scrolling and stable scrollbar gutters. Messages use native content visibility with remembered intrinsic sizes. Markdown images retain their natural automatic height; before their preview arrives, they display the keyboard/clickable path fallback.

The transcript's `useTailScroll` handler reads scroll height, scroll position, and viewport height once per scroll event, and preserves the existing React state object unless the near-end result changes. Its ResizeObserver monitors direct transcript children, and its MutationObserver maintains that direct-child subscription set. Observers do not restart during unchanged renders. Resizes scroll to the end only while pinned, then update the near-end result.

`SelectionQuote` also listens for scrolling. Its normal collapsed-selection path exits without a range layout read. For a real noncollapsed selection it reads the selected text and range bounds to position the quote actions. No continuous geometry polling or unrelated document-wide query was found in this path. Composer scroll handlers merely synchronize the text highlight mirror. Other native smooth calls belong to plan/task navigation, outside the photo-history rail path.

## Native measurement

Exact bounded source snapshots are in `/tmp/shinbo-history-navigation-audit/`. `measure.js` is an async DevTools expression for the frozen real app. It finds the first user article and first rail marker, records initial geometry, clicks that actual marker, then samples every 500 ms for at most ten seconds. The result includes target offset from the transcript viewport, scroll position/height, viewport height, loaded image count, pending rendered images, scroll-event count, and time of the final scroll event. It does not install a long-task observer or force layout every frame.

The cold native result landed correctly on turn 0, with its target offset reaching zero by approximately 1.5 seconds. Initial scroll top/height were 41,896/42,595 with one image loaded. At 1.046 seconds, scroll top was 2,011 and total height 74,837 with three images loaded. At 5.056 seconds the scroll top was 16, target offset zero, and 20 images were loaded. At 10.070 seconds the target offset remained zero with 41 images loaded. There were 163 scroll events, the last at 1,492 ms. No landing correction is warranted from this result.

A separate destination-image timing exposed an integration issue: the first photo loaded only after 15,679 ms, behind images briefly intersected during the smooth journey. Samples showed one image at 252 ms, 20 at 5,340 ms, 41 at 10,387 ms, and 62 at 15,428 ms. This is request ordering between the renderer's eager intersection trigger and the bounded host image queue, not incorrect scroll geometry. The coordinating audit is addressing it as a correction to image loading, without counting another independent performance issue. Native smooth motion and accessibility behavior remain unchanged; this result does not justify an instant jump, arbitrary distance threshold, image truncation, or custom scroll correction.

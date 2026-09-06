import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles/conversation.css", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/visual.tsx", import.meta.url), "utf8");

test("visuals use the conversation width without a card or title bar", () => {
  const figure = css.match(/^\.visual \{([^}]+)\}/m)?.[1];
  assert.ok(figure);
  assert.doesNotMatch(figure, /max-width|border|background/);
  assert.match(css, /\.message \{[^}]*max-width: var\(--conversation-column\)/);
  assert.match(css, /\.visual iframe \{[^}]*width: 100%; border: 0/);
  assert.doesNotMatch(view, /<header>|<strong/);
  assert.match(view, /sandbox="allow-scripts"/);
});

test("activity is borderless and respects reduced motion", () => {
  const activity = css.match(/^\.inline-activity \{([^}]+)\}/m)?.[1];
  assert.ok(activity);
  assert.doesNotMatch(activity, /border|background|box-shadow/);
  assert.match(css, /\.inline-activity\[data-running\] \{ animation: activity-pulse/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.inline-activity\[data-running\] \{ animation: none/);
  assert.match(view, /role="status"/);
  assert.match(view, /aria-busy=\{loading\}/);
});

test("visual actions are disclosed on click with hover and keyboard access", () => {
  assert.match(view, /aria-expanded=\{open\}/);
  assert.match(view, /\{open && <div className="visual-options"/);
  assert.match(view, /event\.key === "Escape"/);
  assert.match(view, /onBlur=/);
  assert.match(view, /trigger\.current\?\.focus\(\)/);
  assert.match(css, /\.visual-more \{[^}]*opacity: 0; pointer-events: none/);
  assert.match(css, /\.visual:hover \.visual-more, \.visual-actions:focus-within \.visual-more, \.visual-more\[aria-expanded="true"\]/);
  assert.match(css, /@media \(hover: none\)/);
});

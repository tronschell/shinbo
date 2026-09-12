# Shinbo product film

60 seconds, 3840 × 2160, 30 fps. A Remotion film for Shinbo, the general-purpose metaharness, using all nine supplied dither backgrounds, an original synthesized score, and recordings of the installed application.

## Run

```sh
npm ci
npm run studio
npm run preview
npm run render
npm run check
npm run gif
```

Dependencies are pinned. This checkout currently uses a dependency symlink to the sibling website's installed Remotion package. Run `unlink node_modules` before `npm ci` to install an independent copy. `npm run gif` turns the rendered preview into `shinbo.gif`, the 640 × 360, 8 fps loop the [root README](../../README.md) opens with. Display typography uses macOS Helvetica Neue. Departure Mono is bundled with its license.

## Story

| Time | Scene |
| --- | --- |
| 0–5 | Shinbo's editor and the actual launch-briefing prompt |
| 5–9 | Shinbo's five-step plan and dependencies |
| 9–13 | Sadie and Luca working in parallel |
| 13–18 | NASA opens beside the conversation |
| 18–22 | A real update from Shinbo |
| 22–28 | The generated interactive dashboard |
| 28–37 | Actual model selection, subscription and endpoint settings, animated provider logos |
| 37–41 | Shinbo's plugin catalog |
| 41–48 | An eight-node scheduled workflow with a decision and converging branches |
| 48–55 | Using the generated tool |
| 55–60 | Shinbo's pink bow mark from the app-icon source · shinbo.app |

## Recording provenance

The launch-briefing session was recorded in production Shinbo on September 4, 2026 using the connected GLM Coding Plan. Shinbo wrote a five-step plan, started two real subagents named Sadie and Luca, opened NASA in its docked browser, and returned research and design results. The source recording is `out/raw/launch-briefing.mov`, beginning at 23:40:26 UTC. `out/raw/launch-build.mov` continues the session and captures switching the task to GPT-5.6 Luna on the connected ChatGPT subscription after GLM repeated plan bookkeeping. Luna created the dashboard in 1 minute 28 seconds with three tool calls. `out/raw/launch-finish.mov` records the completion and preview. No agent reply, subagent status, plan result, or browser content was scripted for the film. Waiting is removed through editorial cuts.

The scheduled example, “Orbit · weekly mission intelligence,” is a real task authored through Shinbo's editor. Its eight nodes research updates, classify priority, branch to investigation or a routine digest, verify sources, refresh an artifact, and keep a knowledge-base summary. The graph was dry-run tested and saved with a weekly trigger, then paused. It has not executed an unattended run. The video shows configuration and branching, not fabricated execution results.

The model sequence combines real UI recordings with an animated reel of provider logos copied from Shinbo's existing assets. It distinguishes subscriptions, direct APIs, OpenRouter, and local models. It shows existing subscription sign-in status and the local endpoint presets; it does not claim a newly connected or newly tested local server. Claude subscription support in the installed application uses its CLI, as the UI states.

The earlier Orbit mission-control artifact was genuinely built in Shinbo and remains in the raw archive. Its first build took 4 minutes 19 seconds with four tool calls and zero failed spans. A second real prompt produced its compact version 2. `out/raw/orbit-window.mov` preserves that recording.

The final dashboard is version 2 of `orbit-launch-dashboard`, refined through a second real Shinbo prompt to fit the preview and keep the planet circular. `public/orbit.html` is its generated source, and `out/raw/orbit-final.mov` records playback, speed changes and pause/resume. All telemetry in the demos is fictional. Raw recordings use direct window capture so other applications cannot appear when focus changes. Retina source footage is cropped inside a native 4K composition; typography and motion render at 4K. Rejected area captures are retained outside the source package in `out/rejected/`.

`prepare.mjs` recreates the selected clips using Remotion's bundled FFmpeg. `score.py` synthesizes the original 60-second instrumental without third-party recordings. No voiceover is used. The source ZIP contains the editable composition, selected footage, logos, backgrounds, font and score; it excludes dependencies, renders and raw takes.

This project creates media only and does not publish the film. The sibling website's `social/video/README.md` points here and distinguishes its older scripted demo.

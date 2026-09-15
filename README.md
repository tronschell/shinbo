<div align="center">

<img src="desktop/assets/shinbo.icon/Assets/bow.svg" alt="Shinbo: a pink pixel bow" width="200">

# Shinbo

**A self-learning, self-building metaharness.**

It runs its own agent loop, drives the coding CLIs you already have, writes parts of its own interface, and benches its own changes before keeping them.

The name draws on two Japanese words pronounced **shinbō (しんぼう)**: **[辛抱](https://kotobank.jp/word/辛抱-538951)** means patience and perseverance through hardship; **[心棒](https://kotobank.jp/word/心棒-538949)** means an axle or central shaft, and figuratively the core that supports an activity. For Shinbo, they express persistence in the work and a common center for its agents and tools.

[![Platform](https://img.shields.io/badge/platform-macOS%20·%20Apple%20silicon%20%7C%20Windows%20x64-1c1c1c?style=flat-square&logo=apple&logoColor=white)](#requirements)
[![Electron](https://img.shields.io/badge/Electron-43.4.0-2b2e3a?style=flat-square&logo=electron&logoColor=9feaf9)](desktop/package.json)
[![Rust](https://img.shields.io/badge/Rust-1.97.1-2b2119?style=flat-square&logo=rust&logoColor=e6683c)](rust-toolchain.toml)
[![Zig](https://img.shields.io/badge/Zig-0.16.0-2e2416?style=flat-square&logo=zig&logoColor=f7a41d)](harness/build.zig.zon)
[![Node](https://img.shields.io/badge/Node-24%2B-1f2a1f?style=flat-square&logo=nodedotjs&logoColor=5fa04e)](desktop/package.json)
[![Docs](https://img.shields.io/badge/docs-docs%2F-1c1c1c?style=flat-square)](docs/README.md)

<img src="marketing/video/shinbo.gif" alt="Sixty seconds of Shinbo: a launch-briefing prompt becomes a plan, two subagents work in parallel, a browser opens beside the thread, a dashboard is built, models and workflows are picked, and the pink bow signs off" width="900">

</div>

---

Shinbo works with files, shell commands, browsers, and desktop apps. Add tools through MCP and skills, or delegate to Claude Code, Codex, Pi, OpenCode, and Cursor. Threads, tasks, and plans are saved as Markdown on disk.

<img src="desktop/screenshots/workspace-thread.png" alt="Shinbo workspace with projects, a conversation, and the context bar" width="900">

## Get started

**[Download for macOS or Windows](https://github.com/tronschell/shinbo/releases)**

- **macOS:** Open the DMG and drag Shinbo into Applications.
- **Windows:** Run the installer. Builds are unsigned; in SmartScreen, choose **More info → Run anyway**.

Both platforms update automatically. Choose a provider in **Settings → Models** and add your key, or connect a local model.

### Requirements

macOS 12+ on Apple silicon, or Windows 10 version 1809+ on x64. Windows ARM64 is available from source.

## Plans and subagents

<img src="desktop/screenshots/plan-subagents.png" alt="A task plan with dependencies and subagent progress" width="900">

Break a job into steps and run independent work in parallel. Follow each subagent's progress; blocked steps pause the work that depends on them. [Plans and subagents](docs/concepts.md)

## Permissions

Choose how much the agent can do without asking:

| Mode | Behavior |
|---|---|
| `ask` (default) | Asks before file writes and commands. |
| `acceptEdits` | Allows file edits; asks before commands. |
| `auto` | A verifier reviews gated actions and asks you when it cannot approve. |
| `full` | Runs tools automatically. |

App access still requires approval in every mode. Subagents inherit your choice. Escape stops a computer run. [Permissions](docs/permissions.md)

## The context bar

<img src="desktop/screenshots/settings-context-bar.png" alt="Context bar settings with draggable components and a live preview" width="900">

Arrange plans, agents, Git status, token usage, and system stats across up to four pages. Inspect model requests, tool calls, and timing for each turn. [Context bar](docs/context-bar.md)

## Self-improvement

<img src="desktop/screenshots/agent-dashboard.png" alt="Agent dashboard showing activity, threads, and subagents" width="900">

Shinbo looks for recurring failures, proposes changes to its instructions or verifier rules, and tests them before keeping them. You can revert a change at any time. [Self-improvement](docs/agents.md)

## Quick Ask

<img src="desktop/screenshots/notch-island.png" alt="Quick Ask around the Mac camera notch" width="820">

<img src="desktop/screenshots/notch-radial.png" alt="Quick actions in a ring around the cursor" width="420">

Double-tap **left Option** on macOS or **left Alt** on Windows to ask from anywhere. Quick Ask sits at the Mac's notch or near the top of a Windows display. Run quick actions with **Command/Ctrl-1/2/3** or the ring at your cursor. [Quick Ask and shortcuts](docs/notch.md)

## Knowledge base

<img src="desktop/screenshots/knowledge-base.png" alt="Knowledge base setup with a vault picker" width="900">

Save answers and attachments to an Obsidian vault or any folder. Shinbo titles and tags each Markdown note. [Knowledge base](docs/knowledge.md)

## Workflows

<img src="desktop/screenshots/scheduled-jobs.png" alt="Workflow editor with prompt, schedule, model, and permissions" width="900">

Schedule recurring work, run it manually, or trigger it from an app event or another job. Add steps and conditions for longer workflows. [Workflows](docs/jobs.md)

## Models

<img src="desktop/screenshots/model-picker.png" alt="Model picker with favorites, context lengths, and thinking controls" width="900">

Use any OpenAI-compatible provider, including local models through Ollama, LM Studio, or llama.cpp. Keys are encrypted using the OS credential store.

**Private routing** requires OpenRouter endpoints with no training and zero retention for the main agent. Secondary models and tools use separate routes; a local chat model alone does not make the app offline. [Models](docs/models.md) · [Privacy and routing limits](docs/privacy.md)

## Terminal

Run the same agent from your terminal:

```bash
/Applications/Shinbo.app/Contents/Resources/shinbo-cli ask "explain this repository"
```

On Windows, use `resources/shinbo-cli.exe` in the installed app directory. Run it without arguments for an interactive session. [CLI reference](docs/cli.md)

## Build from source

Install the [required toolchains](docs/getting-started.md#prerequisites), then:

```bash
git clone https://github.com/tronschell/shinbo.git
cd shinbo
npm install --prefix desktop
npm run dev
```

Electron and React provide the desktop interface, Rust stores the data, and a Zig harness runs the agent loop.

Read [AGENTS.md](AGENTS.md) before contributing. See the [development guide](docs/development.md) for checks and packaging, and the [release guide](docs/releases.md) for publishing.

## Documentation

[All docs](docs/README.md) · [Getting started](docs/getting-started.md) · [Tools](docs/tools.md) · [Architecture](docs/architecture.md) · [Troubleshooting](docs/troubleshooting.md)

## Credits and license

Shinbo's harness is forked from [vercel-labs/fx](https://github.com/vercel-labs/fx) (Apache-2.0, © Vercel, Inc. and fx contributors). See [credits](docs/credits.md) for dependencies and licenses.

Shinbo is [MIT licensed](LICENSE), with separate terms for:

| Component | License |
|---|---|
| Harness | [Apache-2.0](harness/LICENSE) · [Fork details](harness/FORK.md) |
| Rust crates | [Apache-2.0](Cargo.toml) |
| Departure Mono | [SIL Open Font License](desktop/assets/DepartureMono-LICENSE.txt) |
| Brand assets | [Asset terms](docs/icon-sources.md) |

# Releasing Shinbo

Shinbo currently targets **macOS 12 or later on Apple silicon** and **Windows 10
version 1809 or later on x64**. GitHub Actions builds it on standard `macos-15`
and `windows-2025` (x64) runners.

## Branches

```text
feature branch → dev → main → published macOS and Windows downloads
```

`dev` is the default branch. Anyone opens feature PRs against it, and every PR
runs `ci` with one required `check` gate. `main` holds released code.
Only the repository owner can update `main`; a GitHub ruleset blocks everyone
else from merging into it.

Feature PRs squash into `dev` and keep strict up-to-date checks. Auto-merge can
finish a feature PR after its checks pass, and merged feature branches are
deleted automatically; protected `dev` and `main` remain. Release PRs go
directly from `dev` to `main` with a merge commit. Main requires passing checks
but does not require dev to contain main's previous promotion merge. This
avoids temporary promotion branches and main-to-dev synchronization PRs. CI
requires the promotion's merged tree to equal dev's tree and its version to be
newer than main's. Resolve any actual main-only changes on dev before releasing.

```sh
git fetch origin
git switch -c feat/my-change origin/dev
gh pr create --base dev
```

## The zvec-grep tools release

`tools.yml` is a separate lane with its own tag namespace. It runs on
`workflow_dispatch` and on pushes to `dev` that touch
`desktop/shared/zvec-grep.ts` or either zvec-grep script, packs the tree on
`macos-15` and `windows-2025`, and publishes
`zvec-grep-<version>-<platform>-<arch>.tar.gz` plus a `.sha256` to a release
tagged `zvec-grep-v<version>`, created with `gh release create --latest=false` so
it never displaces an app release. Assets are re-uploaded with `--clobber`, and
bumping `ZVEC_GREP_VERSION` is what creates the next tag. The app downloads from
that release; `SHINBO_TOOLS_URL` repoints the origin for a local rehearsal.

## Release a version

1. Bump the root `package.json` version in the final feature PR for the release,
   or a small separate PR to `dev`. Use `npm version patch --no-git-tag-version`.
2. Open a `dev` → `main` PR and merge it with **Create a merge commit**.
3. The promotion PR carries the required checks. After it is merged, the push
   to `main` runs `ci` against the exact promoted commit and packages two
   candidates: `package-mac` on `macos-15` and `package-win` on `windows-2025`.
   The successful candidate workflow then triggers `release`, which verifies
   both candidates, signs, notarizes, staples and Gatekeeper-checks the macOS
   app and disk image, and publishes `vX.Y.Z` with the automatically collected
   changelog and both platforms' assets. A manual release dispatch rebuilds and
   publishes macOS only; Windows PE files cannot be produced or signed on the
   macOS release runner.

There is no changelog file, generated release PR, manifest, or tag to manage. The
GitHub Releases page is the changelog. Merging `main` again with an unchanged
version skips packaging as well as publication. A failed release lookup stops
CI rather than treating an API outage as a new version.

## CI cost and coverage

`desktop/scripts/ci-plan.mjs` classifies the actual base-to-merge diff, including
deleted and renamed paths. Only known narrow changes skip suites; unknown paths
run the full checks. The `check` gate rejects failures, cancellations, and an
unexpectedly skipped job.

| Change | Required work |
| --- | --- |
| Renderer source, assets, or HTML | macOS and Windows desktop checks and native builds |
| Documentation or only the root version | Selection tests and the required gate |
| Harness, host, desktop integration, or unknown paths | Both desktop/Rust and Zig lanes |
| Workflow, desktop build script, native helper, or dependency changes | Full checks plus both package/install smoke lanes |
| `dev` to `main` promotion | Full checks, version/tree validation, and both package/install smoke lanes |
| Manual CI dispatch | Full checks; both package lanes when selected |

Packaging builds the native helpers itself, so the parallel desktop lanes do
not build them again. Zig reports compilation and test execution durations on
both platforms. Its build revision is the most recent commit affecting
`harness/`, using full Git history in CI. A UI-only commit or promotion merge
therefore does not invalidate the harness compiler cache. The release manifest
still identifies the exact application source commit, version, and workflow run.

CI and release remain separate. Only push-to-main candidates can feed automatic
publication; PR artifacts never become releases. GitHub's cache isolation also
means a promotion PR's cache is not available to its later main push. The main
build can reuse its own earlier cache when the harness is unchanged, while
rebuilding the application and retaining the installer smoke checks.

## Install smoke test

Both packaging jobs install what they just built and launch it before anything
is uploaded. `package-win` runs the Squirrel installer with `-s`, waits for
`%LOCALAPPDATA%\Shinbo\app-X.Y.Z\Shinbo.exe` and `Update.exe`, confirms the Start
Menu shortcut, and finishes with `Update.exe --uninstall -s`. Squirrel cannot
delete the `Update.exe` it is running from, so it marks the install root with a
`.dead` file and hands the removal to the next reboot; the step therefore
requires the updater to exit zero and the versioned directory to be either gone
or marked dead. `package-mac` mounts the disk image with
`hdiutil attach -nobrowse -readonly`, copies `Shinbo.app` into `RUNNER_TEMP`,
detaches, and deletes the copy afterwards. The unsigned copy is launched through
`Shinbo.app/Contents/MacOS/Shinbo` rather than `open`, so Gatekeeper never gets a
say.

Both then run [`install-smoke.mjs`](../desktop/scripts/install-smoke.mjs), which
starts the installed binary with a scratch `SHINBO_DATA_DIR`, `--user-data-dir`
under `RUNNER_TEMP`, and `SHINBO_REMOTE_DEBUG=1`, reads the real port out of
`DevToolsActivePort` because a packaged build listens on `remote-debugging-port=0`
only when that variable is set, checks `/json/version` and `/json/list`,
requires a page target ending in `dist-renderer/index.html`, evaluates
`document.querySelector(".app-shell")?.className` over the DevTools WebSocket,
saves a `Page.captureScreenshot`, and quits the app. Every wait is bounded, and
the runners have no GPU so the app is started with `--disable-gpu`. The
screenshots upload as the `install-smoke-macos` and `install-smoke-windows`
artifacts.

Packaging does not run on pull requests against `dev`, so dispatch it by hand to
exercise a packaging or installer change before promoting:

```sh
gh workflow run ci.yml --ref my-branch -f package=true
```

That runs `package-mac` and `package-win`, with the smoke test, against the
dispatched ref. The pull request gates are untouched by a dispatch.

## Automatic changelog

The existing release job runs [`release-notes.mjs`](../desktop/scripts/release-notes.mjs)
before building. It compares the most recently published stable release with the
exact commit being released. Drafts, prereleases, and unpublished tags do not
move that starting point. GitHub supplies the commit range with pagination, so
changes merged through `dev` and direct commits are included even in large
releases. Promotion merge commits do not become changelog entries.

Conventional titles group entries into Breaking changes, Features, Fixes,
Performance, Documentation, and Other changes. Each entry links to its PR or
commit and credits its author. Its committed `## Release notes` section supplies
the detailed bullets; older commits without that section use their titles.
Breaking-change footers retain their migration instructions. A full comparison
link connects the previous release to the exact source commit.

The [contribution skill](../.claude/skills/contributing/SKILL.md) routes agents to
the [release skill](../.claude/skills/releasing/SKILL.md) to write these summaries
as part of normal PR preparation. Shinbo's squash-merge settings already preserve
the PR title and body. There is no release-time collection or editing step for
the owner. A GitHub API failure stops the job before publication.

To preview the remote `dev` changelog with an authenticated GitHub CLI:

```sh
npm run release:notes
```

Optional arguments select a previous release and target GitHub ref, for example
`npm run release:notes -- v0.3.1 v0.4.1`. This prints Markdown without publishing
or changing anything. References resolve on GitHub, independent of local tags.

## Downloads and updates

Every release publishes macOS Apple silicon and Windows x64 assets to
[GitHub Releases](https://github.com/tronschell/shinbo/releases).

macOS:

- `Shinbo-vX.Y.Z-darwin-arm64.dmg`
- `Shinbo-vX.Y.Z-darwin-arm64.dmg.sha256`
- `Shinbo-vX.Y.Z-darwin-arm64.zip`
- `Shinbo-vX.Y.Z-darwin-arm64.zip.sha256`

Windows:

- `Shinbo-vX.Y.Z-win32-x64-Setup.exe`
- `Shinbo-X.Y.Z-full.nupkg`
- `RELEASES`
- `Shinbo-vX.Y.Z-windows-x64.sha256`

The disk image is the human download: open it and drag Shinbo onto the
Applications alias on the right. The centered Finder window uses Shinbo's rose
dither background, a drag instruction, and the root package version at the
bottom. `scripts/dmg-mac.mjs` draws the background at standard and Retina
resolution with macOS AppKit, then saves the icon positions and window geometry
with `ds_store` and `mac_alias`. The build needs Python 3.10 or later and installs
these two checksum-pinned build dependencies in a temporary virtual environment.
Packaging CI builds the image and verifies its layout, Retina artwork, and
background reference after remounting. The release job rebuilds it from the
stapled app, then signs, notarizes and staples the image itself.

Installing into Applications is not cosmetic. Squirrel replaces the bundle it
is running from, so a copy left in Downloads updates itself and leaves the one
in Applications behind. Worse, a browser marks that copy with the quarantine
attribute, and macOS runs a quarantined app the user never moved from a
read-only translocated path, where Squirrel cannot write at all and updates can
never apply.

The package includes its Rust host, Zig harness, ripgrep, native helpers,
bundled skills, and dependency notices. End users do not need Node, Rust, Zig,
or Xcode installed.

The release title is exactly `vX.Y.Z` and the stable `darwin-arm64.zip` asset
is the one the `update.electronjs.org` feed selects on macOS. Keep both, and
keep publishing the zip whatever else ships beside it.

On macOS, a packaged app checks the feed at launch, on a five-minute tick, when
the machine wakes, and when a window takes focus, with any check inside thirty
minutes of the last one skipped. Wake and focus matter because a sleeping Mac
suspends the timer, so a window left open for days would otherwise never check
again. **Check for Updates…** in the Shinbo menu forces one past that gap and
reports the result either way. Squirrel downloads a newer eligible version in
the background, and Shinbo shows **Update ready · X.Y.Z** with **Install and
relaunch** once the download finishes.

The downloaded version is recorded in `update-ready.json` under the user data
directory, so quitting no longer forgets it and the notice returns on the next
launch. Squirrel can only install an update this process downloaded, so
installing from a restored notice re-downloads first and then relaunches. The
record is deleted once the running version is no longer older than it. The
unpackaged `SHINBO_UPDATE_FAKE` mode only exercises the notice.

On Windows, the Setup executable is a Squirrel installer. It installs per user
under `%LOCALAPPDATA%\Shinbo`, needs no administrator prompt, and the same
`update.electronjs.org` feed serves it. There is no wizard: it shows one 420x260
splash for about twenty seconds and then launches Shinbo, and
[`installer-splash.mjs`](../desktop/scripts/installer-splash.mjs) writes that
committed `desktop/assets/installer/shinbo-setup.gif` from the disk image's own
palette, Bayer dither, bow mark and pixel type. Squirrel sizes the splash window
to the GIF and shows it at 1:1, so rerun the script and commit the result after
changing the artwork. Squirrel appends `/RELEASES` to the feed URL, and the feed
answers with the `RELEASES` asset of the newest published
`vX.Y.Z` release, rewriting the package name inside it into the full GitHub
download URL of the matching `.nupkg`. Three asset rules follow from that and
the release job enforces them:

- The installer is the only asset whose name contains `-win32-x64`. The feed
  picks the first asset matching that pattern as the Windows x64 release, so the
  Windows checksum file is named `-windows-x64.sha256`, not `-win32-x64.sha256`.
- The `.nupkg` keeps the exact name Squirrel wrote, including its unprefixed
  `X.Y.Z` version. The feed rewrites the name it reads out of `RELEASES` into a
  download URL, so a renamed package resolves to a 404.
- `RELEASES` is published byte for byte, and CI produces exactly one full
  package per release. The feed rewrites only the first package it finds, so a
  delta package listed beside it would not resolve. The release job fails if
  more than one `.nupkg` is present or if `RELEASES` names a different file.

Drafts, prereleases, non-semver tags, and a private repository are all invisible
to the feed on both platforms.

**Windows builds are not code signed today.** The repository holds no Windows
certificate, so SmartScreen shows "Windows protected your PC" on the installer;
users click **More info** and then **Run anyway**. The published
`Shinbo-vX.Y.Z-windows-x64.sha256` file is how a download is checked in the
meantime. `update.electronjs.org` does not require Windows Squirrel builds to
be signed, so auto-update works unsigned.

Signing turns on with no workflow change once two repository secrets exist:

| Secret | Value |
| --- | --- |
| `WINDOWS_CERT_PFX_BASE64` | Base64-encoded code signing certificate and private key exported as `.pfx` |
| `WINDOWS_CERT_PASSWORD` | Password used when exporting that `.pfx` |

The `package-win` job decodes the certificate into `RUNNER_TEMP`, passes its
path to `package:win` as `WINDOWS_CERT_PFX`, and deletes it in a step that runs
even when the job fails. Signing happens on the Windows runner because the
macOS release runner cannot sign Windows PE files. Only the push to `main`
stages the certificate; pull request runs never receive either secret and always
package unsigned. `WINDOWS_TIMESTAMP_SERVER` and `WINDOWS_SIGNTOOL_PATH`
override the DigiCert timestamp server and `signtool.exe` discovery when needed.

## Signing credentials

Keep these in repository Actions secrets, never in source or artifacts. The
macOS credentials below are required; the optional Windows pair is described
under [Downloads and updates](#downloads-and-updates):

| Secret | Value |
| --- | --- |
| `MACOS_CERT_P12` | Base64-encoded Developer ID Application certificate and private key exported as `.p12` |
| `MACOS_CERT_PASSWORD` | Password used when exporting that `.p12` |
| `APPLE_API_KEY_P8` | Base64-encoded App Store Connect team API private key |
| `APPLE_API_KEY_ID` | The API key ID |
| `APPLE_API_ISSUER` | The API key's issuer ID |

The release job fails before compiling if a required secret is missing. It
signs after locale trimming and removes its temporary certificate, private key,
and keychain on exit. PR checks never receive signing secrets.

## Local verification

Run the six checks in [`AGENTS.md`](../AGENTS.md), then:

```sh
npm run package:mac
```

On a native Windows x64 host:

```powershell
npm --prefix desktop run package:win
```

macOS packaging needs full Xcode for `actool`, not only the Command Line Tools.
`DEVELOPER_DIR` can select another Xcode installation. Both package scripts
stamp the root version into the copied app without changing
`desktop/package.json`, include only compiled runtime files in `app.asar`, and
generate dependency notices, then verify the bundle's version, executables,
architecture, and native helpers.

Use another output directory to avoid replacing a running development bundle:

```sh
npm --prefix desktop run package:mac -- /tmp/shinbo-release-check
```

Launch the resulting app with an isolated profile and data directory and
exercise the workspace before release. A local unsigned package does not prove
signing, notarization, Gatekeeper acceptance, or update installation.

## Recovery

Rerun a failed `release` workflow after correcting the cause. Nothing is
published until every step succeeds, so a rerun is safe. Never edit a published
release's assets. If the source must change, land the fix on `dev`, bump the
version, and promote again.

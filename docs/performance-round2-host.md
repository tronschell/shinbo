# Round 2: Rust persistence codec

## One new P1 fix

The Markdown persistence codec rebuilt every message and trace character by character even when nearly all bytes needed no escaping. That work runs on cold thread/library reads and every complete atomic rewrite after a turn, trace, goal, archive, or title update. In the supported large-history fixture below, the codec contributed more than 100 ms of synchronous host-runtime work. Other host requests wait behind that work.

`append_quoted` now copies unchanged UTF-8 spans in bulk and emits only the five existing escapes individually. `unquote` finds escape delimiters, copies intervening spans, and reserves its output once. Both remain in `crates/core/src/record.rs`; no new format, dependency, persistence policy, or protocol was introduced. ASCII escape positions are valid UTF-8 slice boundaries, and invalid or incomplete escapes still fail.

**This is one root-cause fix**, with read and write measurements below. It does not recount the prior selected-thread cache, compact-summary cache, read-copy, or response-envelope fixes. The cold parser and atomic save codec remained slow in the round-two baseline after all of those changes.

## Paired A/B measurements

The new ignored fixture is `crates/core/tests/codec_performance.rs::benchmark_persisted_transcript_codec`.

It builds 1,000 alternating user/assistant messages, each 59,100 ASCII bytes with paragraph line breaks: **59,100,000 content bytes** and **59,280,681 persisted Markdown bytes**. Each message is below the 64 KiB message limit; pairs also fit the host's recorded-turn request budget. The message count is below the 1,024-record cap. This is a deliberately large supported conversation, not a typical-conversation claim.

Both builds use the identical fixture. It asserts the complete encode/decode round trip before timing, then measures five repetitions of each operation and reports the median. Decode reconstructs a fresh `Thread` every time, so parsed-record and summary caches cannot mask the codec cost. The atomic-save case includes the existing temporary-file write, `sync_all`, atomic rename, metadata read, and parsed-cache copy.

| Operation | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Encode complete transcript | 121.011 ms | 49.802 ms | 58.8% |
| Cold decode complete transcript | 171.882 ms | 58.767 ms | 65.8% |
| Complete atomic save, including sync and cache | 151.272 ms | 77.537 ms | 48.7% |

User impact: reopening a long saved conversation spends about 113 ms less in the parser in this fixture, and persisting a completed turn or trace spends about 74 ms less in the complete save operation. The codec improvement also applies to cold library projection and scheduled-record persistence through their existing callers. These are local optimized-build measurements from a shared macOS development machine, not a claimed overall application or model-generation speedup. Filesystem latency and concurrent machine load remain variable.

## Exact reproduction

The baseline is the dirty source supplied for this round, `/tmp/shinbo-perf-round2/source.tar`. Only the identical benchmark file is copied into the extracted baseline; its production codec remains unchanged.

```sh
mkdir -p /tmp/shinbo-perf-round2-host-before
tar -xf /tmp/shinbo-perf-round2/source.tar -C /tmp/shinbo-perf-round2-host-before Cargo.toml Cargo.lock crates
cp crates/core/tests/codec_performance.rs /tmp/shinbo-perf-round2-host-before/crates/core/tests/codec_performance.rs
cargo test --manifest-path /tmp/shinbo-perf-round2-host-before/Cargo.toml -p shinbo-core --release --locked --test codec_performance -- --ignored --nocapture
cargo test -p shinbo-core --release --locked --test codec_performance -- --ignored --nocapture
```

The measured runs were sequential, with raw results in `/tmp/shinbo-round2-codec-before.txt` and `/tmp/shinbo-round2-codec-after.txt`. Test setup and the initial correctness comparison are excluded from each printed operation timer. The fixture removes its generated store after completion.

## Regression coverage and scope

`record::tests::quoted_spans_preserve_adjacent_escapes_and_unicode_boundaries` checks multibyte text next to escapes, adjacent backslash/quote/newline/carriage-return/tab escapes, a trailing literal backslash, doubled backslashes, malformed quoted input, unsupported escapes, and truncated escapes. Existing large quote round trips and persistence validation tests remain applicable. The codec's five-escape grammar and validation outside the codec are unchanged.

Focused validation commands:

```sh
cargo test -p shinbo-core --locked
cargo test -p shinbo-host --locked --test persistence_regressions
cargo clippy --workspace --locked --all-targets -- -D warnings
cargo fmt --all -- --check
```

All focused checks passed: 42 core tests, six compiled-host persistence regressions, clippy, and formatting. Measurement fixtures remain explicitly ignored during ordinary tests.

Owned changes for this round: the two codec functions and their regression in `crates/core/src/record.rs`, the new `crates/core/tests/codec_performance.rs` fixture, and this report. Other concurrent changes and all earlier performance fixes are preserved. No commit was created. Real Electron interaction and the full integrated checks remain with the coordinator.

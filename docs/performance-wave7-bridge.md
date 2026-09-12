# Slow mobile bridge consumer audit — 2026-09-12

## Implemented finding: P1 outgoing WebSocket queues have no byte bound

The Electron bridge passed every encrypted event and response directly to `ws.send`. The existing 1 MiB limit applies to each frame, not the aggregate WebSocket send queue. A phone that stops reading can therefore make Electron retain many individually valid frames until a network error or heartbeat failure closes the connection. The thirty-second heartbeat permits a substantial accumulation before detecting a missing pong; it is not a queued-byte budget.

The actual producers include per-chunk `shinbo:delta` broadcasts, agent/span updates, permission events, live state after greeting, and asynchronous request responses. Main broadcasts enter the bridge only while it has an authenticated sender. Phone lists have their own response budgets and frames are encrypted separately for each peer, but neither boundary bounded the sum of pending sends. No source rate limit guarantees that this backlog stays small.

The fix adds a 4 MiB per-session queued-byte budget, allowing several maximum-sized frames and ordinary bursts. It checks the socket/session and current backlog before frame encryption, then checks the sealed frame's actual byte length before sending it. Greeting replies and heartbeat data use the same send helper. An over-budget session is terminated and removed, releasing its queue and heartbeat; other sessions continue. Asynchronous send failures also remove only the failed session.

The limit applies to application data admitted to the transport using `ws.bufferedAmount`; WebSocket framing adds small transport overhead. No event is silently dropped from an otherwise continuing encrypted stream. An overloaded connection closes, and its replacement negotiates fresh codec state using the existing protocol.

## Measured A/B

`desktop/test/bridge-backpressure.test.ts` executes the actual bridge source with actual `FrameCodec` authentication and AES-GCM framing. Its deterministic socket adapter either consumes/decrypts every frame or retains every submitted buffer and exposes their total as `bufferedAmount`, modeling a socket whose writable side does not drain. It uses two verified disposable peers and an in-flight request. No real phone, provider, account, or network connection is used by this fixture.

The same fixture offers 1,000 events containing 64 KiB of text, all below the existing per-frame limit, to one blocked peer and one healthy peer. This is an accelerated producer workload, not a claim that a typical model emits 64 KiB token chunks or sustains the measured test rate. It establishes the missing aggregate resource bound and verifies isolation between peers.

| Observation | Frozen baseline | Fixed |
|---|---:|---:|
| Offered events | 1,000 | 1,000 |
| Text bytes per event | 65,536 | 65,536 |
| Maximum encrypted bytes retained by blocked sink | 65,632,471 | 4,135,216 |
| Bytes retained after workload | 65,632,471 | 0 |
| Blocked socket terminations | 0 | 1 |
| Events received/decrypted by healthy peer | 1,000 | 1,000 |
| Healthy socket terminations | 0 | 0 |

Maximum queued encrypted payload fell by 93.7%; subsequent output is not accumulated for the removed socket. The P1 rating is for unchecked application memory growth caused by an ordinary transport failure, not for measured typical-phone throughput. Native kernel buffer sizes and device-specific disconnect timing were not benchmarked.

## Recovery and regression coverage

The second fixture sends five bursts of 32 × 64 KiB events and drains between bursts. All 160 encrypted events remain ordered and readable, and that peer stays connected. An injected asynchronous send callback failure removes only that socket; the other peer still receives later events.

The blocked-peer fixture also verifies that:

- Completion of a request already in flight does not queue a reply on the removed socket.
- Removing the laggard clears its heartbeat while retaining the healthy peer's heartbeat and the bridge address watcher.
- A replacement authenticated session receives current partial output and a pending permission ask through the existing live-state event, then receives fresh deltas. A late send failure from the replaced socket cannot disconnect it.
- Stopping the bridge clears the remaining intervals.

The current phone implementation in `shinbo-mobile/src/net/client.ts` already schedules reconnect after socket close, restarts its codec, and greets again. Its `abandon` path rejects outstanding reads as not sent; callers may retry them. An interrupted write is reported as uncertain because the Mac may already have executed it. This fix does not cancel dispatched work, silently repeat mutations, or replay responses onto a new socket. Existing client-ID deduplication remains unchanged. Pending permission asks are retained for live-state resynchronization until resolved or expired.

No permission, authentication, pairing persistence, payload schema, or protocol version changed, so no phone code change was needed.

## Reproduction and validation

Exact baseline: `/tmp/shinbo-perf-wave7-bridge/bridge.baseline.ts`.

```sh
./desktop/node_modules/.bin/tsc -p desktop/tsconfig.main.json --outDir /tmp/shinbo-perf-wave7-bridge/compiled
SHINBO_BRIDGE_SOURCE=/tmp/shinbo-perf-wave7-bridge/bridge.baseline.ts node --test --test-name-pattern='blocked phone' /tmp/shinbo-perf-wave7-bridge/compiled/test/bridge-backpressure.test.js > /tmp/shinbo-perf-wave7-bridge/baseline-final.log 2>&1
node --test /tmp/shinbo-perf-wave7-bridge/compiled/test/bridge-backpressure.test.js > /tmp/shinbo-perf-wave7-bridge/fixed-final.log 2>&1
node --test /tmp/shinbo-perf-wave7-bridge/compiled/test/bridge.test.js
cd desktop
./node_modules/.bin/eslint main/bridge.ts test/bridge-backpressure.test.ts --max-warnings 0
```

The isolated compiled directory uses a node_modules link to desktop dependencies and a sibling main link to current desktop/main for source-reading tests. The baseline command intentionally exits 1 on the queue-bound assertion and prints its measurements. The fixed command passes both tests. Main compilation and focused lint pass.

All 35 existing bridge tests also passed using disposable localhost sockets and temporary pairing stores, with sandbox approval for local listening. Those tests cover the authentication/PIN boundary, replays, encrypted reconnection, per-peer keys and revocation, permission handling, framing limits, address changes, request deduplication, and interrupted pairing. No real phone or account calls were made.

No main.ts change was needed. Cross-window renderer broadcasts, oversized live-state preparation, and cancellation of arbitrary in-flight requests were inspected but not changed or counted as additional findings. The parent audit owns integrated UI verification; this change was validated at the actual transport/protocol boundary.

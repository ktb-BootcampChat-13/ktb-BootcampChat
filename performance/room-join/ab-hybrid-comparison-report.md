# Room Detail and REST Join A/B/hybrid comparison

Date: 2026-08-11 (Asia/Seoul)

Base: `upstream/master` (`f28a62e`)

A: repository atomic update and full-document `findAllById` (`af5cf9c`)

B: service-level conditional atomic update and projected user lookup (`f28a62e`)

Hybrid: working tree after resolving the master merge

## Method

A and B were built from the same `upstream/master` base in isolated worktrees. Room Detail used
10/100/500 participants with 1,000 recent messages. REST Join used `p10-m1000`, `p500-m1000`, and
`p10-m100000` fixtures in idempotent and new-participant modes. Every condition ran at 1/10/50 VU
for 10 seconds, three times. The hybrid repeated the same matrix three times.

Across 243 matrix runs, all HTTP and JSON contract checks passed with error rate 0 and zero
timeouts. A/B/hybrid completed 295,445 / 112,253 / 319,041 measured requests respectively.

## Room Detail median results

| Participants | VU | A p95 (ms) | B p95 (ms) | Hybrid p95 (ms) | Hybrid p99 (ms) |
|---:|---:|---:|---:|---:|---:|
| 10 | 1 | 8.21 | 13.68 | 3.48 | 5.78 |
| 10 | 10 | 16.64 | 27.72 | 8.14 | 15.06 |
| 10 | 50 | 31.81 | 92.36 | 45.09 | 93.45 |
| 100 | 1 | 5.33 | 38.06 | 4.39 | 6.67 |
| 100 | 10 | 12.84 | 102.08 | 10.63 | 15.19 |
| 100 | 50 | 45.28 | 472.93 | 53.91 | 82.11 |
| 500 | 1 | 7.57 | 194.29 | 6.75 | 8.52 |
| 500 | 10 | 46.90 | 518.77 | 15.83 | 20.46 |
| 500 | 50 | 83.53 | 1,589.98 | 103.27 | 167.52 |

A's single lookup removes B's participant-count N+1 behavior in every condition. The hybrid keeps
that batching and adds the measured Join projection; its 500-participant/50-VU p95 remains 93.5%
below B. The 10- and 100-participant/50-VU hybrid values are within 20% of A while processing a
similar or larger request count.

## REST Join representative median results

| Fixture/mode | VU | A p95 (ms) | B p95 (ms) | Hybrid p95 (ms) | Hybrid p99 (ms) |
|---|---:|---:|---:|---:|---:|
| p10-m1000 idempotent | 1 | 20.79 | 23.76 | 20.50 | 29.16 |
| p10-m1000 idempotent | 50 | 15.11 | 17.55 | 22.42 | 39.93 |
| p10-m1000 new participant | 50 | 30.72 | 45.74 | 26.14 | 26.52 |
| p500-m1000 idempotent | 50 | 61.18 | 29.57 | 44.96 | 107.08 |
| p500-m1000 new participant | 10 | 57.25 | 28.28 | 22.74 | 23.26 |
| p500-m1000 new participant | 50 | 124.78 | 75.42 | 48.79 | 52.92 |
| p10-m100000 idempotent | 10 | 26.35 | 23.85 | 21.98 | 30.37 |
| p10-m100000 idempotent | 50 | 18.83 | 18.46 | 25.32 | 74.44 |

The projected lookup is retained because it materially improves the participant-heavy write path:
hybrid p95 is 60.9% below A and 35.3% below B for `p500-m1000`, new participant, 50 VU. The
conditional query and fallback are also retained because they prevent duplicate mutation events
under concurrent joins without adding a normal-path Mongo command.

The original `p10-m100000` new-participant/50-VU hybrid median was 108.70 ms. A clean-process
recheck produced 133.72/87.39/67.17 ms. B was rechecked immediately in the same environment and
produced 139.28/87.56/41.55 ms; the nearly identical medians show a shared environment/fixture
variance rather than a hybrid-only regression.

## Decision and observability

The adopted hybrid uses JWT `userId`, one projected user lookup, repository-owned conditional
`findAndModify`, a latest-Room fallback for a lost concurrent race, one response object, and event
publication only when a participant was added. Room Detail keeps participant order, omits missing
participants, and preserves the missing-creator error.

Actuator snapshots confirmed one Room find, one projected User find, and one message aggregate per
measured request, with one `findAndModify` only for new participants. Mongo checkout failures and
wait-queue size remained zero. CPU and heap were captured as before/after snapshots rather than
time-series peaks, so this run does not claim peak-resource non-regression.

Raw run summaries and medians are stored in:

- `performance/room-detail/results/ab-hybrid-comparison-20260811.json`
- `performance/room-join/results/ab-hybrid-comparison-20260811.json`

## Regression verification

- Backend Maven suite: 233 tests, 0 failures, 0 errors, 8 environment-dependent skips
- Room Join load-test tool Jest suite: 5 tests passed
- k6 script inspection: Room Detail, repeated Join, and mutation Join scripts passed
- All 243 A/B/hybrid matrix runs: error rate 0, timeout 0

The recent-message aggregate decision remains unchanged: its measured Mongo-time share was 17.89%,
below the 20% counter threshold, so the exact 30-minute query and compound index are retained.
Socket.IO Join remains an independent follow-up that can reuse the atomic repository operation.

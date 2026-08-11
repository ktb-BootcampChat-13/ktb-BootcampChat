# Room Detail API standalone bottleneck result

## Run metadata

- Test ID: `room-detail-20260811`
- Target: local-only `http://localhost:15001`; MongoDB, Redis, Prometheus, and Grafana ran in local Docker
- Commit: `ce107855630f5ca543228d08ba6330a6fe96ad95` (`upstream/develop` at test start)
- Measured endpoint: `GET /api/rooms/{roomId}` only; login was performed in k6 `setup` and excluded from custom metrics
- Measurement window: 2026-08-11 13:56:31–14:21:20 KST
- Fixture matrix: full 3 × 3 combination of 10/100/500 participants and 1k/10k/100k recent messages
- Contract checks: HTTP 200, `success=true`, exact room ID, exact participant count/list size, and exact recent-message count
- Saturation: error rate over 1%, p95 over twice Smoke, timeout, or Mongo wait queue; later VU stages were skipped after saturation

## Load results

| Participants | Messages | Smoke p95 / RPS | Saturation VU | Saturation avg / p95 / p99 / max (ms) | RPS | p95 ÷ Smoke | Error / timeout |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1k | 15.84 / 98.69 | 30 | 58.60 / 77.72 / 117.23 / 614.04 | 509.58 | 4.91× | 0% / 0 |
| 10 | 10k | 13.47 / 92.53 | 10 | 68.21 / 84.43 / 99.21 / 155.43 | 146.13 | 6.27× | 0% / 0 |
| 10 | 100k | 40.67 / 27.87 | 10 | 670.93 / 742.35 / 776.24 / 840.21 | 14.88 | 18.25× | 0% / 0 |
| 100 | 1k | 54.04 / 24.04 | 10 | 113.22 / 172.12 / 325.13 / 701.47 | 88.02 | 3.18× | 0% / 0 |
| 100 | 10k | 45.52 / 24.75 | 10 | 119.19 / 188.81 / 285.81 / 429.39 | 83.61 | 4.15× | 0% / 0 |
| 100 | 100k | 89.34 / 14.21 | 10 | 654.59 / 762.45 / 877.15 / 986.08 | 15.24 | 8.53× | 0% / 0 |
| 500 | 1k | 306.37 / 5.13 | 10 | 496.47 / 765.54 / 859.55 / 923.61 | 20.08 | 2.50× | 0% / 0 |
| 500 | 10k | 267.20 / 5.12 | 10 | 440.78 / 556.43 / 993.40 / 1459.47 | 22.60 | 2.08× | 0% / 0 |
| 500 | 100k | 240.25 / 4.99 | 10 | 876.74 / 1305.58 / 1536.10 / 1655.47 | 11.36 | 5.43× | 0% / 0 |

The 10-participant/1k condition passed 10 VU (p95 25.61 ms, 541.18 RPS) and saturated at 30 VU. Every other condition saturated at 10 VU, so no disallowed later stages were run.

## Query and application diagnosis

1. Recent-message count is a collection scan. The only message index was `_id_`. Every explain used `COLLSCAN`, with `totalKeysExamined=0`. `nReturned` was exactly 1k/10k/100k and `totalDocsExamined` was 1,033–1,053 / 10,033–10,053 / 100,033–100,053; the small excess is unrelated pre-existing/local-worker data. Explain execution time rose from about 2 ms to 27–30 ms at 100k.
2. Participant mapping is an N+1 query. Each detail request calls one creator `findById` plus one `findById` per participant: 11, 101, and 501 user finds per request. Prometheus range estimates were about 11.1, 103.2, and 513.0 because counter `increase()` extrapolates across scrape boundaries, while source inspection confirms the exact 11/101/501 pattern. The message aggregation remained approximately one command per request.
3. Response/serialization cost grows with participants. Mean response size was about 1.75 KB, 14.54 KB, and 72.54 KB for 10, 100, and 500 participants. At 500 participants this cost and N+1 dominate enough that Smoke p95 variance masks a monotonic message-size trend.
4. Request-path logging is a separate fixed application bottleneck. Wildcard CORS configuration logs a multi-line warning for every request. The isolated process emitted about 369 MB of console output during the run, adding synchronous formatting/output pressure unrelated to fixture axes.

## Representative observability

For the worst fixture at 10 VU (500 participants, 100k messages):

- URI timer: average 867.49 ms, max 1,655.14 ms.
- Process CPU max: 24.9%; live threads max: 37.
- Heap peak: 131,452,400 bytes (about 125.4 MiB); GC pause sum: about 0.152 s over the stage.
- Mongo user-find average/max: 0.870/187.32 ms.
- Mongo message-aggregate average/max: 405.00/939.82 ms.
- Mongo checked-out connections max: 9; wait queue max: 0; checkout failures: 0.
- A wait queue max of 1 was observed at 100 participants/1k messages and 100 participants/10k messages at 10 VU; checkout failures and timeouts remained zero.

## Conclusion and next experiments

There are two independent scale-sensitive bottlenecks plus one fixed request-path overhead:

- Message axis: missing `{room: 1, timestamp: 1}` index causes linear document scanning and dominates the 100k-message conditions.
- Participant axis: participant-by-participant `findById` causes linear Mongo command amplification and dominates 100/500-participant conditions.
- Constant overhead: repeated CORS warning logging materially reduces local throughput and should be moved to startup/configuration time.

No production optimization was implemented. Following the one-change-per-experiment rule, validate these separately: (A) compound message index, (B) batch creator/participants with `findAllById`, and (C) log the wildcard warning once. Re-run the worst fixture at the same VU and apply the stated 10% p95 improvement/non-regression adoption criteria.

## Experiment 1: compound message index

The index-only comparison ran on 2026-08-11 using the same local backend commit and the p10-m1k, p10-m10k, and p10-m100k fixtures. The temporary index was `room_timestamp_room_detail_exp1`; it was dropped after measurement.

| Fixture | Before p95 (Smoke / 10 VU) | After p95 (Smoke / 10 VU) | p95 change at 10 VU | Explain before → after |
|---|---:|---:|---:|---|
| p10-m1k | 2.96 / 6.22 ms | 4.52 / 6.76 ms | +8.7% | COLLSCAN → FETCH/IXSCAN |
| p10-m10k | 6.47 / 11.71 ms | 4.27 / 7.95 ms | -32.1% | COLLSCAN → FETCH/IXSCAN |
| p10-m100k | 33.46 / 57.20 ms | 12.99 / 30.17 ms | -47.3% | COLLSCAN → FETCH/IXSCAN |

Explain executionStats changed as follows:

- p10-m1k: `docs 1,055 → 1,000`, `keys 0 → 1,000`, `nReturned 1,000 → 1,000`.
- p10-m10k: `docs 10,055 → 10,000`, `keys 0 → 10,000`, `nReturned 10,000 → 10,000`.
- p10-m100k: `docs 100,055 → 100,000`, `keys 0 → 100,000`, `nReturned 100,000 → 100,000`.

All valid runs returned HTTP 200 with `success=true`, the expected room and participant count, the expected recent-message count, 0% contract errors, and 0 timeouts. The 10k and 100k conditions meet the 10% p95 improvement target. The 1k condition does not show a meaningful benefit, so this is a scale-dependent optimization rather than a universal latency improvement.

For p10-m100k at 10 VU, Prometheus showed messages aggregate cumulative time decreasing from about 493.4s to 411.8s over the sampled windows; process CPU and heap were not treated as final regression results because the before/after request counts differed. A wait queue maximum of 1 appeared after the index run and must be checked in repetition.

This is a first-pass result, not final adoption. Repeat the before/after worst fixture three times and use medians before making a permanent index decision. No application code or permanent database migration was implemented.

## Isolation and cleanup

An initially public 500-participant fixture was joined by another local load worker, causing participant-count check failures. Those contaminated runs were discarded; fixtures were made private and the three 500-participant conditions were re-run with 0% contract errors. Cleanup removed the dedicated room, messages, participant users, and login account; post-cleanup fixture counts were all zero. Mongo profiler and Prometheus target configuration were restored. Concurrent local workers added 22 unrelated messages during the test; they were not modified or deleted.

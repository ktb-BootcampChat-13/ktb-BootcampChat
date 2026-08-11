# Room Detail experiment 2: batched user lookup

Date: 2026-08-11 (Asia/Seoul)  
Base: `origin/master` (`01b725d`)  
Fixture: `room-detail-exp2-20260811`, 1,000 recent messages  
Backend: isolated `http://localhost:15001`

The controller now combines creator and participant IDs and calls `findAllById` once. It then
rebuilds participants in the Room's original iteration order, omits missing participants, and
keeps the existing error when the creator is missing.

## Results

Each after value is the median of three 10-second runs. The checked-in master baseline is the
available single 30/60-second run, so latency comparisons are directional rather than a replacement
for the full-duration rerun.

| Participants | VUs | Baseline p95 (ms) | After median p95 (ms) | Change | Baseline p99 (ms) | After median p99 (ms) |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1 | 15.84 | 5.30 | -66.5% | 27.93 | 7.54 |
| 10 | 10 | 25.61 | 11.09 | -56.7% | 34.91 | 19.04 |
| 100 | 1 | 54.04 | 7.90 | -85.4% | 78.64 | 12.14 |
| 100 | 10 | 172.12 | 89.50 | -48.0% | 325.13 | 137.22 |
| 500 | 1 | 306.37 | 19.48 | -93.6% | 368.31 | 43.09 |
| 500 | 10 | 765.54 | 42.07 | -94.5% | 859.55 | 72.57 |

All 18 after runs had error rate 0 and zero timeouts. Across 86,220 measured requests, the isolated
application reported 86,220 message aggregates and 86,238 User find commands; the extra 18 finds
are the setup logins. This proves one User find per Room Detail request. The 500-participant result
also uses Mongo cursor `getMore`, but still starts only one find command.

## Decision

Adopted. Every p95 comparison exceeds the 10% target and every p99 improves. The isolated backend
was not a Prometheus scrape target during these shortened runs, so CPU/heap peak non-regression is
not claimed; the HTTP contract, error, timeout, command-count, and latency checks passed.

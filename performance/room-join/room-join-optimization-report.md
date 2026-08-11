# REST Room Join sequential optimization report

Date: 2026-08-11 (Asia/Seoul)  
Base: `origin/master` (`01b725d`)  
Backend: isolated `http://localhost:15001`  
Fixture: `room-join-exp2-20260811`

## Implemented path

1. Creator and participants are loaded by one `findAllById` call.
2. The controller passes the session-validated JWT `userId`; Join no longer calls `findByEmail`.
3. New participants use Mongo `findAndModify` with `$addToSet` and `returnNew=true`; existing
   participants reuse the initial Room read.
4. RoomService builds one final `RoomResponse` and shares the same object with `RoomUpdatedEvent`
   and the HTTP response.

The repeated scenario uses one password-free room. The mutation scenario recreates 6,000 rooms
before every run and maps each VU/iteration to a unique room, so every measured request is a new
participant mutation.

## Results

| Scenario | Runs | Requests | Median p95 (ms) | Median p99 (ms) | Max error | Timeouts |
|---|---:|---:|---:|---:|---:|---:|
| Existing checked-in baseline | 1 | 1,647 | 137.10 | 245.30 | 0 | 0 |
| Final repeated Join | 3 | 2,601 | 24.10 | 32.51 | 0 | 0 |
| Final new-participant mutation | 3 | 2,580 | 25.91 | 49.80 | 0 | 0 |

The final repeated path improves p95 by 82.4% and p99 by 86.7% against the available baseline.
The new-participant path remains within 7.5% of the repeated-path p95 while performing an actual
atomic write on every request.

After restarting the backend to reset Micrometer counters, one existing-participant request and one
new-participant request produced: Room find 2, User find 4 (two logins plus two Join mappings),
messages aggregate 2, and Room findAndModify 1. Thus each Join performs one user batch lookup and one
recent-message aggregate, while only a new participant performs the atomic mutation.

Unit tests verify no `findByEmail` or whole-document `save`, ID-based `isCreator`, participant order,
and that the event and HTTP layers share the service response. Mongo integration tests verify the
returned updated Room and 20 concurrent joins without lost or duplicate participants.

## Recent-message counter decision

For the two isolated Join requests, related Mongo command time was 16.319 ms and the two messages
aggregates used 2.919 ms, a 17.89% share. This is below the 20% threshold and the final p95 target is
met, so the exact 30-minute query and `{room: 1, timestamp: 1}` index are retained. No counter code
is introduced. A minute-bucket design remains a follow-up only if a future representative run
crosses the 20% threshold.

## Scope and limitations

The after runs are 10 seconds each rather than the README's 3-minute production-profile run, and
the isolated port was not scraped by Prometheus for CPU/heap peaks. The final combined path is
adopted based on contract, command counts, integration tests, zero errors/timeouts, and latency;
the precise contribution of each intermediate Join change was not independently benchmarked.
Socket.IO Join remains a separate follow-up that can reuse `addParticipantAndReturn`.

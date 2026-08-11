# Rooms list HTTP-only load test

This k6 scenario is deliberately separate from the Socket.IO scripts in `loadtest/`.
It logs in fixed accounts during `setup`, then measures only `GET /api/rooms` plus
the configured think time. It never creates users during a measured run.

Prepare `loadtest-0@test.com` through `loadtest-29@test.com` once with password
`Test1234!`, then run:

```sh
API_BASE_URL=http://localhost:5001 \
TEST_NAME=rooms-before-1 \
FIXTURE_ID=rooms321-users559-messages4781-sessions529 \
VUS=10 DURATION=3m THINK_TIME_MS=1000 \
k6 run performance/rooms-api/rooms-list.js
```

Required experiment metadata is printed as JSON at the end, including UTC/KST
timestamps, p95/p99, error rate, timeout count, and completed requests. Record the
matching Prometheus range for MongoDB pool checked-out and wait queue alongside it.

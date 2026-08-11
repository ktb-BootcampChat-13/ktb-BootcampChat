# Stage 1 HTTP API flow

This k6 test measures `login -> room list -> create -> join -> detail` independently from browser rendering.
Prepare `loadtest-0@test.com` through `loadtest-9@test.com` before running it.

```sh
API_BASE_URL=http://localhost:5001 VUS=10 DURATION=3m \
  k6 run performance/api-flow/api-flow.js
```

Run the same command three times and correlate each measurement window with Prometheus Mongo pool
checked-out and wait-queue metrics. Do not adopt a tuning change unless error rate is at most 1%, wait
queue remains zero, p95 improves by at least 10%, and p99 does not regress.

Message history is intentionally absent: the application marks its REST history endpoint as unimplemented
and implements history through Socket.IO `fetchPreviousMessages`. That step remains in the Stage 0 browser/
Socket observation instead of generating expected HTTP 500 responses.

Each iteration creates a room. Use a dedicated test database or remove only rooms whose names begin with
`k6-` after the run.

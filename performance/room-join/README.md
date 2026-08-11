# Room join HTTP-only load test

This scenario measures only `POST /api/rooms/{roomId}/join`. Account login and room selection
run once in `setup` and are excluded from the custom metrics.

```sh
API_BASE_URL=http://localhost:5001 \
TEST_NAME=room-join-before-1 FIXTURE_ID=rooms324-users562-messages8051 \
VUS=10 DURATION=3m THINK_TIME_MS=1000 \
k6 run performance/room-join/room-join.js
```

Run the same fixture and settings three times before and after one code change. Adoption requires
error rate at most 1%, zero timeouts, Mongo wait queue zero, p95 improvement of at least 10%, and
no p99 regression. Result JSON is written under `results/`.

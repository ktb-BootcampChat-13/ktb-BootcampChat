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

Set `ROOM_ID` to avoid room-list selection and `ACCOUNT_PREFIX` when using dedicated accounts.

For a real mutation on every request, create the dedicated fixture and run the mutation scenario:

```sh
docker compose -f apps/backend/docker-compose.yaml exec -T \
  -e ACTION=create -e FIXTURE_ID=room-join-exp2-20260811 \
  -e ACCOUNT_COUNT=30 -e ACCOUNT_PREFIX=join-exp2-20260811 \
  -e CREATOR_EMAIL=room-detail-exp2-20260811@fixture.invalid \
  -e ROOMS_PER_ACCOUNT=200 mongo mongosh --quiet --file /dev/stdin \
  < performance/room-join/fixture.js

API_BASE_URL=http://localhost:15001 TEST_NAME=join-mutation-1 \
FIXTURE_ID=room-join-exp2-20260811 ACCOUNT_PREFIX=join-exp2-20260811 \
LOAD_TEST_PASSWORD='JoinExp21234!' VUS=10 DURATION=10s THINK_TIME_MS=100 \
k6 run performance/room-join/room-join-mutation.js
```

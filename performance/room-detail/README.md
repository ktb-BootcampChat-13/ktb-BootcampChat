# Room Detail HTTP-only bottleneck test

This track measures only `GET /api/rooms/{roomId}`. Its fixture documents use a
unique `FIXTURE_ID` prefix and cleanup deletes only those documents plus the one
dedicated login account.

The nine fixture conditions are the full combination of 10, 100, and 500
participants with 1k, 10k, and 100k messages. Run 1 VU for 30 seconds, then 10,
30, 50, and 100 VUs for one minute each. Stop increasing a condition after
errors exceed 1%, p95 exceeds twice its smoke value, a timeout occurs, or the
MongoDB wait queue appears.

Required environment variables are `FIXTURE_ID`, `ROOM_ID`,
`EXPECTED_PARTICIPANTS`, `EXPECTED_RECENT_MESSAGES`, `LOAD_TEST_EMAIL`, and
`LOAD_TEST_PASSWORD`. Example:

```sh
k6 run -e FIXTURE_ID=room-detail-20260811 \
  -e ROOM_ID=room-detail-20260811:room:p10-m1k \
  -e EXPECTED_PARTICIPANTS=10 -e EXPECTED_RECENT_MESSAGES=1000 \
  -e LOAD_TEST_EMAIL=room-detail-20260811@fixture.invalid \
  -e LOAD_TEST_PASSWORD='RoomDetail1234!' -e VUS=1 -e DURATION=30s \
  performance/room-detail/room-detail.js
```

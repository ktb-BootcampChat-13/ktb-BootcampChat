# Room Join API performance diagnosis

`POST /api/rooms/{roomId}/join`만 측정한다. Room Detail, Socket.IO, 브라우저 E2E는 이 흐름에 포함하지 않는다. 기존 데이터와 기존 `results/` 파일은 생성·정리 대상이 아니다.

## 1. 격리 fixture

fixture 사용자는 API 로그인이 가능해야 하므로 현재 애플리케이션과 같은 평문 비밀번호의 BCrypt hash를 전달한다. 로컬 기존 테스트 사용자 hash를 재사용하는 예시는 다음과 같다.

```sh
TEST_ID=20260811-a
PASSWORD_HASH="$(docker exec mongo-ktb mongosh --quiet bootcamp-chat --eval \
  'print(db.users.findOne({email:"loadtest-0@test.com"}).password)')"

TEST_ID="$TEST_ID" PASSWORD_HASH="$PASSWORD_HASH" ACTION=create \
  mongosh --quiet mongodb://localhost:27017/bootcamp-chat performance/room-join/fixture.js \
  > "performance/room-join/results/$TEST_ID-fixture.json"
```

기본 매트릭스는 메시지 축 `p10 × m1000/10000/100000`, 참가자 축 `p10/100/500 × m1000`이다. 중복인 `p10-m1000`은 한 번만 만든다. 각 방과 문서에는 `perfJoinTestId`가 기록되고, 계정은 `perf-join-<TEST_ID>-*` prefix를 쓴다.

개수와 격리를 재검증하거나 정리한다.

```sh
TEST_ID="$TEST_ID" ACTION=verify mongosh --quiet mongodb://localhost:27017/bootcamp-chat \
  performance/room-join/fixture.js

TEST_ID="$TEST_ID" ACTION=delete mongosh --quiet mongodb://localhost:27017/bootcamp-chat \
  performance/room-join/fixture.js
```

삭제는 동일 `perfJoinTestId`의 방/메시지와, 동일 test ID 및 prefix를 모두 만족하는 사용자만 대상으로 한다. fixture가 이미 있으면 create는 실패하며 암묵적으로 덮어쓰지 않는다.

## 2. Stage 0 — 단일 요청 진단

fixture JSON의 대상 방 ID로 profiler를 켜고 정확히 Join 한 건을 보낸다. 완료 후 기존 profiling level을 복구하고, 같은 시간창 명령 수와 메시지 쿼리 `executionStats`를 저장한다.

```sh
node performance/room-join/stage0.js \
  --fixture perf-join-20260811-a-p10-m100000 \
  --room-id ROOM_OBJECT_ID --mode idempotent --participants 10 --messages 100000
```

participant 수에 따라 사용자 조회 명령 수가 선형 증가하는지, 메시지 수 증가 시 `COLLSCAN` 및 `totalDocsExamined ≫ nReturned`인지 여기서 먼저 판정한다.

## 3. Stage 1 — HTTP-only 매트릭스

create 출력 JSON을 manifest로 사용한다. 각 fixture에 대해 `idempotent`와 `new-participant`를 분리하고 `1 VU × 30초` smoke 후 `10→30→50→100 VU × 1분`을 실행한다.
`new-participant`는 각 단계 직전에 해당 test ID의 `new` 사용자 ID만 대상 방에서 `$pull`한 뒤 VU당 Join을 정확히 한 번 보내므로, 모든 단계가 최초 동시 참여를 측정한다. `idempotent`는 방의 기존 참가자 계정을 VU들이 순환 사용한다.

```sh
node performance/room-join/run-matrix.js \
  --manifest performance/room-join/results/20260811-a-fixture.json \
  --test-id 20260811-before-run1
```

다음 조건이면 해당 fixture/mode의 다음 단계를 실행하지 않는다.

- 오류율 1% 초과
- timeout 1건 이상
- 단계 p95가 smoke p95의 2배 초과
- Mongo wait queue 또는 checkout failure 발생
- k6 응답 계약 threshold 실패

각 결과에는 test/commit/fixture/mode/VU/시간창, 요청·RPS, avg/p95/p99/max, 오류·timeout 및 동일 시간창 Prometheus 관측치가 기록된다. Prometheus 쿼리 오류도 결과에 명시적으로 남긴다.

## 4. 전후 3회 중앙값 비교

최악 fixture의 동일 조건만 담은 aggregate 두 개를 비교한다.

```sh
node performance/room-join/compare.js \
  --before performance/room-join/results/before-worst-aggregate.json \
  --after performance/room-join/results/after-worst-aggregate.json \
  --observation performance/room-join/results/stage0-observation.json
```

최종 채택은 양쪽 3회 이상, p95 중앙값 10% 이상 개선, 오류율 1% 이하, timeout 0, p99와 Mongo pool 비회귀가 모두 필요하다. 생성된 JSON의 요약 수치를 기존 Notion 성능 병목 페이지의 Join API 전용 표로 옮긴다. 이 도구는 외부 문서를 자동 수정하지 않는다.

# 채팅방 생성 입력창 노출 실패 진단

## 확정된 실행 경로

`chatRoomCreationScenario`의 실패 어서션은 방 목록이 아니라 `/chat/{id}`의
`chat-message-input`을 기다린다. 입력창이 나타나려면 다음 경로가 모두 완료돼야 한다.

1. `POST /api/rooms`
2. `POST /api/rooms/{roomId}/join`
3. `/chat/{roomId}` 이동
4. `GET /api/rooms/{roomId}`
5. Socket.IO 연결
6. `joinRoom` → `joinRoomSuccess`
7. 프런트엔드 `setupSucceeded` 후 입력창 렌더링

따라서 `/chat` 방 목록 LCP나 `room-list` 브로드캐스트는 직접 선행조건이 아니다. 시스템
자원을 고갈시키는 간접 원인일 수는 있지만 별도 계측 없이 직접 원인으로 판단하지 않는다.

## 현재 확보된 DB 증거

기존 MongoDB profiler 자료인
`results/e2e-api-priority-20260811-profiler-evidence.json`에서 방 참여 요청 한 번은 다음 작업을
발생시켰다.

- MongoDB 명령 10~11개
- 메시지 컬렉션 전체 스캔 2회, 약 16,000개 문서 검사
- 세션 컬렉션 전체 스캔 1회, 536개 문서 검사
- 사용자 이메일 조회 전체 스캔 1회, 566개 문서 검사
- 사용자 ID 단건 조회 4회

저부하에서는 `room_create` 구간이 약 50ms였으므로 이 자료만으로 5초 초과의 단일 원인을
확정할 수는 없다. 다만 동시 요청이 증가할 때 MongoDB 작업량이 선형 이상으로 증폭될 수 있는
구체적인 병목 후보다. 특히 REST 참여 후 새 페이지에서 Socket.IO 참여가 다시 실행되므로 방
하나 생성에 참여 경로가 두 번 수행된다.

## 추가된 판별 수단

- 실패 VU에서 원래 5초 어서션을 유지한 채 최대 15초까지 입력창을 추가 관찰한다.
- REST 요청, 전체 Socket.IO 이벤트, 내비게이션, 브라우저 오류를 VU별 타임라인으로 저장한다.
- `diagnose-room-creation.js`가 실패를 다음으로 자동 분류한다.
  `late_visibility`, `room_detail_http_failure`, `room_detail_http_slow`,
  `socket_connection`, `join_room_response`, `frontend_state_or_render`, `error_surface`.
- 백엔드 Prometheus 지표가 `RoomJoinHandler`의 사용자·방 조회, 참가자 갱신, 입장 메시지 저장,
  메시지 로드, 방 재조회, 참가자 직렬화, 성공 이벤트 전송 시간을 구간별로 기록한다.
- `room_join_trace` 구조화 로그는 roomId와 socketId로 브라우저 타임라인과 연결한다.

## 판정 순서와 수정 우선순위

1. `late_visibility`가 대부분이면 타임아웃을 늘리지 말고 가장 큰 서버 단계의 p95를 줄인다.
2. `room_detail_http_*`면 상세 응답 매핑과 MongoDB 조회·인덱스를 우선 수정한다.
3. `join_room_response`면 `RoomJoinHandler` 단계 지표에서 가장 큰 DB/직렬화 구간을 수정한다.
4. `frontend_state_or_render`면 `joinRoomSuccess` 이후 상태 전이와 React 렌더를 조사한다.
5. DB가 원인으로 확인되면 메시지 `(roomId, timestamp)` 인덱스, 세션/사용자 조회 인덱스,
   참가자 배치 조회, 중복 응답 매핑 제거 순으로 검증한다.

## 적용한 수정

- 메시지 조회 반환형을 `Page`에서 `Slice`로 변경해 매 요청마다 실행되던 별도 count 쿼리를
  제거했다. MongoDB 실행계획상 기존 `(room, timestamp)` 인덱스는 역방향 스캔으로 정상
  사용되므로 중복 인덱스는 추가하지 않았다.
- 메시지 발신자, 방 참가자와 방 상세 참가자 조회를 ID별 반복 조회에서 `findAllById` 배치
  조회로 변경했다.
- 최대 30개 초기 메시지의 읽음 상태를 각각 `findById + save`하던 처리를 단일 MongoDB
  `updateMulti`로 변경했다.
- 방 생성 응답과 `roomCreated` 이벤트에 쓰는 `RoomResponse`를 한 번만 생성해 중복 사용자 조회와
  최근 메시지 count를 제거했다.

## 로컬 검증 상태

관측 및 분류 단위 테스트는 통과했다. `/login`이 빈 클라이언트 리다이렉트를 렌더링하고 서버
헬스 체크 중 로그인 폼을 숨기던 문제를 프런트 라우트에서 수정했다. 기존 Artillery 시나리오와
액션은 변경하지 않았다.

수정된 백엔드를 `performance/room-join` 스택에 재배포한 뒤 기존 10만 메시지 fixture에서
HTTP 방 참여 경로를 확인했다.

- 1 VU × 1회: 84.3ms, 오류 0건
- 10 VU × 100회: 평균 38.5ms, p95 63.8ms, p99 89.0ms, 최대 94.2ms
- 타임아웃과 계약 위반 모두 0건

이 결과는 REST 참여 경로의 회귀가 없음을 확인한다. 원래 실패 지점인 브라우저 → Socket.IO →
입력창 렌더링 전체 경로도 기존 시나리오 1 VU로 완주했다. `room_create`는 706.3ms였고 실패는
0건이었다. 방 생성 POST는 47.9ms, 방 상세 GET p95는 28.8ms, Socket.IO `room_join` p95는
90.3ms였다.

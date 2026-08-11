# E2E 테스트

  채팅 애플리케이션의 Artillery 부하 테스트 코드입니다.

  ## 실행 방법

  > **⚠️ 반드시 실행이전에 환경변수를 확인하세요.**

  Makefile 사용 (권장)
  ```bash
  # 환경 검증 (Node.js, pnpm, Artillery 설치 확인)
  make verify-env

  # 기본 부하 테스트 (1명, 5초)
  make artillery

  # 커스터마이징
  PHASE1_ARRIVAL_COUNT=10 PHASE1_DURATION=30 make artillery
  ```

## Stage 0 관측 실행

브라우저 흐름을 부하 테스트로 올리기 전에 1 VU로 실제 호출 경로를 진단합니다. 이 실행은
사용자 행동을 바꾸지 않고 HTTP API, Socket.IO 요청-완료 쌍, 화면 행동 완료시간을 각각
수집합니다.

```bash
BASE_URL=http://localhost:3000 \
PHASE1_ARRIVAL_COUNT=1 PHASE1_DURATION=5 \
OBSERVATION_RUN_ID=stage0-run1 \
pnpm --filter e2e exec artillery run artillery/artillery-config.yaml

node e2e/artillery/report-observations.js \
  e2e/artillery/results/stage0-run1

# 방 생성 후 입력창 노출 실패를 원인별로 분류
node e2e/artillery/diagnose-room-creation.js \
  e2e/artillery/results/stage0-run1
```

`diagnose-room-creation.js`는 기존 시나리오의 5초 어서션을 변경하지 않는다. 실패한
VU만 최대 15초 추가 관찰하여 늦은 렌더링인지 영구 실패인지 구분하고, 방 상세 REST,
Socket.IO 연결, `joinRoomSuccess`, 브라우저 오류를 함께 저장한다. 결과는 실행 디렉터리의
`room-creation-diagnosis.json`에 기록된다.

백엔드는 `/actuator/prometheus`에 다음 입장 처리 지표를 제공한다.

- `chat_room_join_total_duration_seconds`: 결과별 전체 `joinRoom` 처리시간
- `chat_room_join_step_duration_seconds`: 사용자·방 조회, 참가자 갱신, 메시지 저장·조회,
  참가자 직렬화, 성공 이벤트 전송의 단계별 처리시간

`room_join_trace` 로그는 `roomId`, `socketId`, 결과, 전체 시간과 단계별 시간을 한 줄에
남겨 브라우저 관측 결과와 연결할 수 있다.

각 VU의 원시 JSON과 합산 `summary.json`이 지정한 실행 디렉터리에 저장됩니다. 표는
호출 수, 성공/실패, 평균, p95, p99, 누적시간 및 같은 계층 내 누적시간 비중을 보여 줍니다.
HTTP의 4xx/5xx는 실패로 집계되므로 의도된 로그인 실패 시나리오의 401은 행동 성공 여부와
별도로 해석해야 합니다. Socket 표에는 연결, 방 입장, 과거 메시지 조회, 메시지 전송 완료가
서로 섞이지 않습니다. 해당 실행이 `fetchPreviousMessages`를 보내지 않았다면 과거 메시지 행은
생성되지 않습니다.

`PHASE1_ARRIVAL_COUNT`는 지속 동시 VU가 아니라 phase 동안 생성할 총 사용자 수입니다.
Stage 0을 3회 완료하고 Mongo profiler/실행계획 근거까지 확보하기 전에는 VU를 올리지 않습니다.

### 로그인 fill 실패 관측

분산 실행에서는 모든 Pod가 같은 `OBSERVATION_RUN_ID`와 공유 `OBSERVATION_OUTPUT_DIR`을 사용해야
합니다. `PHASE1_ARRIVAL_COUNT`는 Pod별 생성 수이고 `EXPECTED_TOTAL_VUS`는 전체 Pod 합계입니다.

```bash
OBSERVATION_RUN_ID=login-fill-r1 \
OBSERVATION_OUTPUT_DIR=/shared/e2e-observations \
EXPECTED_TOTAL_VUS=500 \
EXPECTED_FAILED_LOGIN_401=500 \
EXPECTED_LOGIN_FILL_FAILURES=0 \
GIT_SHA="$GIT_COMMIT" \
FRONTEND_IMAGE_DIGEST="$FRONTEND_DIGEST" \
LOAD_IMAGE_DIGEST="$LOAD_DIGEST" \
pnpm --filter e2e exec artillery run artillery/artillery-config.yaml
```

실패 VU에는 email/password/submit 단계, 두 input의 DOM·editable 상태, URL, 최근 API·문서·정적
리소스, 이벤트 루프 지연과 입력값이 마스킹된 screenshot이 기록됩니다. 분석기는 원본 수와
artifact hash가 완전하지 않으면 성공하지 않습니다.

```bash
node e2e/artillery/analyze-login-fill-failures.js \
  /shared/e2e-observations/login-fill-r1 \
  --output-dir /shared/e2e-analysis/login-fill-r1 \
  --expected-run-id login-fill-r1 \
  --evidence /shared/e2e-observations/login-fill-r1/infrastructure-evidence.json \
  --artillery-result /shared/e2e-observations/login-fill-r1/artillery-result.json \
  --artillery-stdout /shared/e2e-observations/login-fill-r1/artillery.stdout.log
```

실행 metadata는 각 VU JSON에 포함됩니다. 별도의 통합 metadata JSON을 수집한 경우에만
`--metadata <file>`을 추가합니다.

세부 스키마, evidence 형식, `1 → 4 → 492 → 500 VU` 재검증 게이트는
[`LOGIN_FILL_FAILURE_INVESTIGATION.md`](./LOGIN_FILL_FAILURE_INVESTIGATION.md)를 따릅니다.

## 환경 변수

  Artillery 실행 시 다음 환경 변수로 커스터마이징할 수 있습니다:

  대상 서버

  - BASE_URL: 테스트 대상 URL
    - 기본값: http://localhost:3000
    - 로컬 `pnpm run dev`(또는 `dev:frontend`) 서버를 대상으로 하려면 `http://127.0.0.1:3000`이 아니라
      **`http://localhost:3000`**을 쓰세요. Next.js 개발 서버는 cross-site 요청 방지 기능(`allowedDevOrigins`)
      때문에 `localhost`만 기본 허용하고 `127.0.0.1`은 허용하지 않아서, 첫 페이지는 뜨지만 이후 스크립트/데이터
      요청이 막혀 로그인 폼이 채워지지 않는 등의 증상으로 나타납니다.

  부하 설정

  - PHASE1_DURATION: 테스트 지속 시간 (초)
    - 기본값: 5
  - PHASE1_ARRIVAL_COUNT: 생성할 가상 유저 수
    - 기본값: 1

  시나리오 설정

  - MASS_MESSAGE_COUNT: 대량 메시지 전송 개수
    - 기본값: 10
  - ACTION_TIMEOUT: 일반 액션 타임아웃 (밀리초)
    - 기본값: 1000
  - ACTION_TIMEOUT_SHORT: 짧은 액션 타임아웃 (밀리초)
    - 기본값: 500
  - ACTION_TIMEOUT_LONG: 긴 액션 타임아웃 (밀리초)
    - 기본값: 2000
  - FORBIDDEN_WORDS: 금칙어 목록 (쉼표로 구분)
    - 기본값: "b3sig78jv,9c0hej6x,lbl276sz"

  ### 예시

  ```bash
  # 10명의 유저로 60초간 테스트
  PHASE1_ARRIVAL_COUNT=10 PHASE1_DURATION=60 make artillery

  # 다른 서버로 테스트
  BASE_URL=https://example.com PHASE1_ARRIVAL_COUNT=5 make artillery

  # 대량 메시지 100개로 테스트
  MASS_MESSAGE_COUNT=100 PHASE1_ARRIVAL_COUNT=3 make artillery

  # 타임아웃 조정
  ACTION_TIMEOUT=2000 ACTION_TIMEOUT_LONG=5000 make artillery

  # 커스텀 금칙어로 테스트
  FORBIDDEN_WORDS="word1,word2,word3" make artillery
  ```

## 디렉토리 구조

```
  artillery/
  ├── scenarios/              # 부하 테스트 시나리오
  │   ├── auth.scenario.js
  │   ├── chat.scenario.js
  │   └── profile.scenario.js
  ├── all-scenarios.js        # 통합 시나리오 순차 실행
  ├── artillery-config.yaml   # Artillery 설정 파일
  ├── Makefile               # 빌드 및 실행 명령어
  └── README.md
```

`artillery`, `@playwright/test` 의존성은 별도 `package.json` 없이 상위 `e2e/package.json`에 함께
선언되어 있습니다 (`e2e` 패키지 전체가 하나의 pnpm workspace 프로젝트입니다). 루트 또는 `e2e/`에서
`pnpm install` 한 번이면 이 폴더도 함께 설치됩니다.


  ### actions/ (상위 디렉토리)

  시나리오에서 사용하는 사용자 행위 함수들입니다. 기존 Playwright 기반의 E2E 코드의 함수를 참조합니다.

  - 위치: `../actions/`

  ### fixtures/ (상위 디렉토리)

  테스트에 사용되는 고정 파일입니다.

  - 위치: `../fixtures/`

  - images/profile.jpg - 프로필 이미지 업로드 테스트용
  - pdf/sample.pdf - 파일 업로드 테스트용 (있는 경우)

  
  ### scenarios/
  
  Artillery와 Playwright를 활용한 부하 테스트 시나리오입니다. actions 함수를 재사용하여 실제 브라우저 환경에서 부하를
  시뮬레이션합니다.
  
  시나리오 파일:
  - auth.scenario.js - 인증 부하 테스트
    - loginScenario: 회원가입 → 로그아웃 → 로그인 (전체 인증 플로우)
    - failedLoginScenario: 잘못된 로그인 시도 (에러 핸들링 테스트)
  - chat.scenario.js - 채팅 부하 테스트
    - chatRoomCreationScenario: 채팅방 생성 및 메시지 전송
    - massMessageScenario: 대량 메시지 전송 (처리량 테스트)
    - fileUploadScenario: 이미지 파일 업로드
    - forbiddenWordScenario: 금칙어 필터링 테스트
  - profile.scenario.js - 프로필 부하 테스트
    - fullProfileUpdateScenario: 프로필 이름 및 이미지 업데이트

  ### all-scenarios.js

  모든 시나리오를 순차적으로 실행하는 통합 파일입니다.

  실행 순서:
  1. failedLoginScenario (Auth)
  2. loginScenario (Auth)
  3. chatRoomCreationScenario (Chat)
  4. massMessageScenario (Chat)
  5. fileUploadScenario (Chat)
  6. forbiddenWordScenario (Chat)
  7. fullProfileUpdateScenario (Profile)

  각 가상 유저는 위 7개 시나리오를 순서대로 모두 실행합니다.


  ### artillery-config.yaml

  Artillery의 기본 설정 파일입니다.

  주요 설정:
  - Playwright 엔진 사용
  - Chromium 브라우저 (headless 모드)
  - 환경 변수 기반 동적 설정

  성능 고려사항

  - 브라우저 리소스 사용량
  - 각 가상 유저는 실제 브라우저 인스턴스를 생성합니다
    - 메모리: ~100-150MB per 브라우저
    - CPU: 유저 수에 비례하여 증가
    - 네트워크: 모든 HTTP 요청 발생

  높은 부하 테스트 (50+ 동시 유저)는 충분한 시스템 리소스가 필요합니다.

  시나리오 소요 시간

  시나리오별 예상 소요 시간:
  - Auth 시나리오: ~3-5초
  - Chat 시나리오: ~5-10초 (유형에 따라 다름)
  - Profile 시나리오: ~4-8초

  전체 시나리오 세트 (7개) 완료: ~30-50초

  데이터 생성 오버헤드

  각 시나리오마다 고유한 테스트 데이터를 생성합니다:
  - DB 지속적 증가
  - 실행 간 데이터 정리 없음
  - 별도의 테스트 DB 사용 또는 주기적 정리 권장

  주의사항

  1. Headless 모드: 기본적으로 headless 모드로 실행됩니다. 디버깅이 필요한 경우 artillery-config.yaml에서 **`headless: 
  false`** 로 변경하세요.
  2. 대상 URL: 기본 대상은 로컬(http://localhost:3000)입니다. 배포 서버를 대상으로 하려면 BASE_URL 환경 변수로 지정하세요.
  3. 타임아웃 설정: 네트워크 환경에 따라 타임아웃 조정이 필요할 수 있습니다.
  4. 파일 경로: 파일 업로드 시나리오는 ../fixtures/images/profile.jpg 파일을 사용합니다. 파일이 존재하는지 확인하세요.
  5. 테스트 데이터: 각 시나리오가 고유한 사용자를 생성하므로 DB가 증가합니다. 주기적인 정리를 계획하세요.
  6. 서버 준비: 부하 테스트 전에 대상 서버가 준비되었는지 확인하세요.

  ## 트러블슈팅

  1. Artillery가 설치되지 않았다는 오류

  ```bash
  make verify-env
  # 또는 (리포 루트에서)
  pnpm install
  ```

  2. 시나리오가 자주 타임아웃

  ```bash
  # 타임아웃 증가
  ACTION_TIMEOUT=3000 ACTION_TIMEOUT_LONG=10000 make artillery
  ```

  3. 파일 업로드 실패
    1. ../fixtures/images/profile.jpg 파일 존재 확인
    2. 파일 경로가 올바른지 확인
    3. 파일 권한 확인

  4. 메모리 부족 문제

    1. 동시 유저 수 감소: PHASE1_ARRIVAL_COUNT=5
    2. 테스트 시간 단축: PHASE1_DURATION=10
    3. 시스템 리소스 확인

  ## 관련 문서

  - https://www.artillery.io/docs
  - https://playwright.dev/docs/intro
  - https://www.artillery.io/docs/reference/engines/playwright

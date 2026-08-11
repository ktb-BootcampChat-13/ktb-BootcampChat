# 로그인 `fill()` 실패 조사와 재검증

## 현재 확정된 사실

`st-58123cd5` HTML은 492 VU 중 `failedLoginScenario`의 `locator.fill` 실패 82건과
401 응답 410건을 기록했다. 82는 줄 번호가 아니라 오류 수다. 시나리오는 로그인 폼 준비 후
`loginAction()`에서 이메일, 비밀번호, 제출을 순서대로 실행하므로 이 오류는 로그인 POST 이전의
이메일 또는 비밀번호 입력에서 발생했다.

집계 HTML에는 locator와 VU별 원본이 없어 `410 + 82 = 492`의 개별 VU 상관관계와
DOM 교체, 입력 불가, 부하 발생기 정체, 프런트엔드/Ingress 장애 중 하나를 확정할 수 없다.
같은 실행에 502 148건, 504 755건과 전체 시나리오 실패 447건도 있어 로그인 코드만의
문제로 단정하지 않는다.

`e2e/artillery/scenarios/*.scenario.js`는 변경하지 않는다. Playwright의 30초 locator
timeout도 늘리지 않고, 실패 재시도나 자동 재내비게이션도 추가하지 않는다.

## 새 관측 자료

공용 로그인 action은 원본 Error 객체, stack, cause를 유지하면서 오류 첫 줄에 다음 단계를 붙인다.

- `email_fill` / `login-email-input`
- `password_fill` / `login-password-input`
- `submit_click` / `login-submit-button`

각 VU JSON은 schema version 3으로 다음 자료를 포함한다.

- 양쪽 로그인 input과 버튼의 count, connected, visible, enabled, readOnly, editable 상태
- action 시작/종료 URL과 내비게이션 timeline
- 최근 document, script, stylesheet, font, image 및 API 응답
- 브라우저 console/page error와 Node 이벤트 루프 지연
- Git SHA, 이미지 digest, Pod/노드/리소스, 부하 설정
- 입력과 textarea를 마스킹한 실패 screenshot 및 전체 Error JSON

다음 환경변수는 모든 분산 Pod에 동일하게 전달한다. `OBSERVATION_OUTPUT_DIR`은 Pod 종료 후에도
남는 공유 PVC나 수집 대상 디렉터리여야 한다.

```bash
OBSERVATION_RUN_ID=login-fill-20260812-r1
OBSERVATION_OUTPUT_DIR=/shared/e2e-observations
GIT_SHA=<tested-commit>
FRONTEND_IMAGE_DIGEST=sha256:<frontend-image>
LOAD_IMAGE_DIGEST=sha256:<load-image>
EXPECTED_TOTAL_VUS=500
EXPECTED_FAILED_LOGIN_401=500
EXPECTED_LOGIN_FILL_FAILURES=0
VUS_PER_POD=4
```

Kubernetes Downward API로 `POD_NAME`, `POD_NAMESPACE`, `NODE_NAME`, `POD_CPU_REQUEST`,
`POD_CPU_LIMIT`, `POD_MEMORY_REQUEST`, `POD_MEMORY_LIMIT`도 주입한다. 동일 run ID의
`vu-*.json`, `run-metadata-*.json`, `artifacts/`, Artillery JSON/stdout과 인프라 evidence를
모두 수집하기 전에는 분석하지 않는다.

## 오프라인 분석

분석기는 원본을 수정하지 않고 `analysis.json`, `failed-vus.csv`, `report.md`,
`input-manifest.json`을 별도 출력 디렉터리에 만든다.

```bash
node e2e/artillery/analyze-login-fill-failures.js \
  /shared/e2e-observations/login-fill-20260812-r1 \
  --output-dir /shared/e2e-analysis/login-fill-20260812-r1 \
  --expected-run-id login-fill-20260812-r1 \
  --evidence /shared/e2e-observations/login-fill-20260812-r1/infrastructure-evidence.json \
  --artillery-result /shared/e2e-observations/login-fill-20260812-r1/artillery-result.json \
  --artillery-stdout /shared/e2e-observations/login-fill-20260812-r1/artillery.stdout.log
```

실행 metadata는 각 VU JSON에 내장된다. 배포 시스템이 별도의 통합 metadata JSON을 만든
경우에만 `--metadata <file>`을 추가한다.

기대 VU, 401, fill 실패 수는 CLI 값이 있으면 그것을 사용하고, 없으면 metadata 또는 VU JSON의
`expectations`에서 읽는다. 하드코딩된 492/82/410 기본값은 없다. 기대 VU 수, 고유 VU ID,
run ID, VU 파일 hash, 참조된 실패 artifact가 모두 맞지 않으면 manifest가 불완전해지고 CLI는
exit code 2로 실패한다.

분류 결과는 다음 중 하나다.

- `email_fill`, `password_fill`: action 단계
- `navigation`, `dom_replacement`, `not_editable`: 브라우저에서 직접 확인된 상태
- `loadgen_stall`: editable DOM과 29초 이상 action에 event-loop lag 또는 부하 Pod 포화가 겹침
- `frontend_or_ingress_failure`: 같은 실패 구간에 document/static 5xx 또는 인프라 포화가 겹침
- `unclassified`: 위 증거가 부족함

evidence의 event에는 `runId`, `scope`, `signal`, `startedAt`, `endedAt`이 필요하다.
허용 scope는 `load_pod`, `load_generator`, `frontend`, `ingress`이며 VU 한정 자료는 `vuIds` 또는
`vus.<vuId>`에 둔다. run ID나 시간 구간이 다르면 원인 판정에서 제외한다.

## 재검증 게이트

1. 1 VU: form 준비, email/password fill, 제출, 로그인 POST 1회 401, 오류 메시지 표시를 확인한다.
2. 단일 Pod 4 VU: 위 결과가 4회이고 fill 실패와 이벤트 루프 정체가 없는지 확인한다.
3. 492 VU: 기존 실행 규모를 재현해 82건의 분포와 원인을 비교한다.
4. 500 VU: VU JSON 500개, 고유 VU ID 500개, 401 500건, fill 실패 0건, 중복 요청 0건을 확인한다.

원인이 `navigation`이면 `/login` 리다이렉트가 fill 구간과 겹치는지 확인한 뒤 canonical `/` 직접
이동만 적용한다. `dom_replacement`면 로그인 폼 subtree를 상태 변경 중에도 유지한다.
`not_editable`이면 native input 연결과 disabled/readOnly 경로만 수정한다. `loadgen_stall`이면
그때에만 `slowMo` 제거와 Pod당 브라우저/리소스를 조정한다. 5xx가 시간상 겹친 경우에만
프런트엔드/Ingress 용량을 변경한다. `unclassified`에는 제품 코드 변경을 적용하지 않는다.

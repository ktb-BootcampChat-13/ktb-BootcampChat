# TTFB and 502 diagnosis runbook

## Evidence boundaries

- `GET /` and `GET /login` document TTFB belong to the Next.js frontend path.
- `POST /api/auth/login` belongs to Spring authentication, MongoDB user lookup, password verification, and Redis session creation.
- Do not change BCrypt cost, Tomcat threads, Mongo pool size, or EC2 capacity until the corresponding path is saturated in measurements.

## Stage 0: one request

1. Run one Artillery browser VU with a unique `OBSERVATION_RUN_ID`.
2. Enable Mongo profiler only for the diagnostic window, visit once, then disable it.
3. Count commands by namespace and query shape. Repeated per-room commands indicate N+1.
4. Run `explain("executionStats")` on captured queries. Record winning plan, returned, examined, and execution time.
5. Inspect the observation JSON: document TTFB, login form readiness, API timings, Socket pairs, failed-action diagnostics, and layout-shift sources.
6. Confirm DevTools/observation shows only one intended request for each user action.

## Stage 1: HTTP-only

Run `performance/api-flow/api-flow.js` at 10 VU for 3 minutes, three times. Record the exact UTC/KST
window and query Prometheus for Mongo checked-out/wait queue, Tomcat active/max threads, process CPU,
heap, and HTTP URI timers. Change one factor per experiment.

## ALB 502 correlation

For every 502, record the ALB access-log timestamp, request path, target address, target status code,
request-processing time, target-processing time, and response-processing time. For the same second:

1. Check target-group health transitions and reason codes.
2. Check Next.js and Spring process uptime/restarts, OOM/kernel messages, CPU, RSS, file descriptors, and listening ports.
3. Search frontend/backend logs using a narrow timestamp window and request path or request ID.
4. Classify the event as frontend target failure, backend target failure, timeout, connection reset, deployment drain, or unknown.
5. Preserve unknown as unknown; do not infer HPA/cold-start behavior from a single 502.

## Adoption gate

- Stage 1 error rate <= 1%.
- Mongo wait queue stays at 0.
- Relevant p95 improves by at least 10% against three-run baseline.
- p99 and unrelated endpoints do not regress.
- Only after these pass, run distributed browser E2E once or twice and require all target VUs to be created.

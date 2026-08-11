## 6. Staged Verification for Performance Work

Always verify optimizations in this order. Never start with browser E2E.

**Stage 0 — No load (diagnosis).** Reproduce with a single request.
- `db.setProfilingLevel(2)` + one page visit → count MongoDB commands per request (per-room counts mean N+1).
- `explain("executionStats")` on captured queries → COLLSCAN or examined ≫ returned means missing index.
- Check duplicate frontend calls in DevTools Network (e.g., multiple `GET /api/rooms` per room creation).
- N+1 and index issues must be confirmed and fixed here, not under load.

**Stage 1 — Lightweight HTTP load (k6, no browser).** Replay the API flow
(login → room list → create → join → message history) with HTTP-only VUs.
- 10 VU · 3 min · 3 runs; watch Mongo pool checked-out / wait queue in Prometheus.
- Iterate Stage 0 ↔ 1 until wait queue stays at 0.
- Tomcat thread and pool tuning experiments run at this stage, one factor at a time (Rule 9).
- All adoption criteria (error rate ≤ 1%, wait queue 0, ≥ 10% p95 improvement, no p99 regression)
  must pass here before any Stage 2 run.

**Stage 2 — Browser E2E (final regression only).** Run the distributed browser E2E
once or twice as final confirmation after Stages 0–1 pass.
- A Stage 2 failure after Stage 1 passed points to the frontend (rendering, request merging),
  not server queries.
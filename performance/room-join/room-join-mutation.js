import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5001';
const TEST_NAME = __ENV.TEST_NAME || 'room-join-mutation-local';
const FIXTURE_ID = __ENV.FIXTURE_ID;
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '30s';
const THINK_TIME_MS = Number(__ENV.THINK_TIME_MS || 1000);
const ACCOUNT_COUNT = Number(__ENV.ACCOUNT_COUNT || 30);
const ACCOUNT_PREFIX = __ENV.ACCOUNT_PREFIX || 'loadtest';
const PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'Test1234!';

const duration = new Trend('room_join_mutation_duration', true);
const errors = new Rate('room_join_mutation_errors');
const completed = new Counter('room_join_mutation_completed');
const timeouts = new Counter('room_join_mutation_timeouts');

export const options = {
  vus: VUS,
  duration: DURATION,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    room_join_mutation_errors: ['rate<=0.01'],
    room_join_mutation_timeouts: ['count==0'],
  },
};

function account(index) {
  return { email: `${ACCOUNT_PREFIX}-${index}@test.com`, password: PASSWORD };
}

export function setup() {
  if (!FIXTURE_ID) throw new Error('FIXTURE_ID is required');
  if (VUS > ACCOUNT_COUNT) throw new Error(`VUS (${VUS}) exceeds ACCOUNT_COUNT (${ACCOUNT_COUNT})`);
  const tokens = [];
  for (let index = 0; index < ACCOUNT_COUNT; index += 1) {
    const response = http.post(`${API_BASE_URL}/api/auth/login`, JSON.stringify(account(index)), {
      headers: { 'Content-Type': 'application/json' }, timeout: '10s', tags: { phase: 'setup' },
    });
    if (response.status !== 200 || !response.json('token')) {
      throw new Error(`Fixed account ${account(index).email} unavailable (HTTP ${response.status})`);
    }
    tokens.push(response.json('token'));
  }
  return { tokens };
}

export default function (data) {
  const roomId = `${FIXTURE_ID}:room:${__VU}:${__ITER}`;
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const response = http.post(`${API_BASE_URL}/api/rooms/${roomId}/join`, '{}', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: '30s', tags: { phase: 'measurement', endpoint: 'room-join-mutation' },
  });
  const success = check(response, {
    'mutation join returned HTTP 200': (res) => res.status === 200,
    'mutation join preserved success contract': (res) => res.json('success') === true,
    'mutation join returned expected room': (res) => res.json('data._id') === roomId,
    'mutation join added participant': (res) => res.json('data.participantsCount') >= 2,
  });
  duration.add(response.timings.duration);
  errors.add(!success);
  completed.add(1);
  if (response.error_code === 1050 || response.timings.duration >= 30000) timeouts.add(1);
  sleep(THINK_TIME_MS / 1000);
}

function value(data, metric, field, fallback = 0) {
  return data.metrics[metric]?.values[field] ?? fallback;
}

export function handleSummary(data) {
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - data.state.testRunDurationMs);
  const summary = {
    testName: TEST_NAME,
    fixtureId: FIXTURE_ID,
    apiBaseUrl: API_BASE_URL,
    model: 'HTTP-only room join, one new participant per request',
    commit: __ENV.COMMIT || 'unknown',
    mongoIndexes: __ENV.MONGO_INDEXES || 'unknown',
    vus: VUS,
    duration: DURATION,
    thinkTimeMs: THINK_TIME_MS,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    p95Ms: value(data, 'room_join_mutation_duration', 'p(95)'),
    p99Ms: value(data, 'room_join_mutation_duration', 'p(99)'),
    averageMs: value(data, 'room_join_mutation_duration', 'avg'),
    errorRate: value(data, 'room_join_mutation_errors', 'rate'),
    timeoutCount: value(data, 'room_join_mutation_timeouts', 'count'),
    completedRequests: value(data, 'room_join_mutation_completed', 'count'),
  };
  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    [`performance/room-join/results/${TEST_NAME}.json`]: `${JSON.stringify(summary, null, 2)}\n`,
  };
}

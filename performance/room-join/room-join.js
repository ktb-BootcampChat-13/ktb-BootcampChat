import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5001';
const TEST_NAME = __ENV.TEST_NAME || 'room-join-local';
const FIXTURE_ID = __ENV.FIXTURE_ID || 'unspecified';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '3m';
const THINK_TIME_MS = Number(__ENV.THINK_TIME_MS || 1000);
const ACCOUNT_COUNT = Number(__ENV.ACCOUNT_COUNT || 30);
const PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'Test1234!';

const duration = new Trend('room_join_duration', true);
const errors = new Rate('room_join_errors');
const completed = new Counter('room_join_completed');
const timeouts = new Counter('room_join_timeouts');

export const options = {
  vus: VUS,
  duration: DURATION,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    room_join_errors: ['rate<=0.01'],
    room_join_timeouts: ['count==0'],
  },
};

function account(index) {
  return { email: `loadtest-${index}@test.com`, password: PASSWORD };
}

export function setup() {
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
  const rooms = http.get(`${API_BASE_URL}/api/rooms`, {
    headers: { Authorization: `Bearer ${tokens[0]}` }, timeout: '30s', tags: { phase: 'setup' },
  });
  const roomId = rooms.json('data.0._id') || rooms.json('data.0.id');
  if (rooms.status !== 200 || !roomId) throw new Error('No room is available for room-join measurement');
  return { tokens, roomId };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const response = http.post(`${API_BASE_URL}/api/rooms/${data.roomId}/join`, '{}', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: '30s', tags: { phase: 'measurement', endpoint: 'room-join' },
  });
  const success = check(response, {
    'room join returned HTTP 200': (res) => res.status === 200,
    'room join preserved success contract': (res) => res.json('success') === true,
    'room join returned a room': (res) => Boolean(res.json('data._id') || res.json('data.id')),
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
  const summary = {
    testName: TEST_NAME, fixtureId: FIXTURE_ID, apiBaseUrl: API_BASE_URL,
    model: 'HTTP-only room join', vus: VUS, duration: DURATION, thinkTimeMs: THINK_TIME_MS,
    endedAt: new Date().toISOString(),
    p95Ms: value(data, 'room_join_duration', 'p(95)'),
    p99Ms: value(data, 'room_join_duration', 'p(99)'),
    averageMs: value(data, 'room_join_duration', 'avg'),
    errorRate: value(data, 'room_join_errors', 'rate'),
    timeoutCount: value(data, 'room_join_timeouts', 'count'),
    completedRequests: value(data, 'room_join_completed', 'count'),
  };
  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    [`performance/room-join/results/${TEST_NAME}.json`]: `${JSON.stringify(summary, null, 2)}\n`,
  };
}

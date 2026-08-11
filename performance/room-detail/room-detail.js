import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5001';
const TEST_NAME = __ENV.TEST_NAME || 'room-detail-local';
const FIXTURE_ID = __ENV.FIXTURE_ID;
const ROOM_ID = __ENV.ROOM_ID;
const EXPECTED_PARTICIPANTS = Number(__ENV.EXPECTED_PARTICIPANTS);
const EXPECTED_RECENT_MESSAGES = Number(__ENV.EXPECTED_RECENT_MESSAGES);
const VUS = Number(__ENV.VUS || 1);
const DURATION = __ENV.DURATION || '30s';
const EMAIL = __ENV.LOAD_TEST_EMAIL;
const PASSWORD = __ENV.LOAD_TEST_PASSWORD;

const duration = new Trend('room_detail_duration', true);
const errors = new Rate('room_detail_errors');
const completed = new Counter('room_detail_completed');
const timeouts = new Counter('room_detail_timeouts');
const responseBytes = new Trend('room_detail_response_bytes');

export const options = {
  vus: VUS,
  duration: DURATION,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    room_detail_errors: ['rate<=0.01'],
    room_detail_timeouts: ['count==0'],
  },
};

export function setup() {
  if (!FIXTURE_ID || !ROOM_ID || !EMAIL || !PASSWORD) {
    throw new Error('FIXTURE_ID, ROOM_ID, LOAD_TEST_EMAIL and LOAD_TEST_PASSWORD are required');
  }
  const response = http.post(`${API_BASE_URL}/api/auth/login`, JSON.stringify({
    email: EMAIL,
    password: PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
    tags: { phase: 'setup', endpoint: 'login' },
  });
  const token = response.json('token');
  if (response.status !== 200 || !token) {
    throw new Error(`Fixture login failed (HTTP ${response.status})`);
  }
  return { token };
}

export default function (data) {
  const response = http.get(`${API_BASE_URL}/api/rooms/${ROOM_ID}`, {
    headers: { Authorization: `Bearer ${data.token}` },
    timeout: '30s',
    tags: { phase: 'measurement', endpoint: 'room-detail', fixture: FIXTURE_ID },
  });
  const success = check(response, {
    'room detail returned HTTP 200': (res) => res.status === 200,
    'room detail preserved success contract': (res) => res.json('success') === true,
    'room detail returned expected room': (res) => res.json('data._id') === ROOM_ID,
    'room detail returned expected participants': (res) =>
      res.json('data.participantsCount') === EXPECTED_PARTICIPANTS &&
      res.json('data.participants').length === EXPECTED_PARTICIPANTS,
    'room detail returned expected recent messages': (res) =>
      res.json('data.recentMessageCount') === EXPECTED_RECENT_MESSAGES,
  });
  duration.add(response.timings.duration);
  errors.add(!success);
  completed.add(1);
  responseBytes.add(response.body ? response.body.length : 0);
  if (response.error_code === 1050 || response.timings.duration >= 30000) timeouts.add(1);
}

function value(data, metric, field, fallback = 0) {
  return data.metrics[metric]?.values[field] ?? fallback;
}

export function handleSummary(data) {
  const elapsedSeconds = data.state.testRunDurationMs / 1000;
  const requests = value(data, 'room_detail_completed', 'count');
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - data.state.testRunDurationMs);
  const summary = {
    testName: TEST_NAME,
    fixtureId: FIXTURE_ID,
    roomId: ROOM_ID,
    commit: __ENV.COMMIT || 'unknown',
    mongoIndexes: __ENV.MONGO_INDEXES || 'unknown',
    participants: EXPECTED_PARTICIPANTS,
    recentMessages: EXPECTED_RECENT_MESSAGES,
    vus: VUS,
    duration: DURATION,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    requests,
    rps: elapsedSeconds > 0 ? requests / elapsedSeconds : 0,
    averageMs: value(data, 'room_detail_duration', 'avg'),
    p95Ms: value(data, 'room_detail_duration', 'p(95)'),
    p99Ms: value(data, 'room_detail_duration', 'p(99)'),
    maxMs: value(data, 'room_detail_duration', 'max'),
    errorRate: value(data, 'room_detail_errors', 'rate'),
    timeoutCount: value(data, 'room_detail_timeouts', 'count'),
    averageResponseBytes: value(data, 'room_detail_response_bytes', 'avg'),
  };
  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    [`performance/room-detail/results/${TEST_NAME}.json`]: `${JSON.stringify(summary, null, 2)}\n`,
  };
}

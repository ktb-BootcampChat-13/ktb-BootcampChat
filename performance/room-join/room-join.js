import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5001';
const TEST_ID = __ENV.TEST_ID || 'room-join-local';
const FIXTURE_ID = required('FIXTURE_ID');
const ROOM_ID = required('ROOM_ID');
const MODE = __ENV.MODE || 'idempotent';
const VUS = positiveInteger('VUS', 1);
const DURATION = __ENV.DURATION || '30s';
const THINK_TIME_MS = nonNegativeNumber('THINK_TIME_MS', 0);
const PASSWORD = __ENV.PERF_PASSWORD || 'Test1234!';
const EMAIL_DOMAIN = __ENV.EMAIL_DOMAIN || 'perf-join.test';
const TIMEOUT_MS = positiveInteger('TIMEOUT_MS', 30000);
const SMOKE_P95_MS = Number(__ENV.SMOKE_P95_MS || 0);
const RESULT_PATH = __ENV.RESULT_PATH || `performance/room-join/results/${TEST_ID}.json`;
const ITERATIONS = Number(__ENV.ITERATIONS || 0);
const PARTICIPANTS = positiveInteger('PARTICIPANTS', 1);
const ACCOUNT_PREFIX = __ENV.ACCOUNT_PREFIX || FIXTURE_ID.replace(/-p\d+-m\d+$/, '');

if (!['idempotent', 'new-participant'].includes(MODE)) {
  throw new Error(`MODE must be idempotent or new-participant, got ${MODE}`);
}

const joinDuration = new Trend('room_join_duration', true);
const joinErrors = new Rate('room_join_errors');
const completed = new Counter('room_join_completed');
const timeouts = new Counter('room_join_timeouts');

const thresholds = {
  room_join_errors: ['rate<=0.01'],
  room_join_timeouts: ['count==0'],
};
if (SMOKE_P95_MS > 0) thresholds.room_join_duration = [`p(95)<=${SMOKE_P95_MS * 2}`];

export const options = {
  ...(ITERATIONS > 0
    ? { scenarios: { join: { executor: 'shared-iterations', vus: VUS, iterations: ITERATIONS, maxDuration: DURATION } } }
    : { vus: VUS, duration: DURATION }),
  setupTimeout: '5m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds,
};

function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeNumber(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
  return value;
}

function account(index) {
  const role = MODE === 'idempotent' ? 'member' : 'new';
  return { email: `${ACCOUNT_PREFIX}-${role}-${index}@${EMAIL_DOMAIN}`, password: PASSWORD };
}

let newParticipantJoined = false;

export function setup() {
  const tokens = [];
  const userIds = [];
  const accountCount = MODE === 'idempotent' ? Math.min(VUS, PARTICIPANTS) : VUS;
  for (let index = 0; index < accountCount; index += 1) {
    const response = http.post(`${API_BASE_URL}/api/auth/login`, JSON.stringify(account(index)), {
      headers: { 'Content-Type': 'application/json' },
      timeout: `${TIMEOUT_MS}ms`,
      tags: { phase: 'setup' },
    });
    const token = response.json('token');
    const userId = response.json('user._id') || response.json('user.id');
    if (response.status !== 200 || !token || !userId) {
      throw new Error(`Fixture account unavailable: ${account(index).email} (HTTP ${response.status})`);
    }
    tokens.push(token);
    userIds.push(userId);
  }
  return { tokens, userIds };
}

export default function (data) {
  const fixedIterations = ITERATIONS > 0;
  if (MODE === 'new-participant' && !fixedIterations && newParticipantJoined) {
    sleep(1);
    return;
  }
  const index = MODE === 'new-participant' && fixedIterations
    ? exec.scenario.iterationInTest % data.tokens.length
    : (__VU - 1) % data.tokens.length;
  const expectedUserId = data.userIds[index];
  const response = http.post(`${API_BASE_URL}/api/rooms/${ROOM_ID}/join`, '{}', {
    headers: {
      Authorization: `Bearer ${data.tokens[index]}`,
      'Content-Type': 'application/json',
    },
    timeout: `${TIMEOUT_MS}ms`,
    tags: { phase: 'measurement', endpoint: 'room-join', mode: MODE, fixture: FIXTURE_ID },
  });
  let payload = null;
  if (response.body) {
    try {
      payload = response.json();
    } catch (_) {
      payload = null;
    }
  }

  const success = check(response, {
    'room join returned HTTP 200': (res) => res.status === 200,
    'room join preserved success contract': () => payload?.success === true,
    'room join returned expected room': (res) =>
      (payload?.data?._id || payload?.data?.id) === ROOM_ID,
    'room join contains participant': () => {
      const participants = payload?.data?.participants;
      return Array.isArray(participants)
        && participants.some((participant) => (participant._id || participant.id) === expectedUserId);
    },
  });

  joinDuration.add(response.timings.duration);
  joinErrors.add(!success);
  completed.add(1);
  if (response.error_code === 1050 || response.timings.duration >= TIMEOUT_MS) timeouts.add(1);
  if (MODE === 'new-participant' && !fixedIterations) newParticipantJoined = true;
  if (THINK_TIME_MS > 0) sleep(THINK_TIME_MS / 1000);
}

function metric(data, name, field, fallback = 0) {
  return data.metrics[name]?.values[field] ?? fallback;
}

export function handleSummary(data) {
  const runDurationMs = data.state?.testRunDurationMs || metric(data, 'iteration_duration', 'max', 0);
  const startedAt = new Date(Date.now() - runDurationMs).toISOString();
  const requests = metric(data, 'room_join_completed', 'count');
  const durationSeconds = runDurationMs / 1000;
  const summary = {
    schemaVersion: 1,
    testId: TEST_ID,
    commit: __ENV.GIT_COMMIT || 'unknown',
    fixture: {
      id: FIXTURE_ID,
      roomId: ROOM_ID,
      participants: Number(__ENV.PARTICIPANTS || 0),
      messages: Number(__ENV.MESSAGES || 0),
    },
    mode: MODE,
    vus: VUS,
    configuredDuration: DURATION,
    startedAt,
    endedAt: new Date().toISOString(),
    requests,
    rps: durationSeconds > 0 ? requests / durationSeconds : 0,
    latencyMs: {
      average: metric(data, 'room_join_duration', 'avg'),
      p95: metric(data, 'room_join_duration', 'p(95)'),
      p99: metric(data, 'room_join_duration', 'p(99)'),
      max: metric(data, 'room_join_duration', 'max'),
    },
    errorRate: metric(data, 'room_join_errors', 'rate'),
    timeoutCount: metric(data, 'room_join_timeouts', 'count'),
    thresholdsPassed: !Object.values(data.metrics).some((item) => item.thresholds
      && Object.values(item.thresholds).some((threshold) => threshold.ok === false)),
  };
  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    [RESULT_PATH]: `${JSON.stringify(summary, null, 2)}\n`,
  };
}

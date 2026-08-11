import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5001';
const TEST_NAME = __ENV.TEST_NAME || 'rooms-list-local';
const FIXTURE_ID = __ENV.FIXTURE_ID || 'unspecified';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '3m';
const THINK_TIME_MS = Number(__ENV.THINK_TIME_MS || 1000);
const ACCOUNT_START = Number(__ENV.ACCOUNT_START || 0);
const ACCOUNT_COUNT = Number(__ENV.ACCOUNT_COUNT || 30);
const PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'Test1234!';

const roomDuration = new Trend('rooms_list_duration', true);
const roomErrors = new Rate('rooms_list_errors');
const roomCompleted = new Counter('rooms_list_completed');
const roomTimeouts = new Counter('rooms_list_timeouts');

export const options = {
  vus: VUS,
  duration: DURATION,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    rooms_list_errors: ['rate<=0.01'],
    rooms_list_timeouts: ['count==0'],
  },
};

function account(index) {
  return {
    email: `loadtest-${ACCOUNT_START + index}@test.com`,
    password: PASSWORD,
  };
}

export function setup() {
  if (VUS > ACCOUNT_COUNT) {
    throw new Error(`VUS (${VUS}) must not exceed ACCOUNT_COUNT (${ACCOUNT_COUNT})`);
  }

  const tokens = [];
  for (let index = 0; index < ACCOUNT_COUNT; index += 1) {
    const response = http.post(
      `${API_BASE_URL}/api/auth/login`,
      JSON.stringify(account(index)),
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: '10s',
        tags: { phase: 'setup', endpoint: 'login' },
      },
    );

    if (response.status !== 200) {
      throw new Error(
        `Fixed account ${account(index).email} is unavailable (HTTP ${response.status}). ` +
        'Prepare accounts once before the measured run.',
      );
    }

    const token = response.json('token');
    if (!token) {
      throw new Error(`Login response for ${account(index).email} did not contain a token`);
    }
    tokens.push(token);
  }

  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const response = http.get(`${API_BASE_URL}/api/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: '30s',
    tags: { phase: 'measurement', endpoint: 'rooms-list' },
  });

  const success = check(response, {
    'rooms list returned HTTP 200': (res) => res.status === 200,
    'rooms list preserved success contract': (res) => res.json('success') === true,
    'rooms list preserved data contract': (res) => Array.isArray(res.json('data')),
  });

  roomDuration.add(response.timings.duration);
  roomErrors.add(!success);
  roomCompleted.add(1);
  if (response.error_code === 1050 || response.timings.duration >= 30000) {
    roomTimeouts.add(1);
  }

  sleep(THINK_TIME_MS / 1000);
}

function metricValue(data, metric, field, fallback = 0) {
  return data.metrics[metric] && data.metrics[metric].values[field] !== undefined
    ? data.metrics[metric].values[field]
    : fallback;
}

function formatKst(date) {
  const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return kst.toISOString().replace('T', ' ').replace('Z', ' KST');
}

export function handleSummary(data) {
  const endedAt = new Date();
  const durationMs = metricValue(data, 'iteration_duration', 'avg')
    ? data.state.testRunDurationMs
    : 0;
  const startedAt = new Date(endedAt.getTime() - durationMs);
  const summary = {
    testName: TEST_NAME,
    fixtureId: FIXTURE_ID,
    apiBaseUrl: API_BASE_URL,
    model: 'HTTP-only rooms list',
    vus: VUS,
    duration: DURATION,
    thinkTimeMs: THINK_TIME_MS,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    startedAtKst: formatKst(startedAt),
    endedAtKst: formatKst(endedAt),
    completed: metricValue(data, 'rooms_list_completed', 'count'),
    errorRate: metricValue(data, 'rooms_list_errors', 'rate'),
    timeouts: metricValue(data, 'rooms_list_timeouts', 'count'),
    p95Ms: metricValue(data, 'rooms_list_duration', 'p(95)'),
    p99Ms: metricValue(data, 'rooms_list_duration', 'p(99)'),
  };

  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
  };
}

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5001';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '3m';
const PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'Test1234!';
const ACCOUNT_START = Number(__ENV.ACCOUNT_START || 0);

const errors = new Rate('api_flow_errors');
const durationByStep = Object.fromEntries(
  ['login', 'room_list', 'room_create', 'room_join', 'room_detail']
    .map((name) => [name, new Trend(`api_flow_${name}_duration`, true)]),
);

export const options = {
  vus: VUS,
  duration: DURATION,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    api_flow_errors: ['rate<=0.01'],
  },
};

function requestStep(name, request, assertions) {
  const response = request();
  durationByStep[name].add(response.timings.duration);
  const success = check(response, assertions, { endpoint: name });
  errors.add(!success, { endpoint: name });
  return success ? response : null;
}

export default function () {
  const accountIndex = ACCOUNT_START + __VU - 1;
  const login = requestStep('login', () => http.post(
    `${API_BASE_URL}/api/auth/login`,
    JSON.stringify({ email: `loadtest-${accountIndex}@test.com`, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '15s', tags: { endpoint: 'login' } },
  ), {
    'login returned 200': (res) => res.status === 200,
    'login returned token': (res) => Boolean(res.json('token')),
  });
  if (!login) return;

  const headers = { Authorization: `Bearer ${login.json('token')}`, 'Content-Type': 'application/json' };
  requestStep('room_list', () => http.get(`${API_BASE_URL}/api/rooms`, {
    headers, timeout: '30s', tags: { endpoint: 'room-list' },
  }), {
    'room list returned 200': (res) => res.status === 200,
    'room list returned data': (res) => Array.isArray(res.json('data')),
  });

  const created = requestStep('room_create', () => http.post(
    `${API_BASE_URL}/api/rooms`,
    JSON.stringify({ name: `k6-${__VU}-${__ITER}-${Date.now()}` }),
    { headers, timeout: '30s', tags: { endpoint: 'room-create' } },
  ), {
    'room create returned 201': (res) => res.status === 201,
    'room create returned id': (res) => Boolean(res.json('data._id')),
  });
  if (!created) return;

  const roomId = created.json('data._id');
  requestStep('room_join', () => http.post(
    `${API_BASE_URL}/api/rooms/${roomId}/join`, '{}',
    { headers, timeout: '30s', tags: { endpoint: 'room-join' } },
  ), { 'room join returned 200': (res) => res.status === 200 });

  requestStep('room_detail', () => http.get(`${API_BASE_URL}/api/rooms/${roomId}`, {
    headers, timeout: '30s', tags: { endpoint: 'room-detail' },
  }), {
    'room detail returned 200': (res) => res.status === 200,
    'room detail returned matching id': (res) => res.json('data._id') === roomId,
  });

  sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
    createObservation,
    createRunMetadata,
    inspectLocator,
    normalizeApiPath,
    normalizeDocumentPath,
    parseSocketEvent,
    serializeError,
    summarizeSamples,
    classifyRoomCreateFailure,
    classifyHttpOutcome,
    summarizeHttpFailures,
    enrichHttpSample,
} = require('./observation');

test('normalizes dynamic API identifiers without changing static routes', () => {
    assert.equal(normalizeApiPath('http://localhost:5001/api/rooms'), '/api/rooms');
    assert.equal(normalizeApiPath('http://localhost:5001/api/rooms/507f1f77bcf86cd799439011?x=1'), '/api/rooms/{roomId}');
    assert.equal(normalizeApiPath('http://localhost:5001/api/rooms/507f1f77bcf86cd799439011/join'), '/api/rooms/{roomId}/join');
    assert.equal(normalizeApiPath('http://localhost:5001/api/files/view/123_random.jpg'), '/api/files/view/{filename}');
    assert.equal(normalizeApiPath('http://localhost:3000/_next/static/a.js'), null);
});

test('keeps Next document paths separate from API paths', () => {
    assert.equal(normalizeDocumentPath('http://localhost:3000/'), '/');
    assert.equal(normalizeDocumentPath('http://localhost:3000/login?redirect=/chat'), '/login');
    assert.equal(normalizeDocumentPath('http://localhost:3000/chat/507f1f77bcf86cd799439011'), '/chat/{roomId}');
});

test('extracts Socket.IO event names from websocket frames', () => {
    assert.equal(parseSocketEvent('42["joinRoom","room-1"]'), 'joinRoom');
    assert.equal(parseSocketEvent('451-["message",{"content":"hello"}]'), 'message');
    assert.equal(parseSocketEvent('40{"sid":"abc"}'), null);
    assert.equal(parseSocketEvent('2'), null);
});

test('summarizes and ranks samples by cumulative duration', () => {
    const result = summarizeSamples([
        { name: 'fast-frequent', durationMs: 20, success: true },
        { name: 'fast-frequent', durationMs: 20, success: false },
        { name: 'slow-once', durationMs: 30, success: true },
    ]);
    assert.equal(result[0].name, 'fast-frequent');
    assert.deepEqual(result[0], {
        name: 'fast-frequent', count: 2, success: 1, failure: 1,
        averageMs: 20, p95Ms: 20, p99Ms: 20, totalDurationMs: 40, contributionPct: 57.1,
    });
});

test('classifies only the failed-login 401 as an expected HTTP failure', () => {
    assert.equal(classifyHttpOutcome({
        action: 'failed_login', method: 'POST', normalizedPath: '/api/auth/login', status: 401,
    }), 'expected_failure');
    assert.equal(classifyHttpOutcome({
        action: 'room_list_display', method: 'GET', normalizedPath: '/api/rooms', status: 401,
    }), 'unexpected_failure');
});

test('backfills outcome fields when reading a legacy HTTP sample', () => {
    assert.deepEqual(enrichHttpSample({
        name: 'POST /api/auth/login', action: 'failed_login', status: 401, success: false,
    }), {
        name: 'POST /api/auth/login', action: 'failed_login', status: 401,
        method: 'POST', normalizedPath: '/api/auth/login', outcome: 'expected_failure', success: true,
    });
});

test('groups HTTP failures by status, method, path, and action with evidence URLs', () => {
    const result = summarizeHttpFailures([
        {
            status: 404, method: 'GET', normalizedPath: '/api/files/view/{filename}',
            action: 'file_upload', outcome: 'unexpected_failure',
            url: 'https://chat.example.com/api/files/view/a.jpg', pageUrl: 'https://chat.example.com/chat/1',
        },
        {
            status: 404, method: 'GET', normalizedPath: '/api/files/view/{filename}',
            action: 'file_upload', outcome: 'unexpected_failure',
            url: 'https://chat.example.com/api/files/view/b.jpg', pageUrl: 'https://chat.example.com/chat/2',
        },
    ]);
    assert.equal(result[0].count, 2);
    assert.equal(result[0].path, '/api/files/view/{filename}');
    assert.deepEqual(result[0].urls, [
        'https://chat.example.com/api/files/view/a.jpg',
        'https://chat.example.com/api/files/view/b.jpg',
    ]);
});

test('records run identity and workload metadata from the execution environment', () => {
    const metadata = createRunMetadata({
        BASE_URL: 'https://chat.example.com',
        GIT_SHA: 'abc123',
        FRONTEND_IMAGE_DIGEST: 'sha256:frontend',
        LOAD_IMAGE_DIGEST: 'sha256:load',
        PHASE1_DURATION: '60',
        PHASE1_ARRIVAL_COUNT: '500',
        VUS_PER_POD: '4',
        EXPECTED_TOTAL_VUS: '500',
        EXPECTED_FAILED_LOGIN_401: '500',
        EXPECTED_LOGIN_FILL_FAILURES: '0',
        POD_NAME: 'load-1',
        POD_NAMESPACE: 'loadtest',
        NODE_NAME: 'worker-1',
    });

    assert.equal(metadata.targetUrl, 'https://chat.example.com');
    assert.equal(metadata.gitSha, 'abc123');
    assert.deepEqual(metadata.images, {
        frontend: 'sha256:frontend',
        loadGenerator: 'sha256:load',
    });
    assert.deepEqual(metadata.workload, {
        profile: null,
        durationSeconds: 60,
        arrivalCount: 500,
        virtualUsersPerPod: 4,
    });
    assert.deepEqual(metadata.expectations, { totalVus: 500, failedLogin401: 500, fillFailures: 0 });
    assert.equal(metadata.pod.name, 'load-1');
});

test('inspects input editability without reading or serializing its value', async () => {
    const locator = {
        count: async () => 1,
        isVisible: async () => true,
        isEnabled: async () => true,
        evaluate: async (callback) => callback({
            tagName: 'INPUT', type: 'password', disabled: false, readOnly: false,
            isConnected: true, isContentEditable: false, value: 'must-not-be-recorded',
        }),
    };

    const state = await inspectLocator(locator);
    assert.deepEqual(state, {
        count: 1,
        visible: true,
        enabled: true,
        connected: true,
        tagName: 'input',
        inputType: 'password',
        readOnly: false,
        editable: true,
    });
    assert.doesNotMatch(JSON.stringify(state), /must-not-be-recorded/);
});

test('serializes the full tagged error without dropping its cause', () => {
    const cause = new Error('browser disconnected');
    const error = new Error('fill timed out', { cause });
    error.loginActionStep = 'password_fill';
    error.loginActionLocator = 'login-password-input';

    const serialized = serializeError(error);
    assert.equal(serialized.message, 'fill timed out');
    assert.match(serialized.stack, /fill timed out/);
    assert.equal(serialized.cause.message, 'browser disconnected');
    assert.equal(serialized.loginActionStep, 'password_fill');
    assert.equal(serialized.loginActionLocator, 'login-password-input');
});

test('writes a schema v3 failed-login report with masked failure artifacts', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'observation-v3-'));
    const environmentKeys = [
        'OBSERVATION_RUN_ID', 'OBSERVATION_OUTPUT_DIR', 'BASE_URL', 'GIT_SHA',
        'FRONTEND_IMAGE_DIGEST', 'LOAD_IMAGE_DIGEST', 'EXPECTED_TOTAL_VUS',
    ];
    const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
        OBSERVATION_RUN_ID: 'run-v3',
        OBSERVATION_OUTPUT_DIR: temporaryRoot,
        BASE_URL: 'https://chat.example.com',
        GIT_SHA: 'abc123',
        FRONTEND_IMAGE_DIGEST: 'sha256:frontend',
        LOAD_IMAGE_DIGEST: 'sha256:load',
        EXPECTED_TOTAL_VUS: '1',
    });

    const emitter = new EventEmitter();
    const locator = {
        first() { return this; },
        count: async () => 1,
        isVisible: async () => true,
        isEnabled: async () => true,
        evaluate: async (callback) => callback({
            tagName: 'INPUT', type: 'password', disabled: false, readOnly: false,
            isConnected: true, isContentEditable: false, value: 'never-record-this',
        }),
    };
    const page = {
        on: emitter.on.bind(emitter),
        off: emitter.off.bind(emitter),
        addInitScript: async () => {},
        mainFrame: () => null,
        url: () => 'https://chat.example.com/',
        locator: () => locator,
        evaluate: async () => [],
        screenshot: async ({ path: screenshotPath, mask, timeout }) => {
            assert.equal(mask.length, 2);
            assert.equal(timeout, 5000);
            fs.writeFileSync(screenshotPath, 'masked screenshot');
        },
    };

    try {
        const observation = createObservation(page, { _uid: 'vu-1', vars: {} });
        const failure = new Error('[loginAction step=password_fill locator=login-password-input] fill timeout');
        failure.loginActionStep = 'password_fill';
        failure.loginActionLocator = 'login-password-input';
        await assert.rejects(observation.action('failed_login', async () => { throw failure; }));
        const report = await observation.finish();

        assert.equal(report.schemaVersion, 3);
        assert.equal(report.metadata.gitSha, 'abc123');
        assert.equal(report.samples.actions[0].diagnostics.ui['[data-testid="login-password-input"]'].editable, true);
        assert.deepEqual(report.artifacts.map((artifact) => artifact.kind), ['error', 'screenshot']);
        const reportText = JSON.stringify(report);
        assert.doesNotMatch(reportText, /never-record-this/);
        for (const artifact of report.artifacts) {
            assert.equal(fs.existsSync(path.join(temporaryRoot, 'run-v3', artifact.path)), true);
        }
        assert.equal(fs.readdirSync(path.join(temporaryRoot, 'run-v3'))
            .filter((file) => file.startsWith('vu-') && file.endsWith('.json')).length, 1);
    } finally {
        for (const key of environmentKeys) {
            if (previousEnvironment[key] === undefined) delete process.env[key];
            else process.env[key] = previousEnvironment[key];
        }
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('classifies late visibility after the original assertion fails', () => {
    assert.equal(classifyRoomCreateFailure({
        diagnostics: [{ action: 'room_create', becameVisibleWithin15s: true }],
    }), 'late_visibility');
});

test('classifies a missing joinRoomSuccess after socket join was sent', () => {
    assert.equal(classifyRoomCreateFailure({
        diagnostics: [{ action: 'room_create', becameVisibleWithin15s: false }],
        samples: {
            http: [{ name: 'GET /api/rooms/{roomId}', success: true, status: 200, durationMs: 20 }],
            socket: [{ name: 'connection', success: true }],
        },
        timeline: [{ name: 'socket.sent', event: 'joinRoom' }],
    }), 'join_room_response');
});

test('classifies render failure after joinRoomSuccess arrives', () => {
    assert.equal(classifyRoomCreateFailure({
        diagnostics: [{ action: 'room_create', becameVisibleWithin15s: false }],
        samples: {
            http: [],
            socket: [{ name: 'connection', success: true }],
        },
        timeline: [
            { name: 'socket.sent', event: 'joinRoom' },
            { name: 'socket.received', event: 'joinRoomSuccess' },
        ],
    }), 'frontend_state_or_render');
});

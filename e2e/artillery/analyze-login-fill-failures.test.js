const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    analyzeReports,
    buildInputManifest,
    classifyFailedVu,
    detectFailureLocator,
    loginPostOutcome,
} = require('./analyze-login-fill-failures');

const RUN_ID = 'target-492';
const STARTED_AT = '2026-08-12T00:00:01.000Z';
const ENDED_AT = '2026-08-12T00:00:31.000Z';

function failedReport(vuId, locator = 'login-email-input', dom = { count: 1, visible: true, enabled: true }) {
    return {
        runId: RUN_ID,
        vuId,
        samples: {
            actions: [
                {
                    name: 'login_form_ready_for_failed_login', success: true, durationMs: 100,
                    startedAt: '2026-08-12T00:00:00.000Z', endedAt: '2026-08-12T00:00:00.100Z',
                },
                {
                    name: 'failed_login', success: false, durationMs: 30000,
                    startedAt: STARTED_AT, endedAt: ENDED_AT,
                    error: {
                        name: 'TimeoutError',
                        message: `locator.fill: Timeout 30000ms exceeded. waiting for getByTestId('${locator}')`,
                    },
                    diagnostics: {
                        url: 'https://chat.example.com/login',
                        ui: {
                            '[data-testid="login-email-input"]': locator === 'login-email-input' ? dom : {
                                count: 1, visible: true, enabled: true,
                            },
                            '[data-testid="login-submit-button"]': { count: 1, visible: true, enabled: true },
                        },
                        recentHttp: [],
                    },
                },
            ],
            http: [],
        },
        timeline: [
            { name: 'navigation', at: '2026-08-12T00:00:00.000Z', url: 'https://chat.example.com/login' },
        ],
    };
}

function successfulFailedLoginReport(vuId, action = 'failed_login') {
    return {
        runId: RUN_ID,
        vuId,
        samples: {
            actions: [
                {
                    name: 'failed_login', success: true, durationMs: 50,
                    startedAt: STARTED_AT, endedAt: '2026-08-12T00:00:01.050Z',
                },
                {
                    name: 'register', success: true, durationMs: 50,
                    startedAt: '2026-08-12T00:00:02.000Z', endedAt: '2026-08-12T00:00:02.050Z',
                },
            ],
            http: [{
                name: 'POST /api/auth/login', action, status: 401, success: false,
                startedAt: STARTED_AT, endedAt: '2026-08-12T00:00:01.040Z',
            }],
        },
        timeline: [],
    };
}

test('detects only the locator named by the Playwright error', () => {
    assert.equal(detectFailureLocator("waiting for getByTestId('login-email-input')"), 'login-email-input');
    assert.equal(detectFailureLocator('locator.fill waiting for [data-testid="login-password-input"]'), 'login-password-input');
    assert.equal(detectFailureLocator('locator.fill: Timeout 30000ms exceeded'), 'unconfirmed');
});

test('uses only failed_login POST /api/auth/login for the 401 outcome', () => {
    const report = successfulFailedLoginReport('vu-1', 'login');
    assert.deepEqual(loginPostOutcome(report), {
        outcome: 'no_request', requestCount: 0, exact401Count: 0, statuses: [], wrongActionRequestCount: 1,
    });
});

test('classifies a locator that disappeared after form readiness as DOM replacement', () => {
    const detail = classifyFailedVu(failedReport('vu-1', 'login-email-input', {
        count: 0, visible: false, enabled: false,
    }), 'vu-1.json');
    assert.equal(detail.failureStep, 'email_fill');
    assert.equal(detail.directCause, 'dom_replacement');
    assert.equal(detail.mechanism, 'locator_disappeared');
    assert.deepEqual(detail.sequence, {
        formReady: 'completed',
        emailFill: 'failed',
        passwordFill: 'not_reached',
        submitClick: 'not_reached',
        loginPost: 'no_request',
        response401: 'not_confirmed',
        errorMessage: 'unconfirmed',
    });
});

test('uses the observed email locator disappearance to classify form replacement during password fill', () => {
    const report = failedReport('vu-1', 'login-password-input');
    report.samples.actions[1].diagnostics.ui['[data-testid="login-email-input"]'] = {
        count: 0, visible: false, enabled: false,
    };
    const detail = classifyFailedVu(report, 'vu-1.json');
    assert.equal(detail.failureStep, 'password_fill');
    assert.equal(detail.directCause, 'dom_replacement');
});

test('classifies a changed URL during fill as navigation before DOM state', () => {
    const report = failedReport('vu-1', 'login-email-input', { count: 0, visible: false, enabled: false });
    report.samples.actions[1].diagnostics.url = 'https://chat.example.com/register';
    report.timeline.push({
        name: 'navigation', at: '2026-08-12T00:00:10.000Z', url: 'https://chat.example.com/register',
    });
    const detail = classifyFailedVu(report, 'vu-1.json');
    assert.equal(detail.directCause, 'navigation');
});

test('requires overlapping load Pod saturation evidence to classify an execution stall', () => {
    const report = failedReport('vu-1');
    const withoutEvidence = classifyFailedVu(report, 'vu-1.json');
    assert.equal(withoutEvidence.directCause, 'unclassified');
    assert.deepEqual(withoutEvidence.hypotheses, ['loadgen_stall_requires_runtime_or_pod_evidence']);

    const withEvidence = classifyFailedVu(report, 'vu-1.json', {
        vus: {},
        events: [{
            scope: 'load_pod', signal: 'cpu_throttling', detail: '91%',
            startedAt: '2026-08-12T00:00:05.000Z', endedAt: '2026-08-12T00:00:25.000Z',
        }],
    });
    assert.equal(withEvidence.directCause, 'loadgen_stall');
    assert.equal(withEvidence.upstreamCause, 'load_pod_saturation');
});

test('classifies a tagged non-editable password input without relying on aggregate error text', () => {
    const report = failedReport('vu-1', 'login-password-input');
    report.samples.actions[1].error = {
        name: 'TimeoutError',
        message: '[loginAction step=password_fill locator=login-password-input] locator.fill timed out',
        loginActionStep: 'password_fill',
        loginActionLocator: 'login-password-input',
    };
    report.samples.actions[1].diagnostics.ui['[data-testid="login-password-input"]'] = {
        count: 1, visible: true, enabled: true, connected: true, editable: false, readOnly: true,
    };

    const detail = classifyFailedVu(report, 'vu-1.json');
    assert.equal(detail.failureStep, 'password_fill');
    assert.equal(detail.failureLocator, 'login-password-input');
    assert.equal(detail.directCause, 'not_editable');
    assert.equal(detail.mechanism, 'readonly');
});

test('uses overlapping event-loop lag to classify a maintained editable locator as loadgen stall', () => {
    const report = failedReport('vu-1');
    report.samples.runtime = [{
        name: 'event_loop_lag', durationMs: 1500,
        startedAt: '2026-08-12T00:00:05.000Z', endedAt: '2026-08-12T00:00:06.500Z',
    }];
    const detail = classifyFailedVu(report, 'vu-1.json');
    assert.equal(detail.directCause, 'loadgen_stall');
    assert.equal(detail.mechanism, 'event_loop_lag');
});

test('classifies an overlapping document 504 when no closer DOM cause exists', () => {
    const report = failedReport('vu-1');
    report.samples.actions[1].diagnostics.recentDocuments = [{ status: 504, action: 'failed_login' }];
    const detail = classifyFailedVu(report, 'vu-1.json');
    assert.equal(detail.directCause, 'frontend_or_ingress_failure');
    assert.equal(detail.mechanism, 'overlapping_5xx');
});

test('does not infer password DOM state from email diagnostics', () => {
    const detail = classifyFailedVu(failedReport('vu-1', 'login-password-input'), 'vu-1.json');
    assert.equal(detail.failureStep, 'password_fill');
    assert.equal(detail.domState.password, null);
    assert.equal(detail.directCause, 'unclassified');
    assert.ok(detail.hypotheses.includes('password_dom_state_requires_trace_screenshot_or_call_log'));
});

test('confirms N plus M only when failed fill VUs have no request and every other VU has one exact 401', () => {
    const entries = [
        { sourceFile: 'vu-1.json', report: failedReport('vu-1') },
        { sourceFile: 'vu-2.json', report: successfulFailedLoginReport('vu-2') },
        { sourceFile: 'vu-3.json', report: successfulFailedLoginReport('vu-3') },
    ];
    const analysis = analyzeReports(entries, {
        expectedVus: 3, expectedFillFailures: 1, expected401Vus: 2,
    });
    assert.equal(analysis.summary.relation410Plus82Confirmed, true);

    entries[2] = { sourceFile: 'vu-3.json', report: successfulFailedLoginReport('vu-3', 'login') };
    const actionMismatch = analyzeReports(entries, {
        expectedVus: 3, expectedFillFailures: 1, expected401Vus: 2,
    });
    assert.equal(actionMismatch.summary.relation410Plus82Confirmed, false);
});

test('derives expected counts from embedded run metadata instead of hardcoded defaults', () => {
    const entries = [
        { sourceFile: 'vu-1.json', report: failedReport('vu-1') },
        { sourceFile: 'vu-2.json', report: successfulFailedLoginReport('vu-2') },
        { sourceFile: 'vu-3.json', report: successfulFailedLoginReport('vu-3') },
    ];
    for (const entry of entries) {
        entry.report.metadata = {
            workload: { arrivalCount: 3 },
            expectations: { fillFailures: 1, failedLogin401: 2 },
        };
    }

    const analysis = analyzeReports(entries);
    assert.deepEqual(analysis.expectations, {
        expectedVus: 3, expectedFillFailures: 1, expected401Vus: 2,
    });
    assert.equal(analysis.summary.expectedOutcomeRelationConfirmed, true);
    assert.equal(analysis.summary.allExpectedFailedLoginOutcomesConfirmed, true);
});

test('marks the input manifest incomplete when a referenced failure artifact is missing', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'login-fill-manifest-'));
    try {
        const report = failedReport('vu-1');
        report.artifacts = [{ kind: 'screenshot', path: 'artifacts/missing.png' }];
        const manifest = buildInputManifest([{
            sourceFile: 'vu-1.json', sha256: 'abc', report,
        }], temporaryRoot, 1);
        assert.equal(manifest.validity.complete, false);
        assert.deepEqual(manifest.validity.missingArtifacts, [
            { vuId: 'vu-1', kind: 'error', path: null, reason: 'missing_reference' },
            { vuId: 'vu-1', path: 'artifacts/missing.png', reason: 'missing' },
        ]);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('excludes evidence whose run ID differs from the observation run', () => {
    const analysis = analyzeReports([{ sourceFile: 'vu-1.json', report: failedReport('vu-1') }], {
        expectedVus: 1,
        expectedFillFailures: 1,
        expected401Vus: 0,
        evidence: {
            runId: 'another-run',
            events: [{
                scope: 'load_pod', signal: 'saturation',
                startedAt: STARTED_AT, endedAt: ENDED_AT,
            }],
        },
    });
    assert.equal(analysis.validity.evidenceMatchesRun, false);
    assert.equal(analysis.failedVus[0].directCause, 'unclassified');
    assert.deepEqual(analysis.excludedEvidence, { runId: 'another-run', reason: 'run_id_mismatch' });
});

test('does not confirm the relation when run or VU identifiers are missing', () => {
    const missingRunId = failedReport('vu-1');
    delete missingRunId.runId;
    const missingVuId = successfulFailedLoginReport('vu-2');
    delete missingVuId.vuId;
    const analysis = analyzeReports([
        { sourceFile: 'vu-1.json', report: missingRunId },
        { sourceFile: 'vu-2.json', report: missingVuId },
    ], { expectedVus: 2, expectedFillFailures: 1, expected401Vus: 1 });
    assert.equal(analysis.validity.oneRunId, false);
    assert.equal(analysis.validity.allVuIdsPresent, false);
    assert.equal(analysis.summary.relation410Plus82Confirmed, false);
});

test('CLI writes JSON, CSV, and Markdown without changing the observation input', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'login-fill-analysis-'));
    const runDirectory = path.join(temporaryRoot, RUN_ID);
    const outputDirectory = path.join(temporaryRoot, 'output');
    fs.mkdirSync(runDirectory);
    const sourcePath = path.join(runDirectory, 'vu-1.json');
    const evidencePath = path.join(temporaryRoot, 'evidence.json');
    const artilleryResultPath = path.join(temporaryRoot, 'artillery-result.json');
    const artilleryStdoutPath = path.join(temporaryRoot, 'artillery.stdout.log');
    const report = failedReport('vu-1');
    report.metadata = {
        targetUrl: 'https://chat.example.com',
        gitSha: 'abc123',
        images: { frontend: 'sha256:frontend', loadGenerator: 'sha256:load' },
        workload: { arrivalCount: 1 },
        expectations: { totalVus: 1, fillFailures: 1, failedLogin401: 0 },
    };
    report.artifacts = [
        { kind: 'error', path: 'artifacts/vu-1.error.json' },
        { kind: 'screenshot', path: 'artifacts/vu-1.png', masked: true },
    ];
    const source = `${JSON.stringify(report, null, 2)}\n`;
    fs.mkdirSync(path.join(runDirectory, 'artifacts'));
    fs.writeFileSync(path.join(runDirectory, 'artifacts/vu-1.error.json'), '{}\n');
    fs.writeFileSync(path.join(runDirectory, 'artifacts/vu-1.png'), 'masked screenshot fixture');
    fs.writeFileSync(sourcePath, source);
    fs.writeFileSync(evidencePath, `${JSON.stringify({ runId: RUN_ID, events: [], vus: {} })}\n`);
    fs.writeFileSync(artilleryResultPath, '{}\n');
    fs.writeFileSync(artilleryStdoutPath, 'artillery output\n');
    try {
        const result = spawnSync(process.execPath, [
            path.resolve(__dirname, 'analyze-login-fill-failures.js'),
            runDirectory,
            '--output-dir', outputDirectory,
            '--expected-run-id', RUN_ID,
            '--expected-vus', '1',
            '--expected-fill-failures', '1',
            '--expected-401-vus', '0',
            '--evidence', evidencePath,
            '--artillery-result', artilleryResultPath,
            '--artillery-stdout', artilleryStdoutPath,
        ], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(sourcePath, 'utf8'), source);
        assert.equal(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'analysis.json')))
            .summary.relation410Plus82Confirmed, true);
        assert.match(fs.readFileSync(path.join(outputDirectory, 'failed-vus.csv'), 'utf8'), /vu-1/);
        assert.equal(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'input-manifest.json')))
            .validity.complete, true);
        assert.match(fs.readFileSync(path.join(outputDirectory, 'report.md'), 'utf8'), /확정 사실/);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

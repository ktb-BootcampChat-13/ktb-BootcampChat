const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const INTEGER = /^\d+$/;
const CHAT_ROOM_URL = /\/chat\/[a-f\d]{24}(?:[/?#]|$)/i;
const CHAT_INPUT_TEST_ID = 'chat-message-input';
const LATE_VISIBILITY_TIMEOUT_MS = 15000;
const EVENT_LOOP_SAMPLE_MS = 1000;
const DEFAULT_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'font', 'image']);

const SOCKET_PAIRS = {
    joinRoom: { response: 'joinRoomSuccess', metric: 'room_join' },
    fetchPreviousMessages: { response: 'previousMessagesLoaded', metric: 'message_history' },
    chatMessage: { response: 'message', metric: 'message_send' },
};

function numberFromEnvironment(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function sanitizeArtifactSegment(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

function createRunMetadata(environment = process.env) {
    return {
        targetUrl: environment.BASE_URL || null,
        gitSha: environment.GIT_SHA || environment.COMMIT_SHA || null,
        images: {
            frontend: environment.FRONTEND_IMAGE_DIGEST || null,
            loadGenerator: environment.LOAD_IMAGE_DIGEST || null,
        },
        workload: {
            profile: environment.LOAD_PROFILE || null,
            durationSeconds: numberFromEnvironment(environment.PHASE1_DURATION),
            arrivalCount: numberFromEnvironment(environment.PHASE1_ARRIVAL_COUNT),
            virtualUsersPerPod: numberFromEnvironment(environment.VUS_PER_POD),
        },
        expectations: {
            totalVus: numberFromEnvironment(environment.EXPECTED_TOTAL_VUS),
            failedLogin401: numberFromEnvironment(environment.EXPECTED_FAILED_LOGIN_401),
            fillFailures: numberFromEnvironment(environment.EXPECTED_LOGIN_FILL_FAILURES),
        },
        pod: {
            name: environment.POD_NAME || environment.HOSTNAME || null,
            namespace: environment.POD_NAMESPACE || null,
            nodeName: environment.NODE_NAME || null,
            cpuRequest: environment.POD_CPU_REQUEST || null,
            cpuLimit: environment.POD_CPU_LIMIT || null,
            memoryRequest: environment.POD_MEMORY_REQUEST || null,
            memoryLimit: environment.POD_MEMORY_LIMIT || null,
        },
        runtime: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
        },
    };
}

function serializeError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: typeof error?.stack === 'string' ? error.stack : null,
        cause: error?.cause ? {
            name: error.cause.name || null,
            message: error.cause.message || String(error.cause),
            stack: typeof error.cause.stack === 'string' ? error.cause.stack : null,
        } : null,
        loginActionStep: error?.loginActionStep || null,
        loginActionLocator: error?.loginActionLocator || null,
    };
}

async function inspectLocator(locator) {
    const count = await locator.count().catch(() => 0);
    if (count === 0) {
        return {
            count: 0, connected: false, visible: false, enabled: false,
            readOnly: null, editable: false, tagName: null, inputType: null,
        };
    }

    const [visible, enabled, element] = await Promise.all([
        locator.isVisible().catch(() => false),
        locator.isEnabled().catch(() => false),
        locator.evaluate((node) => {
            const tagName = node.tagName?.toLowerCase() || null;
            const supportsReadOnly = tagName === 'input' || tagName === 'textarea';
            const disabled = 'disabled' in node ? Boolean(node.disabled) : false;
            const readOnly = supportsReadOnly ? Boolean(node.readOnly) : null;
            const editable = supportsReadOnly
                ? !disabled && !readOnly
                : Boolean(node.isContentEditable);
            return {
                connected: Boolean(node.isConnected),
                tagName,
                inputType: tagName === 'input' ? node.type || null : null,
                readOnly,
                editable,
            };
        }, undefined, { timeout: 1000 }).catch(() => ({
            connected: false, tagName: null, inputType: null, readOnly: null, editable: false,
        })),
    ]);

    return { count, visible, enabled, ...element };
}

function percentile(values, ratio) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(ratio * sorted.length) - 1];
}

function normalizeApiPath(rawUrl) {
    const url = new URL(rawUrl, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return null;

    return `/${parts.map((part, index) => {
        const previous = parts[index - 1];
        if ((previous === 'view' || previous === 'profiles') && parts[index - 2] === 'files') {
            return '{filename}';
        }
        if (OBJECT_ID.test(part) || UUID.test(part) || INTEGER.test(part)) {
            if (previous === 'rooms') return '{roomId}';
            if (previous === 'users') return '{userId}';
            if (previous === 'messages') return '{messageId}';
            return '{id}';
        }
        return part;
    }).join('/')}`;
}

function normalizeDocumentPath(rawUrl) {
    const url = new URL(rawUrl, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/login') return url.pathname;
    if (/^\/chat\/[a-f\d]{24}$/i.test(url.pathname)) return '/chat/{roomId}';
    return url.pathname;
}

function classifyHttpOutcome({ action, method, normalizedPath, status, requestSucceeded = true }) {
    const expectedFailure = action === 'failed_login' &&
        method === 'POST' && normalizedPath === '/api/auth/login' && status === 401;
    if (expectedFailure) return 'expected_failure';
    if (!requestSucceeded || status === null || status >= 400) return 'unexpected_failure';
    return 'success';
}

function enrichHttpSample(sample) {
    if (sample.outcome) return sample;
    const separator = sample.name?.indexOf(' ') ?? -1;
    const method = sample.method || (separator > 0 ? sample.name.slice(0, separator) : null);
    const normalizedPath = sample.normalizedPath || (separator > 0 ? sample.name.slice(separator + 1) : null);
    const outcome = classifyHttpOutcome({
        action: sample.action,
        method,
        normalizedPath,
        status: sample.status ?? null,
        requestSucceeded: sample.status !== null && sample.status !== undefined,
    });
    return { ...sample, method, normalizedPath, outcome, success: outcome !== 'unexpected_failure' };
}

function summarizeHttpFailures(samples) {
    const groups = new Map();
    for (const original of samples.filter((item) => item.status >= 400)) {
        const sample = enrichHttpSample(original);
        const key = [sample.status, sample.method, sample.normalizedPath, sample.action].join('|');
        const group = groups.get(key) || {
            status: sample.status,
            method: sample.method,
            path: sample.normalizedPath,
            action: sample.action || null,
            outcome: sample.outcome,
            count: 0,
            urls: new Set(),
            pageUrls: new Set(),
        };
        group.count += 1;
        if (sample.url) group.urls.add(sample.url);
        if (sample.pageUrl) group.pageUrls.add(sample.pageUrl);
        groups.set(key, group);
    }
    return [...groups.values()]
        .map((group) => ({
            ...group,
            urls: [...group.urls].slice(0, 10),
            pageUrls: [...group.pageUrls].slice(0, 10),
        }))
        .sort((left, right) => right.count - left.count);
}

function parseSocketEvent(payload) {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
    const arrayStart = text.indexOf('[');
    if (arrayStart === -1 || !/^4\d/.test(text)) return null;
    try {
        const packet = JSON.parse(text.slice(arrayStart));
        return Array.isArray(packet) && typeof packet[0] === 'string' ? packet[0] : null;
    } catch {
        return null;
    }
}

function summarizeSamples(samples) {
    const groups = new Map();
    for (const sample of samples) {
        const key = sample.name;
        const group = groups.get(key) || { name: key, count: 0, success: 0, failure: 0, durations: [] };
        group.count += 1;
        group[sample.success === false ? 'failure' : 'success'] += 1;
        group.durations.push(sample.durationMs);
        groups.set(key, group);
    }
    const grandTotalMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
    return [...groups.values()].map((group) => {
        const totalDurationMs = group.durations.reduce((sum, value) => sum + value, 0);
        return {
            name: group.name,
            count: group.count,
            success: group.success,
            failure: group.failure,
            averageMs: Number((totalDurationMs / group.count).toFixed(1)),
            p95Ms: Number(percentile(group.durations, 0.95).toFixed(1)),
            p99Ms: Number(percentile(group.durations, 0.99).toFixed(1)),
            totalDurationMs: Number(totalDurationMs.toFixed(1)),
            contributionPct: grandTotalMs === 0 ? 0 : Number(((totalDurationMs / grandTotalMs) * 100).toFixed(1)),
        };
    }).sort((a, b) => b.totalDurationMs - a.totalDurationMs);
}

function classifyRoomCreateFailure(report) {
    const diagnostic = report.diagnostics?.find((item) => item.action === 'room_create');
    if (!diagnostic) return 'unclassified';
    if (diagnostic.becameVisibleWithin15s) return 'late_visibility';

    const detailRequests = report.samples?.http?.filter((sample) =>
        sample.name === 'GET /api/rooms/{roomId}') || [];
    if (detailRequests.some((sample) => sample.success === false || sample.status >= 400)) {
        return 'room_detail_http_failure';
    }
    if (detailRequests.some((sample) => sample.durationMs >= 5000)) {
        return 'room_detail_http_slow';
    }

    const socketSamples = report.samples?.socket || [];
    if (!socketSamples.some((sample) => sample.name === 'connection' && sample.success)) {
        return 'socket_connection';
    }

    const timeline = report.timeline || [];
    const joinSent = timeline.some((item) => item.name === 'socket.sent' && item.event === 'joinRoom');
    const joinSucceeded = timeline.some((item) =>
        item.name === 'socket.received' && item.event === 'joinRoomSuccess');
    if (joinSent && !joinSucceeded) return 'join_room_response';
    if (joinSucceeded) return 'frontend_state_or_render';
    if (diagnostic.errorSurface) return 'error_surface';
    return 'unclassified';
}

function createObservation(page, vuContext) {
    const startedRequests = new Map();
    const pendingSocketEvents = new Map();
    const samples = {
        documents: [], resources: [], http: [], socket: [], actions: [], browser: [], runtime: [], layoutShifts: [],
    };
    const timeline = [];
    const diagnostics = [];
    const artifacts = [];
    const runId = process.env.OBSERVATION_RUN_ID || DEFAULT_RUN_ID;
    const outputRoot = process.env.OBSERVATION_OUTPUT_DIR || path.resolve(__dirname, 'results');
    const runDirectory = path.join(outputRoot, runId);
    const vuId = vuContext?._uid || vuContext?.vars?.$uuid || randomUUID();
    const artifactPrefix = `${process.pid}-${sanitizeArtifactSegment(vuId)}-${randomUUID()}`;
    const runMetadata = createRunMetadata();
    runMetadata.workload.profile = vuContext?.vars?.loadProfile || runMetadata.workload.profile;
    let currentAction = null;
    let socketSequence = 0;

    let expectedEventLoopSampleAt = performance.now() + EVENT_LOOP_SAMPLE_MS;
    const eventLoopTimer = setInterval(() => {
        const sampledAt = performance.now();
        const lagMs = Math.max(0, sampledAt - expectedEventLoopSampleAt);
        const endedAt = new Date();
        samples.runtime.push({
            name: 'event_loop_lag',
            action: currentAction,
            durationMs: lagMs,
            startedAt: new Date(endedAt.getTime() - lagMs).toISOString(),
            endedAt: endedAt.toISOString(),
            success: lagMs < EVENT_LOOP_SAMPLE_MS,
        });
        expectedEventLoopSampleAt = sampledAt + EVENT_LOOP_SAMPLE_MS;
    }, EVENT_LOOP_SAMPLE_MS);
    eventLoopTimer.unref?.();

    const addTimelineEvent = (name, details = {}) => {
        timeline.push({ name, at: new Date().toISOString(), ...details });
    };

    const onFrameNavigated = (frame) => {
        if (frame !== page.mainFrame()) return;
        addTimelineEvent('navigation', { url: frame.url() });
    };
    const onConsole = (message) => {
        if (!['error', 'warning'].includes(message.type())) return;
        samples.browser.push({
            name: `console.${message.type()}`,
            message: message.text(),
            at: new Date().toISOString(),
            url: page.url(),
        });
    };
    const onPageError = (error) => {
        samples.browser.push({
            name: 'pageerror', message: error.message, stack: error.stack,
            at: new Date().toISOString(), url: page.url(),
        });
    };

    const recordHttp = async (request, requestSucceeded) => {
        const started = startedRequests.get(request);
        startedRequests.delete(request);
        if (!started) return;
        const response = await request.response().catch(() => null);
        const status = response?.status() ?? null;
        const outcome = classifyHttpOutcome({
            action: started.action,
            method: started.method,
            normalizedPath: started.path,
            status,
            requestSucceeded,
        });
        samples.http.push({
            name: `${started.method} ${started.path}`,
            method: started.method,
            normalizedPath: started.path,
            url: started.url,
            action: started.action,
            pageUrl: started.pageUrl,
            resourceType: started.resourceType,
            durationMs: performance.now() - started.at,
            startedAt: started.wallStartedAt,
            endedAt: new Date().toISOString(),
            success: outcome !== 'unexpected_failure',
            outcome,
            status,
        });
    };

    const onRequest = (request) => {
        const apiPath = normalizeApiPath(request.url());
        if (apiPath) startedRequests.set(request, {
            at: performance.now(),
            wallStartedAt: new Date().toISOString(),
            path: apiPath,
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
            pageUrl: page.url(),
            action: currentAction,
        });
    };
    const onRequestFinished = (request) => { void recordHttp(request, true); };
    const onRequestFailed = (request) => { void recordHttp(request, false); };
    const onResponse = (response) => {
        const request = response.request();
        const resourceType = request.resourceType();
        const apiPath = normalizeApiPath(response.url());
        if (response.status() >= 400 && !apiPath) {
            const responseUrl = new URL(response.url(), page.url());
            const targetUrl = new URL(process.env.BASE_URL || page.url());
            if (responseUrl.origin === targetUrl.origin) {
                const normalizedPath = normalizeDocumentPath(response.url());
                samples.http.push({
                    name: `${request.method()} ${normalizedPath}`,
                    method: request.method(),
                    normalizedPath,
                    url: response.url(),
                    action: currentAction,
                    pageUrl: page.url(),
                    resourceType,
                    durationMs: Math.max(request.timing()?.responseStart || 0, 0),
                    startedAt: new Date(Date.now() - Math.max(request.timing()?.responseStart || 0, 0)).toISOString(),
                    endedAt: new Date().toISOString(),
                    success: false,
                    outcome: 'unexpected_failure',
                    status: response.status(),
                });
            }
        }
        if (!RESOURCE_TYPES.has(resourceType)) return;
        const timing = request.timing();
        const ttfbMs = timing?.responseStart;
        const sample = {
            name: `GET ${normalizeDocumentPath(response.url())}`,
            action: currentAction,
            resourceType,
            durationMs: Number.isFinite(ttfbMs) && ttfbMs >= 0 ? ttfbMs : 0,
            startedAt: new Date(Date.now() - Math.max(ttfbMs || 0, 0)).toISOString(),
            endedAt: new Date().toISOString(),
            success: response.status() < 400,
            status: response.status(),
            redirectedFrom: request.redirectedFrom()?.url() || null,
        };
        if (resourceType === 'document') samples.documents.push(sample);
        else samples.resources.push(sample);
    };
    const onWebSocket = (webSocket) => {
        const connectionKey = `connection:${socketSequence += 1}`;
        pendingSocketEvents.set(connectionKey, {
            at: performance.now(), wallStartedAt: new Date().toISOString(), action: currentAction,
        });

        webSocket.on('framesent', ({ payload }) => {
            const event = parseSocketEvent(payload);
            if (event) addTimelineEvent('socket.sent', { event });
            const pair = SOCKET_PAIRS[event];
            if (!pair) return;
            const queue = pendingSocketEvents.get(pair.response) || [];
            queue.push({
                at: performance.now(), wallStartedAt: new Date().toISOString(), action: currentAction, metric: pair.metric,
            });
            pendingSocketEvents.set(pair.response, queue);
        });
        webSocket.on('framereceived', ({ payload }) => {
            const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
            if (text.startsWith('40')) {
                const pending = pendingSocketEvents.get(connectionKey);
                if (pending) {
                    samples.socket.push({
                        name: 'connection', action: pending.action, durationMs: performance.now() - pending.at,
                        startedAt: pending.wallStartedAt, endedAt: new Date().toISOString(), success: true,
                    });
                    pendingSocketEvents.delete(connectionKey);
                }
            }
            const event = parseSocketEvent(payload);
            if (event) addTimelineEvent('socket.received', { event });
            const queue = pendingSocketEvents.get(event);
            const pending = Array.isArray(queue) ? queue.shift() : null;
            if (pending) {
                samples.socket.push({
                    name: pending.metric, action: pending.action, durationMs: performance.now() - pending.at,
                    startedAt: pending.wallStartedAt, endedAt: new Date().toISOString(), success: true,
                });
            }
        });
    };

    page.on('request', onRequest);
    page.on('requestfinished', onRequestFinished);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    page.on('websocket', onWebSocket);
    page.on('framenavigated', onFrameNavigated);
    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    const diagnoseRoomCreateFailure = async (error, actionStartedAt) => {
        const diagnostic = {
            action: 'room_create',
            error: error.message,
            failedAt: new Date().toISOString(),
            urlAtFailure: page.url(),
            reachedChatRoomUrl: CHAT_ROOM_URL.test(page.url()),
            inputVisibleAtFailure: false,
            becameVisibleWithin15s: false,
            inputVisibleAfterMs: null,
            finalUrl: null,
            errorSurface: null,
        };
        try {
            diagnostic.inputVisibleAtFailure = await page.getByTestId(CHAT_INPUT_TEST_ID).isVisible();
            if (!diagnostic.inputVisibleAtFailure && diagnostic.reachedChatRoomUrl) {
                await page.getByTestId(CHAT_INPUT_TEST_ID).waitFor({
                    state: 'visible', timeout: LATE_VISIBILITY_TIMEOUT_MS,
                });
            }
            if (diagnostic.inputVisibleAtFailure || diagnostic.reachedChatRoomUrl) {
                diagnostic.becameVisibleWithin15s = true;
                diagnostic.inputVisibleAfterMs = Number((performance.now() - actionStartedAt).toFixed(1));
                addTimelineEvent('chat-input.visible', { durationMs: diagnostic.inputVisibleAfterMs });
            }
        } catch {
            diagnostic.errorSurface = await page.locator('[role="alert"], .chat-container').allTextContents()
                .then((values) => values.join(' ').trim().slice(0, 1000))
                .catch(() => null);
        }
        diagnostic.finalUrl = page.url();
        diagnostic.reachedChatRoomUrl ||= CHAT_ROOM_URL.test(diagnostic.finalUrl);
        diagnostics.push(diagnostic);
    };

    void page.addInitScript(() => {
        window.__e2eLayoutShifts = [];
        const selectorFor = (node) => {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
            if (node.id) return `#${node.id}`;
            const testId = node.getAttribute('data-testid');
            if (testId) return `[data-testid="${testId}"]`;
            return node.tagName.toLowerCase() + (node.classList.length ? `.${[...node.classList].slice(0, 2).join('.')}` : '');
        };
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.hadRecentInput) continue;
                window.__e2eLayoutShifts.push({
                    value: entry.value,
                    atMs: entry.startTime,
                    sources: (entry.sources || []).map((source) => ({
                        selector: selectorFor(source.node),
                        previousRect: source.previousRect,
                        currentRect: source.currentRect,
                        image: source.node?.tagName === 'IMG' ? {
                            src: source.node.currentSrc || source.node.src,
                            naturalWidth: source.node.naturalWidth,
                            naturalHeight: source.node.naturalHeight,
                            renderedWidth: source.node.clientWidth,
                            renderedHeight: source.node.clientHeight,
                        } : null,
                    })),
                });
            }
        }).observe({ type: 'layout-shift', buffered: true });
    });

    async function collectPageDiagnostics() {
        const selectors = [
            '[data-testid="login-email-input"]', '[data-testid="login-password-input"]',
            '[data-testid="login-submit-button"]',
            '[data-testid="chat-room-name-input"]', '[data-testid="chat-message-input"]',
            '[data-testid="message-submission-status"]', '[data-testid="file-message-container"]',
            '[data-testid="rooms-content-slot"]', '[data-testid="join-chat-room-button"]',
            '[data-testid="rooms-empty"]', '[data-testid="rooms-load-error"]',
            '[data-testid="rooms-socket-error"]',
        ];
        const ui = {};
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            ui[selector] = await inspectLocator(locator);
        }
        const documentState = await page.evaluate(() => ({
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            url: window.location.href,
        })).catch(() => null);
        const roomList = await page.locator('[data-testid="rooms-content-slot"]').first().evaluate((element) => ({
            state: element.dataset.state || null,
            joiningRoomId: element.dataset.joiningRoomId || null,
            navigationTarget: element.dataset.navigationTarget || null,
        })).catch(() => null);
        return {
            url: page.url(),
            document: documentState,
            roomList,
            ui,
            recentHttp: samples.http.slice(-10).map(({
                name, method, normalizedPath, url, status, success, outcome, action, pageUrl, startedAt, endedAt,
            }) => ({
                name, method, normalizedPath, url, status, success, outcome, action, pageUrl, startedAt, endedAt,
            })),
            recentDocuments: samples.documents.slice(-10),
            recentResources: samples.resources.slice(-20),
            recentBrowserErrors: samples.browser.slice(-10),
            recentEventLoopLag: samples.runtime.slice(-10),
            pendingSocketEvents: [...pendingSocketEvents.keys()].map(String),
            pendingRequests: [...startedRequests.values()].map((request) => ({
                method: request.method,
                path: request.path,
                url: request.url,
                action: request.action,
                pageUrl: request.pageUrl,
                startedAt: request.wallStartedAt,
            })),
        };
    }

    async function writeFailureArtifacts(actionName, error) {
        const artifactsDirectory = path.join(runDirectory, 'artifacts');
        const baseName = `${artifactPrefix}-${sanitizeArtifactSegment(actionName)}`;
        const written = [];

        try {
            fs.mkdirSync(artifactsDirectory, { recursive: true });
            const errorFile = path.join(artifactsDirectory, `${baseName}.error.json`);
            fs.writeFileSync(errorFile, `${JSON.stringify(serializeError(error), null, 2)}\n`);
            written.push({ kind: 'error', path: path.relative(runDirectory, errorFile) });
        } catch (artifactError) {
            written.push({ kind: 'error', writeError: artifactError.message });
        }

        try {
            fs.mkdirSync(artifactsDirectory, { recursive: true });
            const screenshotFile = path.join(artifactsDirectory, `${baseName}.png`);
            await page.screenshot({
                path: screenshotFile,
                fullPage: true,
                mask: [page.locator('input'), page.locator('textarea')],
                timeout: 5000,
            });
            written.push({ kind: 'screenshot', path: path.relative(runDirectory, screenshotFile), masked: true });
        } catch (artifactError) {
            written.push({ kind: 'screenshot', writeError: artifactError.message, masked: true });
        }

        artifacts.push(...written.map((artifact) => ({ action: actionName, ...artifact })));
        return written;
    }

    async function action(name, callback) {
        const previousAction = currentAction;
        currentAction = name;
        const startedAt = performance.now();
        const wallStartedAt = new Date().toISOString();
        const urlAtStart = page.url();
        addTimelineEvent('action.started', { action: name, url: urlAtStart });
        try {
            const result = await callback();
            samples.actions.push({
                name, durationMs: performance.now() - startedAt, startedAt: wallStartedAt,
                endedAt: new Date().toISOString(), success: true, urlAtStart, urlAtEnd: page.url(),
            });
            return result;
        } catch (error) {
            const pageDiagnostics = await collectPageDiagnostics();
            const failureArtifacts = await writeFailureArtifacts(name, error);
            samples.actions.push({
                name, durationMs: performance.now() - startedAt, startedAt: wallStartedAt,
                endedAt: new Date().toISOString(), success: false, urlAtStart, urlAtEnd: page.url(),
                error: serializeError(error),
                diagnostics: pageDiagnostics,
                artifacts: failureArtifacts,
            });
            if (name === 'room_create') {
                await diagnoseRoomCreateFailure(error, startedAt);
            }
            throw error;
        } finally {
            addTimelineEvent('action.ended', { action: name });
            currentAction = previousAction;
        }
    }

    async function finish() {
        await new Promise((resolve) => setImmediate(resolve));
        clearInterval(eventLoopTimer);
        page.off('request', onRequest);
        page.off('requestfinished', onRequestFinished);
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
        page.off('websocket', onWebSocket);
        page.off('framenavigated', onFrameNavigated);
        page.off('console', onConsole);
        page.off('pageerror', onPageError);

        samples.layoutShifts = await page.evaluate(() => window.__e2eLayoutShifts || []).catch(() => []);

        fs.mkdirSync(runDirectory, { recursive: true });
        const metadata = {
            ...runMetadata,
            runtimeSnapshot: {
                memoryUsage: process.memoryUsage(),
                resourceUsage: typeof process.resourceUsage === 'function' ? process.resourceUsage() : null,
            },
        };
        const report = {
            schemaVersion: 3,
            runId,
            vuId,
            generatedAt: new Date().toISOString(),
            metadata,
            samples,
            timeline,
            diagnostics,
            artifacts,
            summary: {
                actions: summarizeSamples(samples.actions),
                documents: summarizeSamples(samples.documents),
                resources: summarizeSamples(samples.resources),
                http: summarizeSamples(samples.http),
                httpFailures: summarizeHttpFailures(samples.http),
                socket: summarizeSamples(samples.socket),
                runtime: summarizeSamples(samples.runtime),
                cls: {
                    total: Number(samples.layoutShifts.reduce((sum, entry) => sum + entry.value, 0).toFixed(4)),
                    entries: samples.layoutShifts.length,
                },
            },
        };
        const metadataFilename = `run-metadata-${sanitizeArtifactSegment(runMetadata.pod.name)}-${process.pid}.json`;
        const metadataPath = path.join(runDirectory, metadataFilename);
        if (!fs.existsSync(metadataPath)) {
            fs.writeFileSync(metadataPath, `${JSON.stringify({ runId, ...runMetadata }, null, 2)}\n`);
        }
        const filename = `vu-${artifactPrefix}.json`;
        fs.writeFileSync(path.join(runDirectory, filename), `${JSON.stringify(report, null, 2)}\n`);
        printSummary(report.summary);
        return report;
    }

    return { action, finish };
}

function printTable(title, rows) {
    console.log(`\n[E2E observation] ${title}`);
    console.table(rows.map(({ name, count, success, failure, averageMs, p95Ms, p99Ms, totalDurationMs, contributionPct }) => ({
        name, count, success, failure, averageMs, p95Ms, p99Ms, totalDurationMs, contributionPct,
    })));
}

function printSummary(summary) {
    printTable('User actions', summary.actions);
    printTable('Next.js documents (TTFB)', summary.documents);
    printTable('HTTP API (ranked by cumulative response time)', summary.http);
    printTable('Socket.IO actions', summary.socket);
}

module.exports = {
    createObservation,
    createRunMetadata,
    inspectLocator,
    normalizeApiPath,
    normalizeDocumentPath,
    classifyHttpOutcome,
    enrichHttpSample,
    summarizeHttpFailures,
    parseSocketEvent,
    serializeError,
    summarizeSamples,
    classifyRoomCreateFailure,
};

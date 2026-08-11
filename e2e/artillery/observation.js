const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const INTEGER = /^\d+$/;

const SOCKET_PAIRS = {
    joinRoom: { response: 'joinRoomSuccess', metric: 'room_join' },
    fetchPreviousMessages: { response: 'previousMessagesLoaded', metric: 'message_history' },
    chatMessage: { response: 'message', metric: 'message_send' },
};

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

function createObservation(page, vuContext) {
    const startedRequests = new Map();
    const pendingSocketEvents = new Map();
    const samples = { documents: [], http: [], socket: [], actions: [], layoutShifts: [] };
    let currentAction = null;
    let socketSequence = 0;

    const recordHttp = async (request, success) => {
        const started = startedRequests.get(request);
        startedRequests.delete(request);
        if (!started) return;
        const response = await request.response().catch(() => null);
        samples.http.push({
            name: `${request.method()} ${started.path}`,
            action: started.action,
            durationMs: performance.now() - started.at,
            startedAt: started.wallStartedAt,
            endedAt: new Date().toISOString(),
            success: success && response !== null && response.status() < 400,
            status: response?.status() ?? null,
        });
    };

    const onRequest = (request) => {
        const apiPath = normalizeApiPath(request.url());
        if (apiPath) startedRequests.set(request, {
            at: performance.now(), wallStartedAt: new Date().toISOString(), path: apiPath, action: currentAction,
        });
    };
    const onRequestFinished = (request) => { void recordHttp(request, true); };
    const onRequestFailed = (request) => { void recordHttp(request, false); };
    const onResponse = (response) => {
        const request = response.request();
        if (request.resourceType() !== 'document') return;
        const timing = request.timing();
        const ttfbMs = timing?.responseStart;
        samples.documents.push({
            name: `GET ${normalizeDocumentPath(response.url())}`,
            durationMs: Number.isFinite(ttfbMs) && ttfbMs >= 0 ? ttfbMs : 0,
            startedAt: new Date(Date.now() - Math.max(ttfbMs || 0, 0)).toISOString(),
            endedAt: new Date().toISOString(),
            success: response.status() < 400,
            status: response.status(),
            redirectedFrom: request.redirectedFrom()?.url() || null,
        });
    };
    const onWebSocket = (webSocket) => {
        const connectionKey = `connection:${socketSequence += 1}`;
        pendingSocketEvents.set(connectionKey, {
            at: performance.now(), wallStartedAt: new Date().toISOString(), action: currentAction,
        });

        webSocket.on('framesent', ({ payload }) => {
            const event = parseSocketEvent(payload);
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
            '[data-testid="login-email-input"]', '[data-testid="login-submit-button"]',
            '[data-testid="chat-room-name-input"]', '[data-testid="chat-message-input"]',
            '[data-testid="message-submission-status"]', '[data-testid="file-message-container"]',
        ];
        const ui = {};
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            ui[selector] = {
                count: await locator.count().catch(() => 0),
                visible: await locator.isVisible().catch(() => false),
                enabled: await locator.isEnabled().catch(() => false),
                text: await locator.textContent().catch(() => null),
            };
        }
        return {
            url: page.url(),
            ui,
            recentHttp: samples.http.slice(-10).map(({ name, status, success, action, startedAt, endedAt }) =>
                ({ name, status, success, action, startedAt, endedAt })),
            pendingSocketEvents: [...pendingSocketEvents.keys()].map(String),
        };
    }

    async function action(name, callback) {
        const previousAction = currentAction;
        currentAction = name;
        const startedAt = performance.now();
        const wallStartedAt = new Date().toISOString();
        try {
            const result = await callback();
            samples.actions.push({
                name, durationMs: performance.now() - startedAt, startedAt: wallStartedAt,
                endedAt: new Date().toISOString(), success: true,
            });
            return result;
        } catch (error) {
            samples.actions.push({
                name, durationMs: performance.now() - startedAt, startedAt: wallStartedAt,
                endedAt: new Date().toISOString(), success: false,
                error: { name: error.name, message: error.message },
                diagnostics: await collectPageDiagnostics(),
            });
            throw error;
        } finally {
            currentAction = previousAction;
        }
    }

    async function finish() {
        await new Promise((resolve) => setImmediate(resolve));
        page.off('request', onRequest);
        page.off('requestfinished', onRequestFinished);
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
        page.off('websocket', onWebSocket);

        samples.layoutShifts = await page.evaluate(() => window.__e2eLayoutShifts || []).catch(() => []);

        const runId = process.env.OBSERVATION_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
        const outputRoot = process.env.OBSERVATION_OUTPUT_DIR || path.resolve(__dirname, 'results');
        const runDirectory = path.join(outputRoot, runId);
        fs.mkdirSync(runDirectory, { recursive: true });
        const report = {
            schemaVersion: 1,
            runId,
            vuId: vuContext?._uid || vuContext?.vars?.$uuid || randomUUID(),
            generatedAt: new Date().toISOString(),
            samples,
            summary: {
                actions: summarizeSamples(samples.actions),
                documents: summarizeSamples(samples.documents),
                http: summarizeSamples(samples.http),
                socket: summarizeSamples(samples.socket),
                cls: {
                    total: Number(samples.layoutShifts.reduce((sum, entry) => sum + entry.value, 0).toFixed(4)),
                    entries: samples.layoutShifts.length,
                },
            },
        };
        const filename = `vu-${process.pid}-${randomUUID()}.json`;
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
    normalizeApiPath,
    normalizeDocumentPath,
    parseSocketEvent,
    summarizeSamples,
};

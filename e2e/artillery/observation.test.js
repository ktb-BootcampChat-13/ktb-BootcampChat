const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeApiPath, normalizeDocumentPath, parseSocketEvent, summarizeSamples } = require('./observation');

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

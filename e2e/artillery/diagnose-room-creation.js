#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { classifyRoomCreateFailure, summarizeSamples } = require('./observation');

const runDirectory = path.resolve(process.argv[2] || 'artillery/results');
const files = fs.readdirSync(runDirectory)
    .filter((file) => file.startsWith('vu-') && file.endsWith('.json'));
if (files.length === 0) {
    throw new Error(`No observation JSON files found in ${runDirectory}`);
}

const reports = files.map((file) => ({
    file,
    report: JSON.parse(fs.readFileSync(path.join(runDirectory, file), 'utf8')),
}));
const failures = reports.filter(({ report }) =>
    report.samples?.actions?.some((sample) => sample.name === 'room_create' && !sample.success));
const classifications = failures.map(({ file, report }) => ({
    file,
    classification: classifyRoomCreateFailure(report),
    diagnostic: report.diagnostics?.find((item) => item.action === 'room_create') || null,
    http: report.samples?.http?.filter((sample) => sample.action === 'room_create') || [],
    socket: report.samples?.socket?.filter((sample) => sample.action === 'room_create') || [],
    timeline: report.timeline || [],
    browser: report.samples?.browser || [],
}));
const counts = classifications.reduce((result, item) => {
    result[item.classification] = (result[item.classification] || 0) + 1;
    return result;
}, {});
const relevantHttp = reports.flatMap(({ report }) => report.samples?.http || [])
    .filter((sample) => [
        'POST /api/rooms',
        'POST /api/rooms/{roomId}/join',
        'GET /api/rooms/{roomId}',
    ].includes(sample.name));
const relevantSocket = reports.flatMap(({ report }) => report.samples?.socket || [])
    .filter((sample) => ['connection', 'room_join'].includes(sample.name));
const unclassified = counts.unclassified || 0;
const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runDirectory,
    virtualUsers: reports.length,
    roomCreateFailures: failures.length,
    classificationCounts: counts,
    unclassifiedPct: failures.length === 0 ? 0 : Number(((unclassified / failures.length) * 100).toFixed(1)),
    summary: {
        http: summarizeSamples(relevantHttp),
        socket: summarizeSamples(relevantSocket),
    },
    failures: classifications,
};
const outputPath = path.join(runDirectory, 'room-creation-diagnosis.json');
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(outputPath);
console.log(JSON.stringify({
    virtualUsers: output.virtualUsers,
    roomCreateFailures: output.roomCreateFailures,
    classificationCounts: output.classificationCounts,
    unclassifiedPct: output.unclassifiedPct,
    summary: output.summary,
}, null, 2));

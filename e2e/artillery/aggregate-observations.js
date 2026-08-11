#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { summarizeSamples } = require('./observation');

const runDirectories = process.argv.slice(2).map((value) => path.resolve(value));
if (runDirectories.length === 0) {
    throw new Error('Usage: node aggregate-observations.js <run-directory>...');
}

const reports = runDirectories.flatMap((runDirectory) => fs.readdirSync(runDirectory)
    .filter((file) => file.startsWith('vu-') && file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(runDirectory, file), 'utf8'))));

const samples = { actions: [], http: [], socket: [] };
for (const report of reports) {
    samples.actions.push(...report.samples.actions);
    samples.http.push(...report.samples.http);
    samples.socket.push(...report.samples.socket);
}

const timestamps = Object.values(samples).flat()
    .flatMap((sample) => [sample.startedAt, sample.endedAt])
    .filter(Boolean)
    .sort();
const rankedHttp = summarizeSamples(samples.http.filter((sample) =>
    sample.name !== 'GET /api/health' &&
    !(sample.name === 'POST /api/auth/login' && sample.status === 401)));

const aggregate = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runIds: reports.map((report) => report.runId),
    virtualUsers: reports.length,
    startedAt: timestamps.at(0),
    endedAt: timestamps.at(-1),
    validity: {
        completed: reports.filter((report) => report.samples.actions.length > 0 &&
            report.samples.actions.every((sample) => sample.success)).length,
        failed: reports.filter((report) => report.samples.actions.some((sample) => !sample.success)).length,
        allSamplesHaveWindowsAndNames: Object.values(samples).flat().every((sample) =>
            Boolean(sample.name && sample.startedAt && sample.endedAt)),
    },
    summary: {
        actions: summarizeSamples(samples.actions),
        httpDiagnostic: summarizeSamples(samples.http),
        httpRanked: rankedHttp,
        socket: summarizeSamples(samples.socket),
    },
    samples,
};

const outputPath = process.env.OBSERVATION_AGGREGATE_PATH
    ? path.resolve(process.env.OBSERVATION_AGGREGATE_PATH)
    : path.join(path.dirname(runDirectories[0]), 'aggregate.json');
fs.writeFileSync(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`);
console.log(outputPath);
console.log(JSON.stringify({
    runIds: aggregate.runIds,
    startedAt: aggregate.startedAt,
    endedAt: aggregate.endedAt,
    validity: aggregate.validity,
    httpRanked: aggregate.summary.httpRanked,
    socket: aggregate.summary.socket,
}, null, 2));

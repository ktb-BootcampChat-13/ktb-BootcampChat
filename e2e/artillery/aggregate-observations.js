#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { enrichHttpSample, summarizeHttpFailures, summarizeSamples } = require('./observation');

const runDirectories = process.argv.slice(2).map((value) => path.resolve(value));
if (runDirectories.length === 0) {
    throw new Error('Usage: node aggregate-observations.js <run-directory>...');
}

const reports = runDirectories.flatMap((runDirectory) => fs.readdirSync(runDirectory)
    .filter((file) => file.startsWith('vu-') && file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(runDirectory, file), 'utf8'))));

const samples = { actions: [], documents: [], resources: [], http: [], socket: [], runtime: [], layoutShifts: [] };
for (const report of reports) {
    samples.actions.push(...report.samples.actions);
    samples.documents.push(...(report.samples.documents || []));
    samples.resources.push(...(report.samples.resources || []));
    samples.http.push(...report.samples.http);
    samples.socket.push(...report.samples.socket);
    samples.runtime.push(...(report.samples.runtime || []));
    samples.layoutShifts.push(...(report.samples.layoutShifts || []));
}
samples.http = samples.http.map(enrichHttpSample);

const timestamps = Object.values(samples).flat()
    .flatMap((sample) => [sample.startedAt, sample.endedAt])
    .filter(Boolean)
    .sort();
const rankedHttp = summarizeSamples(samples.http.filter((sample) =>
    sample.name !== 'GET /api/health' && sample.outcome !== 'expected_failure'));
const expectedTotal = Number(process.env.EXPECTED_TOTAL_VUS || 0);
const expectedPerRun = Number(process.env.EXPECTED_VUS || process.env.PHASE1_ARRIVAL_COUNT || 0);
const expectedVirtualUsers = expectedTotal > 0
    ? expectedTotal
    : expectedPerRun > 0 ? expectedPerRun * runDirectories.length : null;
const completedVirtualUsers = reports.filter((report) => report.samples.actions.length > 0 &&
    report.samples.actions.every((sample) => sample.success)).length;
const profiles = [...new Set(reports.map((report) => report.metadata?.workload?.profile).filter(Boolean))];
const expected401Samples = samples.http.filter((sample) => sample.outcome === 'expected_failure' && sample.status === 401);
const unexpected401Samples = samples.http.filter((sample) => sample.outcome === 'unexpected_failure' && sample.status === 401);
const expected401PerVuSatisfied = profiles.length === 1 && profiles[0] === 'auth-negative'
    ? reports.every((report) => report.samples.http.map(enrichHttpSample)
        .filter((sample) => sample.outcome === 'expected_failure' && sample.status === 401).length === 1)
    : expected401Samples.length === 0;

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
            sample.value !== undefined || Boolean(sample.name && sample.startedAt && sample.endedAt)),
        expectedVirtualUsers,
        targetReached: expectedVirtualUsers === null ? null : reports.length === expectedVirtualUsers,
        adoptable: expectedVirtualUsers === null ? false :
            reports.length === expectedVirtualUsers && completedVirtualUsers / expectedVirtualUsers >= 0.99,
        httpExpectations: {
            profiles,
            expected401: expected401Samples.length,
            unexpected401: unexpected401Samples.length,
            expected401PerVuSatisfied,
        },
    },
    summary: {
        actions: summarizeSamples(samples.actions),
        documents: summarizeSamples(samples.documents),
        resources: summarizeSamples(samples.resources),
        httpDiagnostic: summarizeSamples(samples.http),
        httpRanked: rankedHttp,
        httpFailures: summarizeHttpFailures(samples.http),
        expectedHttpFailures: summarizeHttpFailures(samples.http.filter((sample) =>
            sample.outcome === 'expected_failure')),
        unexpectedHttpFailures: summarizeHttpFailures(samples.http.filter((sample) =>
            sample.outcome === 'unexpected_failure')),
        socket: summarizeSamples(samples.socket),
        runtime: summarizeSamples(samples.runtime),
        cls: {
            total: Number(samples.layoutShifts.reduce((sum, entry) => sum + entry.value, 0).toFixed(4)),
            entries: samples.layoutShifts.length,
        },
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

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { enrichHttpSample, summarizeHttpFailures, summarizeSamples } = require('./observation');

const runDirectory = path.resolve(process.argv[2] || 'artillery/results');
const files = fs.readdirSync(runDirectory).filter((file) => file.startsWith('vu-') && file.endsWith('.json'));
if (files.length === 0) throw new Error(`No observation JSON files found in ${runDirectory}`);

const reports = files.map((file) => JSON.parse(fs.readFileSync(path.join(runDirectory, file), 'utf8')));
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
const profiles = [...new Set(reports.map((report) => report.metadata?.workload?.profile).filter(Boolean))];
const expected401Samples = samples.http.filter((sample) => sample.outcome === 'expected_failure' && sample.status === 401);
const unexpected401Samples = samples.http.filter((sample) => sample.outcome === 'unexpected_failure' && sample.status === 401);

const aggregate = {
    schemaVersion: 1,
    runId: reports[0].runId,
    generatedAt: new Date().toISOString(),
    virtualUsers: reports.length,
    httpExpectations: {
        profiles,
        expected401: expected401Samples.length,
        unexpected401: unexpected401Samples.length,
        expected401PerVuSatisfied: profiles.length === 1 && profiles[0] === 'auth-negative'
            ? reports.every((report) => report.samples.http.map(enrichHttpSample)
                .filter((sample) => sample.outcome === 'expected_failure' && sample.status === 401).length === 1)
            : expected401Samples.length === 0,
    },
    summary: {
        actions: summarizeSamples(samples.actions),
        documents: summarizeSamples(samples.documents),
        resources: summarizeSamples(samples.resources),
        http: summarizeSamples(samples.http),
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
};
fs.writeFileSync(path.join(runDirectory, 'summary.json'), `${JSON.stringify(aggregate, null, 2)}\n`);
for (const [name, rows] of Object.entries(aggregate.summary)) {
    console.log(`\n[E2E observation aggregate] ${name}`);
    console.table(rows);
}

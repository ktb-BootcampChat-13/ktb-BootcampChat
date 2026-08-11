#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { parseArgs, median, decideOptimization } = require('./lib');

const args = parseArgs(process.argv.slice(2));
const before = loadRuns(required('before'));
const after = loadRuns(required('after'));
const observation = args.observation ? JSON.parse(fs.readFileSync(args.observation, 'utf8')) : {};
const beforeP95 = median(before.map((run) => run.latencyMs.p95));
const afterP95 = median(after.map((run) => run.latencyMs.p95));
const beforeP99 = median(before.map((run) => run.latencyMs.p99));
const afterP99 = median(after.map((run) => run.latencyMs.p99));
const improvement = beforeP95 > 0 ? (beforeP95 - afterP95) / beforeP95 : 0;
const resourceMetrics = ['processCpu', 'heapUsed', 'gcPauseRate', 'mongoCommandMax', 'mongoCheckedOut'];
const resources = Object.fromEntries(resourceMetrics.map((name) => {
  const beforeValue = median(before.map((run) => observationMaximum(run, name)));
  const afterValue = median(after.map((run) => observationMaximum(run, name)));
  return [name, { before: beforeValue, after: afterValue, regressed: beforeValue !== null && afterValue !== null && afterValue > beforeValue }];
}));
const resourcesRegressed = Object.values(resources).some((metric) => metric.regressed);
const resourcesComplete = Object.values(resources).every((metric) => metric.before !== null && metric.after !== null);
const adopted = before.length >= 3 && after.length >= 3 && improvement >= 0.10
  && after.every((run) => run.errorRate <= 0.01 && run.timeoutCount === 0)
  && afterP99 <= beforeP99
  && !resourcesRegressed
  && resourcesComplete
  && after.every((run) => !run.waitQueueDetected && !run.checkoutFailureDetected);

console.log(JSON.stringify({
  beforeRuns: before.length, afterRuns: after.length,
  median: { beforeP95Ms: beforeP95, afterP95Ms: afterP95, p95Improvement: improvement, beforeP99Ms: beforeP99, afterP99Ms: afterP99 },
  resources: { complete: resourcesComplete, metrics: resources },
  temporaryAdoptionEligible: improvement >= 0.10 && after.every((run) => run.errorRate <= 0.01 && run.timeoutCount === 0) && afterP99 <= beforeP99 && resourcesComplete && !resourcesRegressed,
  finalAdoption: adopted,
  selectedFirstOptimization: decideOptimization(observation),
}, null, 2));

function loadRuns(file) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(payload) ? payload : payload.runs || [payload];
}
function observationMaximum(run, name) {
  const series = run.observability?.[name];
  if (!Array.isArray(series)) return null;
  const values = series.flatMap((item) => item.values || []).map((pair) => pair[1]).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}
function required(name) { if (!args[name]) throw new Error(`--${name} is required`); return args[name]; }

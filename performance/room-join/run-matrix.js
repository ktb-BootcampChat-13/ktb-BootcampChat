#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PROMETHEUS_QUERIES, parseArgs, ensureResultPath } = require('./lib');

const ROOT = __dirname;
const args = parseArgs(process.argv.slice(2));
const manifestPath = required('manifest');
const testId = args['test-id'] || `room-join-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const apiUrl = args['api-url'] || 'http://localhost:5001';
const prometheusUrl = args['prometheus-url'] || 'http://localhost:9090';
const mongoUri = args['mongo-uri'] || 'mongodb://localhost:27017/bootcamp-chat';
const modes = (args.modes || 'idempotent,new-participant').split(',');
const stages = parseStages(args.stages || '1:30s,10:1m,30:1m,50:1m,100:1m');
const fixtures = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).fixtures;
const commit = command('git', ['rev-parse', 'HEAD']).stdout.trim();
const aggregate = { schemaVersion: 1, testId, commit, startedAt: new Date().toISOString(), runs: [], stopped: [] };

for (const fixture of fixtures) {
  if (!fixture.valid) throw new Error(`invalid fixture: ${fixture.id}`);
  for (const mode of modes) {
    let smokeP95 = 0;
    for (const [vus, duration] of stages) {
      if (mode === 'new-participant') resetNewParticipants(fixture.roomId);
      const runId = `${testId}-${fixture.id}-${mode}-${vus}vu`;
      const relativeResult = `results/${runId}.json`;
      const resultPath = ensureResultPath(ROOT, relativeResult);
      const startedAt = new Date().toISOString();
      const k6Environment = {
        API_BASE_URL: apiUrl, TEST_ID: runId, FIXTURE_ID: fixture.id,
        ROOM_ID: fixture.roomId, PARTICIPANTS: String(fixture.participants), MESSAGES: String(fixture.messages),
        MODE: mode, VUS: String(vus), DURATION: duration, SMOKE_P95_MS: String(smokeP95),
        RESULT_PATH: resultPath, GIT_COMMIT: commit,
      };
      if (process.env.PERF_PASSWORD) k6Environment.PERF_PASSWORD = process.env.PERF_PASSWORD;
      const k6Process = command('k6', ['run', ...k6EnvArgs(k6Environment), path.join(ROOT, 'room-join.js')], undefined, false);
      if (!fs.existsSync(resultPath)) throw new Error(`k6 did not write ${resultPath}: ${k6Process.stderr}`);
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      result.observability = collectPrometheus(prometheusUrl, startedAt, result.endedAt);
      result.waitQueueDetected = maximum(result.observability.mongoWaitQueue) > 0;
      result.checkoutFailureDetected = maximum(result.observability.mongoCheckoutFailures) > 0;
      fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
      aggregate.runs.push(result);
      if (vus === 1) smokeP95 = result.latencyMs.p95;
      const reason = stopReason(result, smokeP95, k6Process.status);
      if (reason) {
        aggregate.stopped.push({ fixture: fixture.id, mode, afterVus: vus, reason });
        break;
      }
    }
  }
}

function resetNewParticipants(roomId) {
  const escapedTestId = JSON.stringify(fixturesTestId());
  const escapedRoomId = JSON.stringify(roomId);
  const script = `const ids=db.users.find({perfJoinTestId:${escapedTestId},perfJoinRole:'new'},{_id:1}).toArray().map(u=>u._id.toString()); db.rooms.updateOne({_id:ObjectId(${escapedRoomId}),perfJoinTestId:${escapedTestId}},{$pull:{participantIds:{$in:ids}}}); print('reset='+ids.length);`;
  command('mongosh', ['--quiet', mongoUri, '--eval', script]);
}

function fixturesTestId() {
  const ids = new Set(fixtures.map((fixture) => fixture.id.match(/^perf-join-(.+)-p\d+-m\d+$/)?.[1]));
  if (ids.size !== 1 || ids.has(undefined)) throw new Error('manifest fixture IDs do not share one valid test ID');
  return [...ids][0];
}

aggregate.endedAt = new Date().toISOString();
const aggregatePath = ensureResultPath(ROOT, `results/${testId}-aggregate.json`);
fs.writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);
console.log(aggregatePath);

function collectPrometheus(baseUrl, start, end) {
  const observations = {};
  for (const [name, query] of Object.entries(PROMETHEUS_QUERIES)) {
    const url = `${baseUrl}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&step=5s`;
    try {
      const response = command('curl', ['-fsS', url], undefined, false);
      const payload = JSON.parse(response.stdout);
      observations[name] = (payload.data?.result || []).map((series) => ({
        metric: series.metric,
        values: series.values.map(([timestamp, value]) => [timestamp, Number(value)]),
      }));
    } catch (error) {
      observations[name] = { error: error.message };
    }
  }
  return observations;
}

function maximum(series) {
  if (!Array.isArray(series)) return 0;
  return Math.max(0, ...series.flatMap((item) => item.values.map((pair) => pair[1])).filter(Number.isFinite));
}

function stopReason(result, smokeP95, exitCode) {
  if (exitCode !== 0 || !result.thresholdsPassed) return 'k6 threshold failed';
  if (result.errorRate > 0.01) return 'error rate exceeded 1%';
  if (result.timeoutCount > 0) return 'timeout detected';
  if (smokeP95 > 0 && result.latencyMs.p95 > smokeP95 * 2) return 'p95 exceeded 2x smoke p95';
  if (result.waitQueueDetected) return 'Mongo wait queue detected';
  if (result.checkoutFailureDetected) return 'Mongo checkout failure detected';
  return null;
}

function parseStages(value) {
  return value.split(',').map((stage) => {
    const [vus, duration] = stage.split(':');
    if (!/^\d+$/.test(vus) || Number(vus) <= 0 || !/^\d+(ms|s|m|h)$/.test(duration || '')) {
      throw new Error(`invalid stage: ${stage}`);
    }
    return [Number(vus), duration];
  });
}

function command(executable, commandArgs, env, throwOnFailure = true) {
  const result = spawnSync(executable, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  if (result.error || (throwOnFailure && result.status !== 0)) {
    throw new Error(`${executable} failed: ${result.error?.message || result.stderr}`);
  }
  return result;
}

function k6EnvArgs(environment) {
  return Object.entries(environment).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
}
function required(name) { if (!args[name]) throw new Error(`--${name} is required`); return args[name]; }

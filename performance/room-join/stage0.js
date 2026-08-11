#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, ensureResultPath } = require('./lib');

const args = parseArgs(process.argv.slice(2));
const fixture = required('fixture');
const roomId = required('room-id');
const mode = args.mode || 'idempotent';
const testId = args['test-id'] || `stage0-${fixture}-${mode}`;
const mongoUri = args['mongo-uri'] || 'mongodb://localhost:27017/bootcamp-chat';
const apiUrl = args['api-url'] || 'http://localhost:5001';
const outputPath = ensureResultPath(__dirname, `results/${testId}-diagnosis.json`);
const start = new Date();
const previousLevel = Number(mongoEval('db.getProfilingStatus().was'));

try {
  mongoEval('db.setProfilingLevel(2, { slowms: 0 }); print("enabled")');
  const k6Result = path.join(__dirname, 'results', `${testId}-request.json`);
  const k6Environment = {
    API_BASE_URL: apiUrl, TEST_ID: testId, FIXTURE_ID: fixture, ROOM_ID: roomId,
    MODE: mode, VUS: '1', ITERATIONS: '1', DURATION: '30s', RESULT_PATH: k6Result,
    PARTICIPANTS: args.participants || '1', MESSAGES: args.messages || '0',
  };
  if (process.env.PERF_PASSWORD) k6Environment.PERF_PASSWORD = process.env.PERF_PASSWORD;
  run('k6', ['run', ...k6EnvArgs(k6Environment), path.join(__dirname, 'room-join.js')]);
  const profiler = JSON.parse(mongoEval(`
    const since = ISODate('${start.toISOString()}');
    const rows = db.system.profile.find({ ts: { $gte: since } }).toArray();
    const commands = {};
    rows.forEach(r => { const key = r.ns + ':' + (r.op || r.commandName || 'command'); commands[key] = (commands[key] || 0) + 1; });
    print(EJSON.stringify({ commandCount: rows.length, commands, rows: rows.map(r => ({ ts:r.ts, op:r.op, ns:r.ns, millis:r.millis, docsExamined:r.docsExamined, keysExamined:r.keysExamined, nreturned:r.nreturned, command:r.command })) }));
  `));
  const explain = JSON.parse(mongoEval(`
    const history = db.messages.find({room:'${roomId}'}).sort({timestamp:-1}).limit(30).explain('executionStats');
    const recent = db.messages.find({room:'${roomId}',timestamp:{$gte:new Date(Date.now()-600000)}}).explain('executionStats');
    function summary(x) { const e=x.executionStats; return { winningPlan:x.queryPlanner.winningPlan, nReturned:e.nReturned, totalDocsExamined:e.totalDocsExamined, totalKeysExamined:e.totalKeysExamined, executionTimeMillis:e.executionTimeMillis }; }
    print(EJSON.stringify({ history:summary(history), recentCount:summary(recent) }));
  `));
  fs.writeFileSync(outputPath, `${JSON.stringify({
    schemaVersion: 1, testId, fixture, roomId, mode,
    startedAt: start.toISOString(), endedAt: new Date().toISOString(), profiler, explain,
  }, null, 2)}\n`);
  console.log(outputPath);
} finally {
  mongoEval(`db.setProfilingLevel(${Number.isInteger(previousLevel) ? previousLevel : 0}); print('restored')`);
}

function mongoEval(script) {
  return run('mongosh', ['--quiet', mongoUri, '--eval', script]).stdout.trim().split('\n').at(-1);
}
function run(executable, commandArgs, env) {
  const result = spawnSync(executable, commandArgs, { encoding: 'utf8', env });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.error?.message || result.stderr}`);
  return result;
}
function k6EnvArgs(environment) {
  return Object.entries(environment).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
}
function required(name) { if (!args[name]) throw new Error(`--${name} is required`); return args[name]; }

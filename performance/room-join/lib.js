'use strict';

const fs = require('fs');
const path = require('path');

const PROMETHEUS_QUERIES = {
  processCpu: 'process_cpu_usage',
  heapUsed: 'jvm_memory_used_bytes{area="heap"}',
  gcPauseRate: 'rate(jvm_gc_pause_seconds_sum[1m])',
  httpAverage: 'sum(rate(http_server_requests_seconds_sum{uri="/api/rooms/{roomId}/join"}[1m]))/sum(rate(http_server_requests_seconds_count{uri="/api/rooms/{roomId}/join"}[1m]))',
  httpMax: 'max(http_server_requests_seconds_max{uri="/api/rooms/{roomId}/join"})',
  mongoCommandRate: 'sum(rate(mongodb_driver_commands_seconds_count[1m]))',
  mongoCommandMax: 'max(mongodb_driver_commands_seconds_max)',
  mongoCheckedOut: 'sum(mongodb_driver_pool_checkedout)',
  mongoWaitQueue: 'sum(mongodb_driver_pool_waitqueuesize)',
  mongoCheckoutFailures: 'sum(increase(mongodb_driver_pool_checkoutfailed_total[1m]))',
  tomcatBusyThreads: 'sum(tomcat_threads_busy_threads)',
  tomcatCurrentThreads: 'sum(tomcat_threads_current_threads)',
  tomcatMaxThreads: 'sum(tomcat_threads_config_max_threads)',
  tomcatBusyRatio: 'sum(tomcat_threads_busy_threads)/sum(tomcat_threads_config_max_threads)',
};

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`unexpected argument: ${argument}`);
    const [key, inline] = argument.slice(2).split('=', 2);
    const value = inline === undefined ? argv[++index] : inline;
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
  }
  return values;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function decideOptimization(observation) {
  if (observation.messagesScaleWithLatency && observation.planStage === 'COLLSCAN') {
    return '{ room: 1, timestamp: 1 } index';
  }
  if (observation.participantsScaleWithCommands) {
    return 'batch participant lookup and remove duplicate response assembly';
  }
  if (observation.newParticipantOnlyRegression || observation.missingParticipant) {
    return '$addToSet atomic participant update';
  }
  return 'no optimization selected; collect more Stage 0 evidence';
}

function ensureResultPath(root, requested) {
  const resultRoot = path.resolve(root, 'results');
  const resolved = path.resolve(root, requested);
  if (resolved !== resultRoot && !resolved.startsWith(`${resultRoot}${path.sep}`)) {
    throw new Error(`result path must stay under ${resultRoot}`);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

module.exports = { PROMETHEUS_QUERIES, parseArgs, median, decideOptimization, ensureResultPath };

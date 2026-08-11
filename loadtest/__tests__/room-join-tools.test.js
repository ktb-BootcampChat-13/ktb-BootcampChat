'use strict';

const { median, decideOptimization, parseArgs } = require('../../performance/room-join/lib');

describe('room join performance helpers', () => {
  test('median supports three-run adoption comparisons', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20])).toBe(15);
  });

  test.each([
    [{ messagesScaleWithLatency: true, planStage: 'COLLSCAN' }, '{ room: 1, timestamp: 1 } index'],
    [{ participantsScaleWithCommands: true }, 'batch participant lookup and remove duplicate response assembly'],
    [{ newParticipantOnlyRegression: true }, '$addToSet atomic participant update'],
  ])('selects the first optimization from evidence', (input, expected) => {
    expect(decideOptimization(input)).toBe(expected);
  });

  test('parses both inline and separate CLI values', () => {
    expect(parseArgs(['--mode=idempotent', '--vus', '10'])).toEqual({ mode: 'idempotent', vus: '10' });
  });
});

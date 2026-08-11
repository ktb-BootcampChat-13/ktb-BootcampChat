const database = db.getSiblingDB('bootcamp-chat');
const fixtureId = process.env.FIXTURE_ID;
const action = process.env.ACTION || 'create';
const email = process.env.LOAD_TEST_EMAIL;
const prefix = `${fixtureId}:`;

if (!fixtureId) throw new Error('FIXTURE_ID is required');

const conditions = [
  { key: 'p10-m1k', participants: 10, messages: 1000 },
  { key: 'p10-m10k', participants: 10, messages: 10000 },
  { key: 'p10-m100k', participants: 10, messages: 100000 },
  { key: 'p100-m1k', participants: 100, messages: 1000 },
  { key: 'p100-m10k', participants: 100, messages: 10000 },
  { key: 'p100-m100k', participants: 100, messages: 100000 },
  { key: 'p500-m1k', participants: 500, messages: 1000 },
  { key: 'p500-m10k', participants: 500, messages: 10000 },
  { key: 'p500-m100k', participants: 500, messages: 100000 },
];

function cleanup(removeOwner = true) {
  const roomIds = conditions.map((condition) => `${prefix}room:${condition.key}`);
  const removed = {
    messages: database.messages.deleteMany({ room: { $in: roomIds } }).deletedCount,
    rooms: database.rooms.deleteMany({ _id: { $regex: `^${prefix}` } }).deletedCount,
    users: database.users.deleteMany({
      $or: [
        { _id: { $regex: `^${prefix}` } },
        ...(removeOwner && email ? [{ email }] : []),
      ],
    }).deletedCount,
  };
  printjson({ action: 'cleanup', fixtureId, removed });
}

function create() {
  cleanup(false);
  const owner = database.users.findOne({ email });
  if (!owner) throw new Error(`Load-test owner not found: ${email}`);
  const selected = conditions.find((condition) => condition.key === process.env.CONDITION);
  if (!selected) throw new Error(`Unknown CONDITION: ${process.env.CONDITION}`);
  const now = new Date();
  const users = [];
  for (let index = 0; index < selected.participants; index += 1) {
    users.push({
      _id: `${prefix}user:${index}`,
      name: `Room detail participant ${index}`,
      email: `${fixtureId}-${index}@fixture.invalid`,
      password: 'not-used',
      createdAt: now,
      updatedAt: now,
      isOnline: false,
    });
  }
  database.users.insertMany(users, { ordered: false });

  for (const condition of [selected]) {
    const roomId = `${prefix}room:${condition.key}`;
    const participantIds = users.slice(0, condition.participants).map((user) => user._id);
    database.rooms.insertOne({
      _id: roomId,
      name: `Room detail ${condition.key}`,
      creator: owner._id,
      hasPassword: true,
      password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      participantIds,
      createdAt: now,
    });
    for (let offset = 0; offset < condition.messages; offset += 1000) {
      const batchSize = Math.min(1000, condition.messages - offset);
      const messages = Array.from({ length: batchSize }, (_, index) => ({
        _id: `${prefix}message:${condition.key}:${offset + index}`,
        room: roomId,
        sender: participantIds[(offset + index) % participantIds.length],
        content: `fixture message ${offset + index}`,
        type: 'TEXT',
        timestamp: now,
        mentions: [],
        reactions: {},
        readers: [],
        metadata: {},
      }));
      database.messages.insertMany(messages, { ordered: false });
    }
  }
  printjson({ action: 'create', fixtureId, ownerId: owner._id, condition: selected });
}

function refresh() {
  const roomId = `${prefix}room:${process.env.CONDITION}`;
  const result = database.messages.updateMany({ room: roomId }, { $set: { timestamp: new Date() } });
  printjson({ action: 'refresh', roomId, matched: result.matchedCount, modified: result.modifiedCount });
}

function explain() {
  const roomId = `${prefix}room:${process.env.CONDITION}`;
  const since = new Date(Date.now() - (30 * 60 * 1000));
  const result = database.messages.find({ room: roomId, timestamp: { $gte: since } })
    .explain('executionStats');
  printjson({
    action: 'explain',
    roomId,
    winningPlan: result.queryPlanner.winningPlan,
    executionStats: result.executionStats,
  });
}

if (action === 'create') create();
else if (action === 'cleanup') cleanup();
else if (action === 'refresh') refresh();
else if (action === 'explain') explain();
else throw new Error(`Unknown ACTION: ${action}`);

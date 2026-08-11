/* global db, print, quit, ObjectId */

// Run with mongosh: TEST_ID=... ACTION=create mongosh bootcamp-chat fixture.js
const action = process.env.ACTION || 'create';
const testId = process.env.TEST_ID;
const prefix = `perf-join-${testId}`;
const passwordHash = process.env.PASSWORD_HASH;
const fixedMessages = integerEnv('FIXED_MESSAGES', 1000);
const messageAxis = intList(process.env.MESSAGE_AXIS || '1000,10000,100000');
const participantAxis = intList(process.env.PARTICIPANT_AXIS || '10,100,500');
const maxVus = integerEnv('MAX_VUS', 100);

if (!testId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(testId)) fail('invalid or missing TEST_ID');
if (action === 'create' && !passwordHash) fail('PASSWORD_HASH is required for create');
if (!['create', 'verify', 'delete'].includes(action)) fail(`unsupported ACTION=${action}`);

const fixtureRooms = [
  ...messageAxis.map((messages) => ({ axis: 'messages', participants: 10, messages })),
  ...participantAxis.map((participants) => ({ axis: 'participants', participants, messages: fixedMessages })),
].filter((fixture, index, all) => all.findIndex((candidate) =>
  candidate.participants === fixture.participants && candidate.messages === fixture.messages) === index);

if (action === 'delete') {
  const roomIds = db.rooms.find({ perfJoinTestId: testId }, { _id: 1 }).toArray().map((room) => room._id);
  const messages = db.messages.deleteMany({ $or: [{ perfJoinTestId: testId }, { room: { $in: roomIds } }] });
  const rooms = db.rooms.deleteMany({ perfJoinTestId: testId });
  const users = db.users.deleteMany({ perfJoinTestId: testId, email: { $regex: `^${escapeRegex(prefix)}-` } });
  print(EJSON.stringify({ action, testId, deleted: { users: users.deletedCount, rooms: rooms.deletedCount, messages: messages.deletedCount } }));
  quit(0);
}

if (action === 'create') {
  if (db.rooms.countDocuments({ perfJoinTestId: testId }) > 0
      || db.users.countDocuments({ perfJoinTestId: testId }) > 0
      || db.messages.countDocuments({ perfJoinTestId: testId }) > 0) {
    fail(`fixture ${testId} already exists; delete it explicitly before recreating`);
  }
  const maximumParticipants = Math.max(...fixtureRooms.map((fixture) => fixture.participants));
  const memberCount = Math.max(maximumParticipants, maxVus);
  const users = [];
  for (let index = 0; index < memberCount; index += 1) users.push(user('member', index));
  for (let index = 0; index < maxVus; index += 1) users.push(user('new', index));
  db.users.insertMany(users, { ordered: false });

  const memberIds = users.filter((item) => item.perfJoinRole === 'member').map((item) => item._id);
  fixtureRooms.forEach((fixture) => {
    const slug = `p${fixture.participants}-m${fixture.messages}`;
    const roomId = new ObjectId();
    db.rooms.insertOne({
      _id: roomId,
      name: `${prefix}-${slug}`,
      creator: memberIds[0].toString(),
      hasPassword: false,
      createdAt: new Date(),
      participantIds: memberIds.slice(0, fixture.participants).map(String),
      perfJoinTestId: testId,
      perfJoinFixture: slug,
      perfJoinAxis: fixture.axis,
    });
    insertMessages(roomId.toString(), fixture.messages, memberIds);
  });
}

const verification = verify();
print(EJSON.stringify({ action, testId, prefix, fixtures: verification }));
if (verification.some((fixture) => !fixture.valid)) quit(2);

function user(role, index) {
  return {
    _id: new ObjectId(),
    name: `${prefix}-${role}-${index}`,
    email: `${prefix}-${role}-${index}@perf-join.test`,
    password: passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
    isOnline: false,
    perfJoinTestId: testId,
    perfJoinRole: role,
  };
}

function insertMessages(roomId, count, memberIds) {
  const batchSize = 1000;
  for (let offset = 0; offset < count; offset += batchSize) {
    const batch = [];
    const limit = Math.min(count, offset + batchSize);
    for (let index = offset; index < limit; index += 1) {
      batch.push({
        room: roomId,
        sender: memberIds[index % memberIds.length].toString(),
        content: `${prefix}-message-${index}`,
        type: 'TEXT',
        timestamp: new Date(Date.now() - (count - index) * 1000),
        mentions: [], reactions: {}, readers: [], metadata: {},
        perfJoinTestId: testId,
      });
    }
    db.messages.insertMany(batch, { ordered: false });
  }
}

function verify() {
  return fixtureRooms.map((expected) => {
    const slug = `p${expected.participants}-m${expected.messages}`;
    const room = db.rooms.findOne({ perfJoinTestId: testId, perfJoinFixture: slug });
    const actualMessages = room ? db.messages.countDocuments({ perfJoinTestId: testId, room: room._id.toString() }) : 0;
    const actualParticipants = room?.participantIds?.length || 0;
    return {
      id: `${prefix}-${slug}`,
      roomId: room ? room._id.toString() : null,
      axis: room?.perfJoinAxis || expected.axis,
      participants: actualParticipants,
      messages: actualMessages,
      valid: Boolean(room) && actualParticipants === expected.participants && actualMessages === expected.messages,
    };
  });
}

function intList(value) {
  const values = value.split(',').map((item) => Number(item.trim()));
  if (values.some((item) => !Number.isInteger(item) || item <= 0)) fail(`invalid integer list: ${value}`);
  return values;
}

function integerEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive integer`);
  return value;
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fail(message) { print(`ERROR: ${message}`); quit(1); }

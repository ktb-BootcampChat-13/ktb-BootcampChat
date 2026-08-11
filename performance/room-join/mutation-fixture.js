const database = db.getSiblingDB('bootcamp-chat');
const fixtureId = process.env.FIXTURE_ID;
const action = process.env.ACTION || 'create';
const accountCount = Number(process.env.ACCOUNT_COUNT || 30);
const accountPrefix = process.env.ACCOUNT_PREFIX || 'loadtest';
const creatorEmail = process.env.CREATOR_EMAIL;
const roomsPerAccount = Number(process.env.ROOMS_PER_ACCOUNT || 200);
const prefix = `${fixtureId}:room:`;

if (!fixtureId) throw new Error('FIXTURE_ID is required');

function cleanup() {
  const removed = database.rooms.deleteMany({ _id: { $regex: `^${prefix}` } }).deletedCount;
  printjson({ action: 'cleanup', fixtureId, removedRooms: removed });
}

function create() {
  cleanup();
  if (!creatorEmail) throw new Error('CREATOR_EMAIL is required');
  const creator = database.users.findOne({ email: creatorEmail });
  if (!creator) throw new Error(`Missing room creator ${creatorEmail}`);
  const users = [];
  for (let index = 0; index < accountCount; index += 1) {
    const email = `${accountPrefix}-${index}@test.com`;
    const user = database.users.findOne({ email });
    if (!user) throw new Error(`Missing load-test account ${email}`);
    users.push(user);
  }
  const creatorId = creator._id.toString();
  const now = new Date();
  for (let vu = 1; vu <= accountCount; vu += 1) {
    const rooms = [];
    for (let iteration = 0; iteration < roomsPerAccount; iteration += 1) {
      rooms.push({
        _id: `${prefix}${vu}:${iteration}`,
        name: `Room join mutation ${vu}:${iteration}`,
        creator: creatorId,
        hasPassword: false,
        participantIds: [creatorId],
        createdAt: now,
      });
    }
    database.rooms.insertMany(rooms, { ordered: false });
  }
  printjson({ action: 'create', fixtureId, accountCount, roomsPerAccount });
}

if (action === 'create') create();
else if (action === 'cleanup') cleanup();
else throw new Error(`Unknown ACTION: ${action}`);

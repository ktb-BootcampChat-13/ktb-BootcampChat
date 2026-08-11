const test = require('node:test');
const assert = require('node:assert/strict');
const { joinRandomChatRoomAction, waitForRoomListReady } = require('./chat.actions');

function roomListPage({ state = 'ready', buttonCount = 1, emptyVisible = false } = {}) {
  const content = {
    waitFor: async () => {},
    getAttribute: async (name) => name === 'data-state' ? state : null,
  };
  const button = {
    getAttribute: async () => '507f1f77bcf86cd799439011',
    click: async () => {},
  };
  const buttons = {
    count: async () => buttonCount,
    nth: () => button,
  };
  return {
    content,
    button,
    buttons,
    page: {
      url: () => 'http://localhost:3000/chat',
      waitForFunction: async () => {},
      getByTestId: (testId) => {
        if (testId === 'rooms-content-slot') return content;
        if (testId === 'join-chat-room-button') return buttons;
        if (testId === 'rooms-empty') return { isVisible: async () => emptyVisible };
        throw new Error(`unexpected test id: ${testId}`);
      },
    },
  };
}

test('accepts both a populated and an empty ready room list', async () => {
  const populated = roomListPage({ buttonCount: 2 });
  assert.equal((await waitForRoomListReady(populated.page)).hasRooms, true);

  const empty = roomListPage({ buttonCount: 0, emptyVisible: true });
  assert.equal((await waitForRoomListReady(empty.page)).isEmpty, true);
});

test('reports an explicit room-list load failure', async () => {
  const { page } = roomListPage({ state: 'error', buttonCount: 0 });
  await assert.rejects(waitForRoomListReady(page), { code: 'ROOM_LIST_LOAD_FAILED' });
});

test('joins by the room id carried by the selected button and waits for that URL', async () => {
  const roomId = '507f1f77bcf86cd799439011';
  const fixture = roomListPage();
  const waitedUrls = [];
  fixture.page.goto = async () => {};
  fixture.page.waitForResponse = async (predicate) => {
    const response = {
      url: () => `http://localhost:3000/api/rooms/${roomId}/join`,
      request: () => ({ method: () => 'POST' }),
      ok: () => true,
      status: () => 200,
      json: async () => ({ success: true }),
    };
    assert.equal(predicate(response), true);
    return response;
  };
  fixture.page.waitForURL = async (url) => { waitedUrls.push(url); };
  const originalGetByTestId = fixture.page.getByTestId;
  fixture.page.getByTestId = (testId) => testId === 'chat-message-input'
    ? { waitFor: async () => {} }
    : originalGetByTestId(testId);

  const selected = await joinRandomChatRoomAction(fixture.page);

  assert.equal(selected, roomId);
  assert.deepEqual(waitedUrls, [`http://localhost:3000/chat/${roomId}`]);
});

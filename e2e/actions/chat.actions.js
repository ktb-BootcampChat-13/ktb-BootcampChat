const { bannedWordSafeToken } = require('../utils/bannedWordSafeText');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ROOM_READY_TIMEOUT = Number(process.env.ROOM_READY_TIMEOUT || 5000);

function scenarioError(code, message, cause) {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

async function waitForRoomListReady(page, { timeout = ROOM_READY_TIMEOUT } = {}) {
  const content = page.getByTestId('rooms-content-slot');
  try {
    await content.waitFor({ state: 'visible', timeout });
    await page.waitForFunction(
      () => ['ready', 'error'].includes(
        document.querySelector('[data-testid="rooms-content-slot"]')?.dataset.state
      ),
      undefined,
      { timeout }
    );
  } catch (error) {
    throw scenarioError(
      'ROOM_LIST_READY_TIMEOUT',
      `채팅방 목록이 ${timeout}ms 안에 준비되지 않았습니다. Current URL: ${page.url()}`,
      error
    );
  }

  const state = await content.getAttribute('data-state');
  if (state === 'error') {
    throw scenarioError('ROOM_LIST_LOAD_FAILED', `채팅방 목록 API가 실패했습니다. Current URL: ${page.url()}`);
  }

  const buttons = page.getByTestId('join-chat-room-button');
  const hasRooms = await buttons.count() > 0;
  const isEmpty = await page.getByTestId('rooms-empty').isVisible().catch(() => false);
  if (!hasRooms && !isEmpty) {
    throw scenarioError(
      'ROOM_LIST_RENDER_INCONSISTENT',
      `목록 상태는 ready지만 방 버튼과 빈 상태가 모두 없습니다. Current URL: ${page.url()}`
    );
  }

  return { buttons, hasRooms, isEmpty };
}

async function waitForChatRoomReady(page, { timeout = ROOM_READY_TIMEOUT } = {}) {
  try {
    await page.getByTestId('chat-message-input').waitFor({ state: 'visible', timeout });
  } catch (error) {
    throw scenarioError(
      'CHAT_ROOM_RENDER_TIMEOUT',
      `채팅 입력창이 ${timeout}ms 안에 표시되지 않았습니다. Current URL: ${page.url()}`,
      error
    );
  }
}

/**
 * 첫 번째 채팅방 입장 액션
 * @param {import('@playwright/test').Page} page
 */
async function joinFirstChatRoomAction(page) {
  await page.goto(`${BASE_URL}/chat`);
  await page.getByTestId('join-chat-room-button').first().click();
}

/**
 * 랜덤 채팅방 입장 액션
 * @param {import('@playwright/test').Page} page
 */
async function joinRandomChatRoomAction(page) {
  await page.goto(`${BASE_URL}/chat`);

  const { buttons: chatRoomButtons, hasRooms } = await waitForRoomListReady(page);
  if (!hasRooms) {
    throw scenarioError('ROOM_LIST_EMPTY', '입장할 채팅방이 없습니다.');
  }

  const count = await chatRoomButtons.count();

  const randomIndex = Math.floor(Math.random() * count);
  const button = chatRoomButtons.nth(randomIndex);
  const roomId = await button.getAttribute('data-room-id');
  if (!roomId) {
    throw scenarioError('ROOM_LIST_RENDER_INCONSISTENT', '입장 버튼에 room ID가 없습니다.');
  }

  const joinResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/rooms/${roomId}/join`,
  { timeout: ROOM_READY_TIMEOUT });

  let response;
  try {
    [response] = await Promise.all([joinResponsePromise, button.click()]);
  } catch (error) {
    throw scenarioError('JOIN_HTTP_FAILED', `채팅방 ${roomId} 입장 요청이 완료되지 않았습니다.`, error);
  }

  if (!response.ok()) {
    throw scenarioError('JOIN_HTTP_FAILED', `채팅방 ${roomId} 입장 요청이 HTTP ${response.status()}로 실패했습니다.`);
  }
  const body = await response.json().catch(() => null);
  if (body?.success !== true) {
    throw scenarioError('JOIN_RESPONSE_INVALID', `채팅방 ${roomId} 입장 응답이 success=true가 아닙니다.`);
  }

  try {
    await page.waitForURL(`${BASE_URL}/chat/${roomId}`, { timeout: ROOM_READY_TIMEOUT });
  } catch (error) {
    throw scenarioError(
      'JOIN_NAVIGATION_TIMEOUT',
      `입장 API는 200이지만 ${ROOM_READY_TIMEOUT}ms 안에 이동하지 못했습니다. Room ID: ${roomId}, Current URL: ${page.url()}`,
      error
    );
  }
  await waitForChatRoomReady(page);
  return roomId;
}

/**
 * 특정 채팅방 입장 액션
 * @param {import('@playwright/test').Page} page
 * @param {string} roomId - 채팅방 ID
 */
async function joinChatRoomByIdAction(page, roomId) {
  await page.goto(`${BASE_URL}/chat/${roomId}`);
}

/**
 * 채팅방 생성 액션
 * @param {import('@playwright/test').Page} page
 * @param {string} roomName - 생성할 채팅방 이름
 */
async function createChatRoomAction(page, roomName) {
  await page.goto(`${BASE_URL}/chat/new`);
  await page.getByTestId('chat-room-name-input').fill(roomName);
  await page.getByTestId('create-chat-room-button').click();
  await page.waitForURL(new RegExp(`${BASE_URL}/chat/[a-f0-9]{24}`));
}

/**
 * 메시지 전송 액션
 * @param {import('@playwright/test').Page} page
 * @param {string} message - 전송할 메시지 내용
 */
async function sendMessageAction(page, message, { expectFailure = false } = {}) {
  await page.getByTestId('chat-message-input').fill(message);
  await page.getByTestId('chat-send-button').click();
  await page.getByTestId('message-submission-status').filter({
    hasText: expectFailure ? 'failed' : 'complete',
  }).waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * 여러 메시지 전송 액션
 * @param {import('@playwright/test').Page} page
 * @param {number} count - 전송할 메시지 개수
 * @returns {Promise<string[]>} 전송된 메시지 배열
 */
async function sendMultipleMessagesAction(page, count) {
  const messages = [];

  for (let i = 0; i < count; i++) {
    const message = `테스트 메시지 ${i + 1} - ${bannedWordSafeToken()}`;
    messages.push(message);

    await sendMessageAction(page, message);
    await page.waitForTimeout(100); // 메시지 전송 간 약간의 지연 추가
  }

  return messages;
}

/**
 * 파일 업로드 후 메세지 전송
 * @param {import('@playwright/test').Page} page
 * @param {string} filePath - 업로드할 파일 경로
 */
async function uploadFileAction(page, filePath, message = '') {
  await page.getByTestId('file-upload-input').setInputFiles(filePath);
  await sendMessageAction(page, message);
}

/**
 * 채팅 스크롤 최상단으로 이동 액션
 * @param {import('@playwright/test').Page} page
 */
async function scrollChatToTopAction(page) {
  const container = page.getByTestId('chat-messages-container');
  await container.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(1000); // 스크롤 후 잠시 대기
}

/**
 * 이모지 반응 추가 액션
 * @param {import('@playwright/test').Page} page
 * @param {string} emoji - 추가할 이모지 (기본값: '😀')
 */
async function addEmojiReactionAction(page, emoji = '😀') {
  await page.getByTestId('message-reaction-button').last().click();
  await page.locator(`[data-testid="emoji-picker-container"] >>> button[aria-label="${emoji}"]`).click();
}

module.exports = {
  joinFirstChatRoomAction,
  joinRandomChatRoomAction,
  joinChatRoomByIdAction,
  createChatRoomAction,
  sendMessageAction,
  sendMultipleMessagesAction,
  uploadFileAction,
  scrollChatToTopAction,
  addEmojiReactionAction,
  waitForRoomListReady,
  waitForChatRoomReady,
};

const {
    createChatRoomAction,
    joinRandomChatRoomAction,
    sendMessageAction,
    sendMultipleMessagesAction,
    uploadFileAction,
    waitForChatRoomReady,
} = require('../../actions/chat.actions');
const { bannedWordSafeText } = require('../../utils/bannedWordSafeText');
const { expect } = require('@playwright/test');
const path = require('path');
const { randomUUID } = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const MASS_MESSAGE_COUNT = process.env.MASS_MESSAGE_COUNT || 10;

async function gotoChatPage(page, vuContext) {
    await page.goto(`${BASE_URL}/chat`);
    await expect(page).toHaveURL(`${BASE_URL}/chat`);
}

/**
 * Artillery 채팅방 생성 및 메시지 전송 시나리오
 */
async function chatRoomCreationScenario(page, vuContext) {
    const observe = vuContext.vars.observation.action;
    try {
        // 1. 채팅방 확인
        await expect(page).toHaveURL(`${BASE_URL}/chat`);

        // 2. 채팅방 생성
        const roomName = `부하테스트_${randomUUID()}`;
        await observe('room_create', async () => {
            await createChatRoomAction(page, roomName);
            await expect(page).toHaveURL(new RegExp(`${BASE_URL}/chat/\\w+`));

            // URL 이 바뀌어도 소켓이 안 붙으면 방은 로딩 스피너에 머문다.
            await expect(page.getByTestId('chat-message-input')).toBeVisible();
        });

        // 3. 메시지 전송
        const message = `테스트 메시지 ${bannedWordSafeText(Date.now())}`;
        await observe('message_send', async () => {
            await sendMessageAction(page, message);
            const messageElement = page.getByTestId('message-content').filter({ hasText: message });
            await expect(messageElement).toBeVisible();
        });

        vuContext.vars.chatRoomUrl = page.url();
    } catch (error) {
        console.error('Chat room creation scenario failed:', error.message);
        throw error;
    }
}

/**
 * Artillery 메시지 대량 전송 시나리오
 */
async function massMessageScenario(page, vuContext) {
    const observe = vuContext.vars.observation.action;
    try {
        await waitForChatRoomReady(page);

        // 2. 여러 메시지 연속 전송 (10개)
        console.log(`Sending ${MASS_MESSAGE_COUNT} messages...`);
        await observe('mass_message_send', async () => {
            const messages = await sendMultipleMessagesAction(page, MASS_MESSAGE_COUNT);
            await expect(page.getByTestId('message-content').filter({ hasText: messages.at(-1) })).toBeVisible();
        });
    } catch (error) {
        console.error('Mass message scenario failed:', error.message);
        throw error;
    }
}

/**
 * Artillery 파일 업로드 시나리오
 */
async function fileUploadScenario(page, vuContext) {
    const observe = vuContext.vars.observation.action;
    try {
        await waitForChatRoomReady(page);

        // 2. 이미지 파일 업로드
        const filePath = path.resolve(__dirname, '../../fixtures/images/profile.jpg');
        const message = `파일 업로드 부하 테스트 ${bannedWordSafeText(Date.now())}`;

        const uploadPromise = page.waitForResponse(
            response => response.url().includes('/api/files/upload') && response.status() === 200,
            { timeout: 15000 }
        );

        await observe('file_upload', async () => {
            await uploadFileAction(page, filePath, message);
            await uploadPromise;
            const fileMessageContainer = page.getByTestId('file-message-container').filter({ hasText: message });
            await expect(fileMessageContainer).toBeVisible({ timeout: 10000 });
        });
    } catch (error) {
        console.error('File upload scenario failed:', error.message);
        throw error;
    }
}

/**
 * Artillery 금칙어 처리 시나리오
 */
async function forbiddenWordScenario(page, vuContext) {
    const testUser = vuContext.vars.testUser;
    const observe = vuContext.vars.observation.action;
    // NOTE: 환경변수에서 금칙어 목록을 가져오거나 기본값 사용
    const FORBIDDEN_WORDS = process.env.FORBIDDEN_WORDS
        ? process.env.FORBIDDEN_WORDS
            .replace(/^"|"$/g, '') // Remove leading/trailing double quotes
            .split(',')
            .map(word => word.trim().replace(/^"|"$/g, '')) // Remove quotes from each word
        : ['b3sig78jv', '9c0hej6x', 'lbl276sz'];

    try {
        await waitForChatRoomReady(page);

        // 2. 금칙어 메시지 전송 시도
        const forbiddenWord = FORBIDDEN_WORDS[Math.floor(Math.random() * FORBIDDEN_WORDS.length)];
        await observe('forbidden_message_send', async () => {
            await sendMessageAction(page, forbiddenWord, { expectFailure: true });
            const errorToast = page.getByTestId('toast-error');
            await expect(errorToast).toBeVisible({ timeout: 5000 });
            const sentMessage = page.getByTestId('message-content').filter({ hasText: forbiddenWord });
            await expect(sentMessage).not.toBeVisible();
        });

        vuContext.vars.testUser = testUser;
    } catch (error) {
        console.error('Forbidden word scenario failed:', error.message);
        throw error;
    }
}

async function randomRoomJoinScenario(page, vuContext) {
    const observe = vuContext.vars.observation.action;
    await observe('room_join', () => joinRandomChatRoomAction(page));
}

module.exports = {
    gotoChatPage,
    chatRoomCreationScenario,
    massMessageScenario,
    fileUploadScenario,
    forbiddenWordScenario,
    randomRoomJoinScenario,
};

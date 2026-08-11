const { failedLoginScenario, loginScenario } = require('./scenarios/auth.scenario.js');
const {
    chatRoomCreationScenario,
    randomRoomJoinScenario,
    massMessageScenario,
    fileUploadScenario,
    forbiddenWordScenario,
} = require('./scenarios/chat.scenario.js');
const { fullProfileUpdateScenario } = require('./scenarios/profile.scenario.js');
const { createObservation } = require('./observation.js');
const { randomUUID } = require('crypto');

function generateUserSchema() {
    const id = randomUUID();
    return {
        email: `loadtest_${id}@example.com`,
        password: 'Password123!',
        passwordConfirm: 'Password123!',
        name: `Load Test User ${id.slice(0, 8)}`,
    };
}

async function runProfile(page, vuContext, profileName, scenarios) {
    vuContext.vars.testUser = generateUserSchema();
    vuContext.vars.loadProfile = profileName;
    vuContext.vars.observation = createObservation(page, vuContext);
    try {
        for (const scenario of scenarios) {
            try {
                await scenario(page, vuContext);
            } catch (error) {
                error.message = `[${scenario.name}] ${error.message}`;
                throw error;
            }
        }
    } finally {
        await vuContext.vars.observation.finish();
    }
}

const authNegativeProfile = (page, vuContext) =>
    runProfile(page, vuContext, 'auth-negative', [failedLoginScenario]);

const roomLifecycleProfile = (page, vuContext) =>
    runProfile(page, vuContext, 'room-lifecycle', [loginScenario, chatRoomCreationScenario, randomRoomJoinScenario]);

const messagingProfile = (page, vuContext) =>
    runProfile(page, vuContext, 'messaging', [loginScenario, chatRoomCreationScenario, massMessageScenario, forbiddenWordScenario]);

const mediaProfile = (page, vuContext) =>
    runProfile(page, vuContext, 'media-profile', [loginScenario, chatRoomCreationScenario, fileUploadScenario, fullProfileUpdateScenario]);

module.exports = { authNegativeProfile, roomLifecycleProfile, messagingProfile, mediaProfile };

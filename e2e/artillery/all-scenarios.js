const { roomLifecycleProfile } = require('./profile-scenarios.js');

/**
 * 기존 기본 진입점은 방 생명주기 프로필만 실행한다.
 * 인증 실패, 메시징, 미디어/프로필 부하는 각 전용 설정으로 실행한다.
 */
async function allScenarios(page, vuContext) {
    return roomLifecycleProfile(page, vuContext);
}

module.exports = {
    allScenarios,
    roomLifecycleProfile,
};

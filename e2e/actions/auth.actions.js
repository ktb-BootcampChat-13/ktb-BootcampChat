const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function runLoginStep(step, testId, callback) {
  try {
    return await callback();
  } catch (error) {
    const originalMessage = error?.message || String(error);
    const prefix = `[loginAction step=${step} locator=${testId}]`;

    if (error && typeof error === 'object') {
      const originalStack = error.stack;
      error.message = `${prefix} ${originalMessage}`;
      error.loginActionStep = step;
      error.loginActionLocator = testId;
      if (typeof originalStack === 'string') {
        const firstFrame = originalStack.indexOf('\n');
        error.stack = `${error.name || 'Error'}: ${error.message}${firstFrame >= 0 ? originalStack.slice(firstFrame) : ''}`;
      }
      throw error;
    }

    throw new Error(`${prefix} ${originalMessage}`);
  }
}

/**
 * 로그인 액션
 * @param {import('@playwright/test').Page} page
 * @param {Object} credentials - { email: string, password: string }
 * @param waitForRedirect
 */
async function openLoginAction(page) {
  await page.goto(`${BASE_URL}/login`);
  const emailInput = page.getByTestId('login-email-input');
  await emailInput.waitFor({ state: 'visible' });
  if (!await emailInput.isEnabled()) {
    throw new Error('로그인 입력 필드가 활성화되지 않았습니다.');
  }
}

async function loginAction(page, credentials, waitForRedirect = true, navigate = true) {
  if (navigate) await openLoginAction(page);
  await runLoginStep('email_fill', 'login-email-input', () =>
    page.getByTestId('login-email-input').fill(credentials.email));
  await runLoginStep('password_fill', 'login-password-input', () =>
    page.getByTestId('login-password-input').fill(credentials.password));
  await runLoginStep('submit_click', 'login-submit-button', () =>
    page.getByTestId('login-submit-button').click());
  if (waitForRedirect) {
    await page.waitForURL(`${BASE_URL}/chat`);
  }
}

/**
 * 회원가입 액션
 * @param {import('@playwright/test').Page} page
 * @param {Object} userData - { email: string, password: string, passwordConfirm: string, name: string }
 */
async function registerAction(page, userData) {
  await page.goto(`${BASE_URL}/register`);
  await page.getByTestId('register-email-input').fill(userData.email);
  await page.getByTestId('register-password-input').fill(userData.password);
  await page.getByTestId('register-password-confirm-input').fill(userData.passwordConfirm);
  await page.getByTestId('register-name-input').fill(userData.name);
  await page.getByTestId('register-submit-button').click();
  // 성공 시 앱이 1000ms 뒤 router.push('/login')로 이동하므로, 그 내비게이션이 끝난 뒤에
  // 다음 goto가 실행되어야 경합(net::ERR_ABORTED)이 없다. 실패 시엔 에러 메시지 표시까지 대기.
  await Promise.race([
    page.waitForURL(`${BASE_URL}/`, { timeout: 10000 }).catch(() => {}),
    page.getByTestId('register-error-message').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
  ]);
}

/**
 * 로그아웃 액션
 * @param {import('@playwright/test').Page} page
 */
async function logoutAction(page) {
  await page.getByTestId('logout-link').click();
}

module.exports = {
  loginAction,
  openLoginAction,
  registerAction,
  logoutAction,
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { loginAction } = require('./auth.actions');

function createPage(failAt = null, failure = null) {
  const calls = [];
  const locatorFor = (testId) => ({
    fill: async (value) => {
      calls.push({ testId, action: 'fill', value });
      if (failAt === testId) throw failure;
    },
    click: async () => {
      calls.push({ testId, action: 'click' });
      if (failAt === testId) throw failure;
    },
  });
  return {
    calls,
    getByTestId: locatorFor,
    waitForURL: async () => calls.push({ action: 'waitForURL' }),
  };
}

test('tags the email fill error without replacing the original error or cause', async () => {
  const cause = new Error('browser disconnected');
  const failure = new Error('locator.fill: Timeout 30000ms exceeded.', { cause });
  failure.stack = 'TimeoutError: locator.fill: Timeout 30000ms exceeded.\n    at original-locator-frame';
  const page = createPage('login-email-input', failure);

  await assert.rejects(
    loginAction(page, { email: 'bad@example.com', password: 'wrong' }, false, false),
    (error) => {
      assert.equal(error, failure);
      assert.equal(error.cause, cause);
      assert.match(error.message, /^\[loginAction step=email_fill locator=login-email-input\]/);
      assert.match(error.stack, /original-locator-frame/);
      assert.equal(error.loginActionStep, 'email_fill');
      assert.equal(error.loginActionLocator, 'login-email-input');
      return true;
    }
  );
  assert.deepEqual(page.calls.map((call) => call.testId), ['login-email-input']);
});

test('tags the password fill step and does not retry or submit', async () => {
  const failure = new Error('locator.fill: Timeout 30000ms exceeded.');
  const page = createPage('login-password-input', failure);

  await assert.rejects(
    loginAction(page, { email: 'bad@example.com', password: 'wrong' }, false, false),
    /step=password_fill locator=login-password-input/
  );
  assert.deepEqual(page.calls.map((call) => call.testId), [
    'login-email-input',
    'login-password-input',
  ]);
});

test('tags the submit step and performs every login action exactly once', async () => {
  const failure = new Error('locator.click: Timeout 30000ms exceeded.');
  const page = createPage('login-submit-button', failure);

  await assert.rejects(
    loginAction(page, { email: 'bad@example.com', password: 'wrong' }, false, false),
    /step=submit_click locator=login-submit-button/
  );
  assert.deepEqual(page.calls.map((call) => call.testId), [
    'login-email-input',
    'login-password-input',
    'login-submit-button',
  ]);
});

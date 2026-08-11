import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '../../pages/index';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  checkServerConnection: vi.fn(() => new Promise(() => {})),
  router: { query: {}, push: vi.fn(), replace: vi.fn(), isReady: true },
}));

vi.mock('next/router', () => ({ useRouter: () => mocks.router }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ login: mocks.login }),
  withoutAuth: (Component) => Component,
}));
vi.mock('@/services/authService', () => ({
  default: { checkServerConnection: mocks.checkServerConnection },
}));

describe('Login page', () => {
  it('keeps the login form usable while the health check is pending', () => {
    render(<LoginPage />);

    expect(screen.getByTestId('server-status-checking')).toBeInTheDocument();
    expect(screen.getByTestId('login-email-input')).toBeEnabled();
    expect(screen.getByTestId('login-password-input')).toBeEnabled();
    expect(screen.getByTestId('login-submit-button')).toBeEnabled();
  });

  it('preserves the same editable inputs when the health check succeeds', async () => {
    mocks.checkServerConnection.mockResolvedValueOnce(true);
    render(<LoginPage />);
    const emailInput = screen.getByTestId('login-email-input');
    const passwordInput = screen.getByTestId('login-password-input');

    await waitFor(() => expect(screen.queryByTestId('server-status-checking')).not.toBeInTheDocument());

    expect(screen.getByTestId('login-email-input')).toBe(emailInput);
    expect(screen.getByTestId('login-password-input')).toBe(passwordInput);
    expect(emailInput).toBeEnabled();
    expect(passwordInput).toBeEnabled();
  });

  it('preserves the same editable inputs when the health check fails', async () => {
    mocks.checkServerConnection.mockRejectedValueOnce(new Error('health unavailable'));
    render(<LoginPage />);
    const emailInput = screen.getByTestId('login-email-input');
    const passwordInput = screen.getByTestId('login-password-input');

    await waitFor(() => expect(screen.getByTestId('server-status-message')).toBeInTheDocument());

    expect(screen.getByTestId('login-email-input')).toBe(emailInput);
    expect(screen.getByTestId('login-password-input')).toBe(passwordInput);
    expect(emailInput).toBeEnabled();
    expect(passwordInput).toBeEnabled();
  });
});

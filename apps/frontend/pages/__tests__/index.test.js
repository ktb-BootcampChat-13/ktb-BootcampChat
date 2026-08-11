import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '../index';

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
});

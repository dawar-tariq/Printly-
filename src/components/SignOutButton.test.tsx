// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), getSession: vi.fn(), revoke: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock('@/lib/supabase-client', () => ({ createBrowserSupabase: () => ({ auth: { signOut: mocks.signOut, getSession: mocks.getSession, admin: { signOut: mocks.revoke } } }) }));
import { SignOutButton } from './SignOutButton';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null });
  mocks.revoke.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe('signing out', () => {
  it.each(['shop', 'admin'] as const)('revokes only the current %s session on success', async (portal) => {
    render(<SignOutButton portal={portal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(portal === 'admin' ? '/admin/login' : '/login'));
    expect(mocks.revoke).toHaveBeenCalledWith('session-token', 'local');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it('does not pretend the server revoked the session after a failure', async () => {
    mocks.signOut.mockResolvedValue({ error: { message: 'provider failure' } });
    render(<SignOutButton portal="shop" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be fully confirmed.*session may still be active/i);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not retry with a missing token or hide a provider rejection', async () => {
    mocks.revoke.mockResolvedValue({ error: { status: 403 } });
    // The SDK can suppress a 403 on its own signOut and return a null error.
    render(<SignOutButton portal="admin" />);
    const button = screen.getByRole('button', { name: 'Sign out' });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be fully confirmed/i);
    fireEvent.click(button);
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
